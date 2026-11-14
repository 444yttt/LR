// Fixtures in this file are synthetic TEST DATA ONLY. They are not real vehicle, trip, or account data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAY_MS, parseSnapshot } from '../src/telemetry.ts';
import {
  alertThreshold, connectionState, defaultAlertPrefs, drivesView, formatDistance, formatDuration, formatEfficiency,
  healthView, lastUpdateLine, metrics, parseAlertPrefs, relativeTime, routeFromUrl, serializeThresholds, stackFor,
  type GarageInput,
} from '../src/garageModel.ts';

const now = Date.parse('2026-11-14T03:00:00Z'); // 12:00 JST
const ago = (ms: number) => new Date(now - ms).toISOString();
const fresh = (extra: Record<string, unknown> = {}) => parseSnapshot({ status: 'fresh', fetchedAt: ago(4 * 60_000), ...extra });
const input = (extra: Partial<GarageInput>): GarageInput =>
  ({ phase: 'ready', snapshot: null, hasSession: true, discoveryFailed: false, lastSyncedAt: null, ...extra });

test('relative time is coarse, honest about unknown, and tolerates small clock skew', () => {
  assert.equal(relativeTime(null, now), null);
  assert.equal(relativeTime('bad', now), null);
  assert.equal(relativeTime(now + 60_000, now), 'just now');
  assert.equal(relativeTime(now + 10 * 60_000, now), null);
  assert.equal(relativeTime(now - 10_000, now), 'just now');
  assert.equal(relativeTime(now - 4 * 60_000, now), '4 min ago');
  assert.equal(relativeTime(now - 3.5 * 3600_000, now), '3 h ago');
  assert.equal(relativeTime(now - DAY_MS, now), 'yesterday');
  assert.equal(relativeTime(now - 5 * DAY_MS, now), '5 days ago');
});

test('not fetched, update failed, and auth expired are distinct states', () => {
  const notFetched = connectionState(input({ snapshot: null }), now);
  const failedEmpty = connectionState(input({ phase: 'failed' }), now);
  const failedWithData = connectionState(input({ phase: 'failed', snapshot: fresh(), lastSyncedAt: now - 120_000 }), now);
  const expired = connectionState(input({ phase: 'expired', hasSession: false }), now);
  assert.equal(notFetched.kind, 'notFetched');
  assert.equal(failedEmpty.kind, 'updateFailed');
  assert.match(failedEmpty.detail, /No vehicle values/);
  assert.equal(failedWithData.kind, 'updateFailed');
  assert.match(failedWithData.detail, /last successful update, 2 min ago/);
  assert.equal(expired.kind, 'authExpired');
  assert.equal(expired.action, 'signIn');
  assert.equal(new Set([notFetched.status, failedEmpty.status, expired.status]).size, 3);
});

test('connection states cover configuration, sign-in, loading, and collector reports', () => {
  const kind = (extra: Partial<GarageInput>) => connectionState(input(extra), now).kind;
  assert.equal(kind({ phase: 'unconfigured', hasSession: false }), 'unconfigured');
  assert.equal(connectionState(input({ phase: 'unconfigured', hasSession: false }), now).status, 'Sync unverified');
  assert.equal(kind({ phase: 'signedOut', hasSession: false }), 'signedOut');
  assert.equal(kind({ phase: 'signedOut', hasSession: false, discoveryFailed: true }), 'setupUnavailable');
  assert.equal(kind({ phase: 'failed', hasSession: false }), 'signInFailed');
  assert.equal(kind({ phase: 'signingIn', hasSession: false }), 'signingIn');
  assert.equal(kind({ phase: 'loading' }), 'connecting');
  assert.equal(connectionState(input({ phase: 'loading' }), now).loading, true);
  assert.equal(kind({ phase: 'loading', snapshot: fresh() }), 'refreshing');
  assert.equal(connectionState(input({ phase: 'loading', snapshot: fresh() }), now).loading, false);
  assert.equal(kind({ snapshot: fresh({ status: 'reauthorize' }) }), 'jlrReauthorize');
  assert.equal(kind({ snapshot: fresh({ status: 'error' }) }), 'sourceError');
  assert.equal(kind({ snapshot: parseSnapshot({ status: 'pending' }) }), 'pending');
  assert.equal(kind({ snapshot: fresh({ fetchedAt: ago(40 * 3600_000) }) }), 'stale');
  assert.equal(connectionState(input({ snapshot: fresh() }), now).status, 'Updated 4 min ago');
});

test('last update footer shows absolute JST time with the relative age', () => {
  assert.equal(lastUpdateLine(null, now), 'No verified vehicle update available');
  assert.equal(lastUpdateLine(fresh(), now), 'Last successful update · Nov 14, 11:56 JST · 4 min ago');
});

test('drives show only verified history and group by JST day', () => {
  assert.equal(drivesView(input({ phase: 'loading' }), now).kind, 'loading');
  assert.equal(drivesView(input({ phase: 'unconfigured', hasSession: false }), now).kind, 'signedOut');
  assert.equal(drivesView(input({ snapshot: fresh({ trips: [ago(3600_000)] }) }), now).kind, 'unverified');
  const verified = { lastDriveVerified: true, lastDriveAt: ago(3600_000) };
  assert.equal(drivesView(input({ snapshot: fresh({ ...verified, trips: [] }) }), now).kind, 'empty');
  const view = drivesView(input({ snapshot: fresh({ ...verified, trips: [ago(3600_000), ago(DAY_MS), ago(3 * DAY_MS), ago(2 * 3600_000)] }) }), now);
  assert.equal(view.kind, 'list');
  if (view.kind !== 'list') return;
  assert.deepEqual(view.sections.map(section => [section.title, section.drives.length]), [['Today', 2], ['Yesterday', 1], ['Wed, Nov 11', 1]]);
});

test('drive detail values are formatted only when reported', () => {
  const [plain] = parseSnapshot({ status: 'fresh', trips: [ago(0)] }).trips!;
  assert.equal(formatDuration(plain), null);
  assert.equal(formatDistance(plain), null);
  assert.equal(formatEfficiency(plain), null);
  const [rich] = parseSnapshot({ status: 'fresh', trips: [{ endedAt: ago(0), startedAt: ago(72 * 60_000), distanceKm: 42.34, efficiencyLPer100Km: 9.84 }] }).trips!;
  assert.equal(formatDuration(rich), '1 h 12 min');
  assert.equal(formatDistance(rich), '42.3 km');
  assert.equal(formatEfficiency(rich), '9.8 L/100 km');
  const [backwards] = parseSnapshot({ status: 'fresh', trips: [{ endedAt: ago(0), startedAt: ago(-60_000), distanceKm: -3 }] }).trips!;
  assert.equal(backwards.startedAt, null);
  assert.equal(backwards.distanceKm, null);
});

test('health is unknown unless a fresh report says otherwise; vehicles without a feed never show data', () => {
  const report = (extra: Record<string, unknown>) => input({ snapshot: fresh(extra) });
  assert.equal(healthView(0, input({}), now).title, 'Not checked');
  assert.equal(healthView(0, report({ health: 'good' }), now).title, 'No reported issues');
  assert.equal(healthView(0, report({ health: 'good' }), now).caption, 'Reported by JLR diagnostics');
  assert.equal(healthView(0, report({ health: 'service-required' }), now).title, 'Service required');
  assert.match(healthView(0, report({ health: 'service-required' }), now).detail, /Land Rover retailer/);
  assert.match(healthView(0, report({ health: 'good', fetchedAt: ago(40 * 3600_000) }), now).detail, /too old/);
  assert.equal(healthView(1, null, now).title, 'Not connected');
  assert.equal(healthView(2, null, now).title, 'Setup required');
  assert.equal(healthView(2, report({ health: 'attention-required' }), now).caption, 'Reported by BMW diagnostics');
  assert.deepEqual(metrics(null, now), { rangeKm: null, fuelPercent: null, lastDrive: null, idleDays: null });
  assert.equal(metrics(report({ rangeKm: 500 }), now).rangeKm, 500);
});

test('connection copy names the vehicle and its own source', () => {
  assert.match(connectionState(input({ phase: 'signedOut', hasSession: false }), now).detail, /Range Rover/);
  assert.match(connectionState(input({ phase: 'signedOut', hasSession: false }), now, 2).detail, /BMW X7/);
  assert.equal(connectionState(input({ snapshot: fresh({ status: 'error' }) }), now).title, 'JLR update failed');
  assert.equal(connectionState(input({ snapshot: fresh({ status: 'error' }) }), now, 1).title, 'Ferrari update failed');
});

test('deep links resolve to screens and never treat the OAuth redirect as a screen', () => {
  assert.deepEqual(routeFromUrl('garage-monitor://'), { name: 'garage' });
  assert.deepEqual(routeFromUrl('garage-monitor://vehicle/range-rover'), { name: 'vehicle', vehicle: 0 });
  assert.deepEqual(routeFromUrl('garage-monitor://vehicle/bmw-x7/connection'), { name: 'connection', vehicle: 2 });
  assert.equal(routeFromUrl('garage-monitor://vehicle/bmw-m4'), null);
  assert.deepEqual(routeFromUrl('garage-monitor://vehicle/ferrari-296/drives'), { name: 'drives', vehicle: 1 });
  assert.deepEqual(routeFromUrl('garage-monitor://drives?x=1'), { name: 'drives', vehicle: 0 });
  assert.deepEqual(stackFor({ name: 'drive', vehicle: 2, endedAt: ago(0) }).map(route => route.name), ['vehicle', 'drives', 'drive']);
  assert.deepEqual(routeFromUrl('garage-monitor:///notifications'), { name: 'notifications' });
  assert.equal(routeFromUrl('garage-monitor://auth?code=abc'), null);
  assert.equal(routeFromUrl('garage-monitor://vehicle/unknown'), null);
  assert.equal(routeFromUrl('https://example.com/vehicle/range-rover'), null);
  assert.deepEqual(stackFor({ name: 'notifications' }).map(route => route.name), ['vehicle', 'connection', 'notifications']);
});

test('alert toggles pick the threshold to deliver', () => {
  const on = { ...defaultAlertPrefs, enabled: true };
  assert.equal(alertThreshold(7, defaultAlertPrefs), null);
  assert.equal(alertThreshold(null, on), null);
  assert.equal(alertThreshold(7, on), 7);
  assert.equal(alertThreshold(14, on), 14);
  assert.equal(alertThreshold(14, { ...on, after14: false }), 7);
  assert.equal(alertThreshold(7, { ...on, after7: false }), null);
  assert.equal(alertThreshold(14, { ...on, after7: false, after14: false }), null);
  assert.deepEqual(parseAlertPrefs('yes', null), on);
  assert.deepEqual(parseAlertPrefs(null, '14'), { enabled: false, after7: false, after14: true });
  assert.equal(serializeThresholds({ ...on, after7: false }), '14');
});
