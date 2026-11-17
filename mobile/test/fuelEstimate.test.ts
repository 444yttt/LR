// Telemetry economy estimate. Readings are obviously fake TEST DATA ONLY (tank 80 L, odometer from 12345); none is
// any real vehicle's history.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MIN_DISTANCE_KM, MIN_DROP_PP, REFUEL_JUMP_PP, estimateFromHistory, parseHistory, type HistoryPoint } from '../src/fuelEstimate.ts';

const p = (day: number, fuelPercent: number | null, odometerKm: number | null, socPercent: number | null = null): HistoryPoint =>
  ({ fetchedAt: new Date(Date.UTC(2026, 0, day)).toISOString(), fuelPercent, socPercent, odometerKm });

// Fake: 30 % → refuel to 80 % → drive 400 km down to 30 % (50 % of 80 L = 40 L) = 10 km/L.
const cycle = [p(1, 30, 12345), p(2, 80, 12345), p(4, 60, 12505), p(6, 30, 12745)];

test('documented thresholds', () => {
  assert.equal(REFUEL_JUMP_PP, 8);
  assert.equal(MIN_DROP_PP, 10);
  assert.equal(MIN_DISTANCE_KM, 50);
});

test('one refuel and a long enough stretch → km ÷ (drop × capacity)', () => {
  const result = estimateFromHistory(cycle, 80, 'fuel');
  assert.equal(result.kind, 'ok');
  if (result.kind !== 'ok') return;
  assert.equal(result.refuels, 1);
  assert.equal(result.latest.distanceKm, 400);
  assert.equal(result.latest.dropPercent, 50);
  assert.equal(result.latest.used, 40);
  assert.equal(result.latest.economy, 10);
  assert.equal(result.average, 10);
});

test('missing tank capacity → empty "noCapacity", even with a usable history (capacity is never invented)', () => {
  for (const capacity of [null, 0, -1]) {
    const result = estimateFromHistory(cycle, capacity, 'fuel');
    assert.deepEqual(result, { kind: 'empty', reason: 'noCapacity', points: 4, refuels: 1 });
  }
});

test('too few points, or no refuel in the history → empty "notEnough"', () => {
  assert.equal(estimateFromHistory([], 80, 'fuel').kind, 'empty');
  assert.deepEqual(estimateFromHistory([p(1, 50, 12345)], 80, 'fuel'), { kind: 'empty', reason: 'notEnough', points: 1, refuels: 0 });
  // A steady drain with no refuel: no stretch starts at a refuel.
  assert.deepEqual(estimateFromHistory([p(1, 80, 12345), p(3, 40, 12745)], 80, 'fuel'), { kind: 'empty', reason: 'notEnough', points: 2, refuels: 0 });
  // A refuel as the very last reading: nothing driven after it yet.
  assert.equal(estimateFromHistory([p(1, 30, 12345), p(2, 80, 12345)], 80, 'fuel').kind, 'empty');
  // Readings without odometer or level are not points.
  assert.equal(estimateFromHistory(cycle.map(x => ({ ...x, odometerKm: null })), 80, 'fuel').kind, 'empty');
});

test('a sensor wiggle below the jump threshold is not a refuel; a clear jump is', () => {
  const wiggle = [p(1, 50, 12345), p(2, 57, 12345), p(4, 30, 12745)];
  assert.equal(estimateFromHistory(wiggle, 80, 'fuel').refuels, 0);
  assert.equal(estimateFromHistory(wiggle, 80, 'fuel').kind, 'empty');
  const jump = [p(1, 50, 12345), p(2, 58, 12345), p(4, 30, 12745)];
  assert.equal(estimateFromHistory(jump, 80, 'fuel').refuels, 1);
  // Wiggles inside a stretch net out: 80 → 62 → 65 (+3) → 30 is a 50-point drop.
  const inside = [p(1, 30, 12345), p(2, 80, 12345), p(3, 62, 12500), p(4, 65, 12510), p(6, 30, 12745)];
  const result = estimateFromHistory(inside, 80, 'fuel');
  assert.equal(result.kind === 'ok' && result.latest.economy, 10);
});

test('short or shallow stretches and a backwards odometer are left out, never guessed', () => {
  // Drop 5 points only.
  assert.equal(estimateFromHistory([p(1, 30, 12345), p(2, 80, 12345), p(3, 75, 12445)], 80, 'fuel').kind, 'empty');
  // 40 km only.
  assert.equal(estimateFromHistory([p(1, 30, 12345), p(2, 80, 12345), p(3, 60, 12385)], 80, 'fuel').kind, 'empty');
  // Odometer runs backwards.
  assert.equal(estimateFromHistory([p(1, 30, 12345), p(2, 80, 12345), p(3, 60, 12300), p(4, 30, 12745)], 80, 'fuel').kind, 'empty');
});

test('two refuels: each stretch ends just before the next refuel; average is distance-weighted', () => {
  const history = [...cycle, p(7, 90, 12745), p(9, 40, 13345)]; // 600 km on 50 % of 80 L = 40 L → 15 km/L
  const result = estimateFromHistory(history, 80, 'fuel');
  assert.equal(result.kind, 'ok');
  if (result.kind !== 'ok') return;
  assert.equal(result.stretches.length, 2);
  assert.equal(result.stretches[0].economy, 10);
  assert.equal(result.latest.economy, 15);
  assert.equal(result.average, 1000 / 80);
});

test('EV: state of charge and battery kWh; fuel readings are ignored', () => {
  const ev = [p(1, null, 4000, 20), p(2, null, 4000, 90), p(5, null, 4250, 40)]; // 250 km on 50 % of 100 kWh → 5 km/kWh
  const result = estimateFromHistory(ev, 100, 'electric');
  assert.equal(result.kind === 'ok' && result.latest.economy, 5);
  assert.equal(estimateFromHistory(ev, 100, 'fuel').kind, 'empty');
});

test('parseHistory: oldest first, malformed points dropped, malformed envelope throws, out-of-range values null', () => {
  const points = parseHistory({ vehicleId: 'range-l460', points: [
    { fetchedAt: '2026-01-03T00:00:00Z', fuelPercent: 60, socPercent: null, odometerKm: 12505 },
    { fetchedAt: '2026-01-01T00:00:00Z', fuelPercent: 130, socPercent: null, odometerKm: 12345 },
    { fetchedAt: 'yesterday', fuelPercent: 50, odometerKm: 1 },
    null, 5,
  ] });
  assert.deepEqual(points.map(x => x.fetchedAt), ['2026-01-01T00:00:00.000Z', '2026-01-03T00:00:00.000Z']);
  assert.equal(points[0].fuelPercent, null);
  for (const bad of [null, {}, { points: 'x' }, []]) assert.throws(() => parseHistory(bad));
});
