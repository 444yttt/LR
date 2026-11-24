// iOS widget snapshot: the only data the widget reads. Fixtures are synthetic TEST DATA ONLY (made-up values).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseSnapshot } from '../src/telemetry.ts';
import { parseVehicleList } from '../src/gatewayVehicles.ts';
import { VEHICLES, relativeTime, type Phase } from '../src/garageModel.ts';
import {
  WIDGET_APP_GROUP, WIDGET_SCHEMA_VERSION, WIDGET_SNAPSHOT_KEY, applyWidgetAction, buildWidgetSnapshot,
  defaultWidgetVehicle, widgetAction, widgetContentKey, type WidgetStorage,
} from '../src/widgetSnapshot.ts';

const now = Date.parse('2026-11-14T03:00:00Z');
const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
const FAKE_VIN = 'TESTVIN0000000000';

/** A GET /v1/vehicles body carrying every kind of field the widget must never see. */
const body = { vehicles: [
  {
    id: 'range-l460', status: 'fresh', fetchedAt: ago(4), rangeKm: 512.4, fuelPercent: 61.6, socPercent: null,
    vin: FAKE_VIN, latitude: 35.1, longitude: 139.1, odometerKm: 12345, lastDriveAt: ago(90), lastDriveVerified: true,
    trips: [ago(90)], modelYear: 2025, health: 'good', accessToken: 'secret-token', refreshToken: 'secret-refresh', issuer: 'https://issuer.test',
  },
  { id: 'bmw-x7', status: 'stale', fetchedAt: ago(3 * 1440), rangeKm: 640, fuelPercent: 70 },
  { id: 'audi-s-etron-gt', status: 'fresh', fetchedAt: ago(30), rangeKm: null, electricRangeKm: 320, fuelPercent: null, socPercent: 70 },
] };
const snapshots = parseVehicleList(body);
const input = (phase: Phase, extra: Partial<Parameters<typeof widgetAction>[0]> = {}) =>
  ({ phase, snapshots, selectedVehicleId: null, now, ...extra });

test('snapshot carries only the documented fields, per vehicle in Garage order', () => {
  const snapshot = buildWidgetSnapshot(input('ready'));
  assert.deepEqual(Object.keys(snapshot).sort(), ['selectedVehicleId', 'session', 'v', 'vehicles', 'writtenAt']);
  assert.equal(snapshot.v, WIDGET_SCHEMA_VERSION);
  assert.equal(snapshot.writtenAt, now);
  assert.equal(snapshot.session, 'active');
  assert.deepEqual(snapshot.vehicles.map(vehicle => vehicle.id), ['range-rover', 'bmw-x7', 'audi-s-etron-gt', 'ferrari-296']);
  for (const vehicle of snapshot.vehicles) {
    assert.deepEqual(Object.keys(vehicle).sort(),
      ['authExpired', 'id', 'kind', 'levelLabel', 'levelPercent', 'name', 'rangeKm', 'stale', 'updatedAt']);
  }
  assert.deepEqual(snapshot.vehicles[0], {
    id: 'range-rover', name: 'Range Rover', kind: 'live', levelLabel: 'Fuel', levelPercent: 62, rangeKm: 512,
    updatedAt: Date.parse(ago(4)), stale: false, authExpired: false,
  });
});

test('no VIN, location, trips, last drive, odometer, model year, health, tokens or issuer reach the shared payload', () => {
  const text = JSON.stringify(buildWidgetSnapshot(input('ready')));
  assert.doesNotMatch(text, new RegExp(FAKE_VIN));
  assert.doesNotMatch(text, /vin|lat|lon|odometer|trip|drive|modelYear|2025|health|token|secret|issuer|https?:/i);
  assert.doesNotMatch(text, new RegExp(ago(90).slice(0, 16)));
  assert.doesNotMatch(text, /12345|35\.1|139\.1/);
});

test('level label follows metrics(): Battery only for a charge level without a fuel level', () => {
  const [rover, x7, etron, ferrari] = buildWidgetSnapshot(input('ready')).vehicles;
  assert.equal(rover.levelLabel, 'Fuel');
  assert.equal(x7.levelLabel, 'Fuel');
  assert.deepEqual([etron.levelLabel, etron.levelPercent, etron.rangeKm], ['Battery', 70, 320]);
  assert.equal(ferrari.kind, 'notConnected');
  const hybrid = parseVehicleList({ vehicles: [{ id: 'bmw-x7', status: 'fresh', fetchedAt: ago(5), fuelPercent: 40, socPercent: 90 }] });
  assert.deepEqual(buildWidgetSnapshot(input('ready', { snapshots: hybrid })).vehicles[1].levelLabel, 'Fuel');
});

test('stale: an old report or a collector status other than fresh', () => {
  const [rover, x7] = buildWidgetSnapshot(input('ready')).vehicles;
  assert.equal(rover.stale, false);
  assert.equal(x7.stale, true);
  const old = { 'range-rover': parseSnapshot({ status: 'fresh', fetchedAt: ago(37 * 60), fuelPercent: 50 }) };
  assert.equal(buildWidgetSnapshot(input('ready', { snapshots: old })).vehicles[0].stale, true);
  const error = { 'range-rover': parseSnapshot({ status: 'error', fetchedAt: ago(5), fuelPercent: 50 }) };
  assert.equal(buildWidgetSnapshot(input('ready', { snapshots: error })).vehicles[0].stale, true);
});

test('missing values stay null; no report or a pending row is empty, not zero', () => {
  const partial = parseVehicleList({ vehicles: [
    { id: 'range-l460', status: 'fresh', fetchedAt: null },
    { id: 'bmw-x7', status: 'pending' },
  ] });
  const [rover, x7, etron] = buildWidgetSnapshot(input('ready', { snapshots: partial })).vehicles;
  assert.deepEqual([rover.kind, rover.levelPercent, rover.rangeKm, rover.updatedAt, rover.levelLabel], ['live', null, null, null, 'Fuel']);
  assert.equal(rover.stale, true);
  assert.deepEqual([x7.kind, x7.levelPercent, x7.rangeKm, x7.updatedAt], ['empty', null, null, null]);
  assert.deepEqual([etron.kind, etron.levelPercent], ['empty', null]);
});

test('default vehicle: stored choice, else first connected vehicle with a report, else the Range Rover', () => {
  assert.equal(defaultWidgetVehicle('audi-s-etron-gt', snapshots), 'audi-s-etron-gt');
  assert.equal(defaultWidgetVehicle('ferrari-296', {}), 'ferrari-296');
  assert.equal(defaultWidgetVehicle(null, snapshots), 'range-rover');
  assert.equal(defaultWidgetVehicle('not-a-car', { 'bmw-x7': snapshots['bmw-x7'] }), 'bmw-x7');
  assert.equal(defaultWidgetVehicle(undefined, { 'audi-s-etron-gt': snapshots['audi-s-etron-gt'] }), 'audi-s-etron-gt');
  assert.equal(defaultWidgetVehicle(null, {}), 'range-rover');
  assert.equal(defaultWidgetVehicle(null, null), 'range-rover');
  assert.equal(buildWidgetSnapshot(input('ready', { selectedVehicleId: 'bmw-x7' })).selectedVehicleId, 'bmw-x7');
});

test('sign-out and an unconfigured build clear the shared snapshot', () => {
  assert.deepEqual(widgetAction(input('signedOut')), { type: 'clear' });
  assert.deepEqual(widgetAction(input('unconfigured')), { type: 'clear' });
});

test('auth expired: indicator only, every vehicle flagged, no levels or times', () => {
  const action = widgetAction(input('expired'));
  assert.equal(action.type, 'write');
  if (action.type !== 'write') return;
  assert.equal(action.snapshot.session, 'expired');
  for (const vehicle of action.snapshot.vehicles) {
    assert.equal(vehicle.authExpired, true);
    assert.deepEqual([vehicle.levelPercent, vehicle.rangeKm, vehicle.updatedAt], [null, null, null]);
  }
});

test('refresh path: ready writes; failed or loading over earlier values writes them; with nothing loaded the widget is kept', () => {
  assert.equal(widgetAction(input('ready')).type, 'write');
  assert.equal(widgetAction(input('ready', { snapshots: {} })).type, 'write');
  assert.equal(widgetAction(input('failed')).type, 'write');
  assert.equal(widgetAction(input('loading')).type, 'write');
  assert.deepEqual(widgetAction(input('failed', { snapshots: {} })), { type: 'keep' });
  assert.deepEqual(widgetAction(input('loading', { snapshots: {} })), { type: 'keep' });
  assert.deepEqual(widgetAction(input('signingIn')), { type: 'keep' });
});

test('writer: JSON string under one key, then a widget reload; clear removes the key; keep does nothing', () => {
  const calls: string[] = [];
  const values = new Map<string, string>();
  const storage: WidgetStorage = {
    set: (key, value) => { calls.push('set ' + key); values.set(key, value); },
    remove: key => { calls.push('remove ' + key); values.delete(key); },
    reloadWidget: () => { calls.push('reload'); },
  };
  assert.equal(applyWidgetAction(storage, widgetAction(input('ready'))), true);
  assert.deepEqual(calls, ['set ' + WIDGET_SNAPSHOT_KEY, 'reload']);
  assert.equal(JSON.parse(values.get(WIDGET_SNAPSHOT_KEY)!).vehicles[2].levelLabel, 'Battery');
  assert.equal(applyWidgetAction(storage, { type: 'keep' }), false);
  assert.equal(applyWidgetAction(storage, widgetAction(input('signedOut'))), true);
  assert.deepEqual(calls.slice(2), ['remove ' + WIDGET_SNAPSHOT_KEY, 'reload']);
  assert.equal(values.size, 0);
});

test('content key ignores the write time only', () => {
  const a = widgetAction(input('ready'));
  const b = widgetAction(input('ready', { now: now + 1000 }));
  assert.equal(widgetContentKey(a), widgetContentKey(b));
  assert.notEqual(widgetContentKey(a), widgetContentKey(widgetAction(input('ready', { selectedVehicleId: 'bmw-x7' }))));
});

// The Swift widget is not compiled on Linux. These checks keep its contract strings and the relative-time copy in step.
const root = new URL('..', import.meta.url).pathname;
function swiftSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'fonts' ? [] : swiftSources(path);
    return entry.name.endsWith('.swift') ? [path] : [];
  });
}
const swiftFiles = swiftSources(join(root, 'targets/widget'));
const swift = swiftFiles.map(path => readFileSync(path, 'utf8')).join('\n');

test('app, widget target, and Swift reader agree on the App Group, key, and schema version', () => {
  const app = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')).expo;
  assert.deepEqual(app.ios.entitlements['com.apple.security.application-groups'], [WIDGET_APP_GROUP]);
  const target = readFileSync(join(root, 'targets/widget/expo-target.config.js'), 'utf8');
  assert.match(target, /com\.apple\.security\.application-groups/);
  assert.ok(swift.includes(`"${WIDGET_APP_GROUP}"`));
  assert.ok(swift.includes(`"${WIDGET_SNAPSHOT_KEY}"`));
  assert.match(swift, new RegExp(`schemaVersion = ${WIDGET_SCHEMA_VERSION}\\b`));
  // The widget never touches the network or credentials.
  assert.doesNotMatch(swift, /URLSession|URLRequest|Keychain|SecItem|SecureStore|Authorization|token/i);
});

test('Swift vehicle catalog matches VEHICLES ids and names', () => {
  for (const vehicle of VEHICLES) assert.ok(swift.includes(`("${vehicle.id}", "${vehicle.name}")`), vehicle.id);
});

test('Swift relative time mirrors relativeTime() thresholds', () => {
  for (const copy of ['"just now"', ' min ago"', ' h ago"', '"yesterday"', ' days ago"']) assert.ok(swift.includes(copy), copy);
  assert.equal(relativeTime(now - 44_000, now), 'just now');
  assert.match(swift, /age < 45\b/);
  assert.match(swift, /age < -300\b/);
});
test('SelectVehicleIntent is in targets/widget/_shared so the main app links it', () => {
  const shared = swiftFiles.filter(path => path.includes('/_shared/') && path.endsWith('VehicleIntent.swift'));
  assert.equal(shared.length, 1, 'VehicleIntent.swift must live in targets/widget/_shared, not the widget-only folder');
  const intent = readFileSync(shared[0], 'utf8');
  assert.match(intent, /struct SelectVehicleIntent: WidgetConfigurationIntent/);
  assert.doesNotMatch(intent, /URLSession|URLRequest|Keychain|token/i);
});
