import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAY_MS, dueThreshold, idleDays, parseSnapshot } from '../src/telemetry.ts';

const now = Date.parse('2026-11-12T00:00:00Z');
const at = (days: number) => new Date(now - days * DAY_MS).toISOString();
const snapshot = (days: number, options = {}) => parseSnapshot({
  status: 'fresh', fetchedAt: at(0), lastDriveVerified: true, lastDriveAt: at(days), ...options,
});

test('unknown values remain unavailable and malformed values do not become telemetry', () => {
  const parsed = parseSnapshot({ status: 'pending', rangeKm: -1, fuelPercent: '90', health: 'unknown', lastDriveAt: 'bad', lastDriveVerified: true });
  assert.equal(parsed.rangeKm, null);
  assert.equal(parsed.fuelPercent, null);
  assert.equal(parsed.health, null);
  assert.equal(parsed.lastDriveVerified, false);
  assert.equal(parsed.trips, null);
});

test('fresh verified reports use the 7 and 14 day thresholds without replaying old thresholds', () => {
  for (const [age, expected] of [[6.99, null], [7, 7], [13.99, 7], [14, 14]] as const) {
    assert.equal(dueThreshold(snapshot(age), now), expected);
  }
  assert.equal(idleDays(snapshot(-1), now), null);
});

test('unverified, stale, failed, and expired results suppress alerts', () => {
  for (const state of [{ lastDriveVerified: false }, { fetchedAt: at(2) }, { status: 'error' }, { status: 'reauthorize' }]) {
    assert.equal(dueThreshold(snapshot(20, state), now), null);
  }
});

test('drive history is normalized, sorted, and deduplicated', () => {
  assert.deepEqual(snapshot(1, { trips: [at(2), 'bad', at(1), at(1)] }).trips, [at(1), at(2)]);
});
