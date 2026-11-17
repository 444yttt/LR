// Refuel log + full-tank economy. Every value is obviously fake TEST DATA ONLY (odometer 12345, 42.0 L, "¥1000"); none
// is any real vehicle's odometer, fuel or tank.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VEHICLES } from '../src/garageModel.ts';
import {
  FUEL_LOG_VERSION, amountUnit, convertEconomy, energyOf, entryFromDraft, formatEconomy, logEconomy, logFor, newEntryId, normalizeEntry,
  parseDecimal, parseFuelLog, parseUnit, serializeFuelLog, sortLog, todayJst, unitLabel, unitPrice, withEntry, withoutEntry, type RefuelEntry,
} from '../src/fuelLog.ts';

const e = (id: string, date: string, odometerKm: number, amount: number, full = true, price: number | null = null): RefuelEntry =>
  ({ id, date, odometerKm, amount, full, price });
const doc = (vehicles: unknown, version: unknown = FUEL_LOG_VERSION) => JSON.stringify({ version, vehicles });

test('parse: missing, corrupt, wrong-version and wrong-shape storage is an empty log, never a throw', () => {
  for (const raw of [null, undefined, '', '{', 'not json', 'null', '42', '"x"', '[]', '{}', doc({ 'bmw-x7': [e('a', '2026-01-01', 12345, 42)] }, 2),
    doc(null), doc([1]), doc('x'), doc({ 'bmw-x7': 'x' }), doc({ 'bmw-x7': {} })]) {
    assert.deepEqual(parseFuelLog(raw as string | null), {}, String(raw));
  }
});

test('parse: malformed entries and unknown vehicles are dropped; missing keys default only where safe', () => {
  const map = parseFuelLog(doc({
    'range-rover': [
      e('a', '2026-01-01', 12345, 42),
      { id: 'b', date: '2026-01-02', odometerKm: 12500, amount: 40 },             // no price / full → null / full
      { id: 'c', date: '2026-02-30', odometerKm: 12600, amount: 40 },             // not a real day
      { id: 'd', date: '2026-01-03', odometerKm: -1, amount: 40 },                // negative odometer
      { id: 'e', date: '2026-01-03', odometerKm: 12700, amount: 0 },              // zero amount
      { id: 'f', date: '2026-01-03', amount: 40 },                                // missing odometer
      { date: '2026-01-03', odometerKm: 12700, amount: 40 },                      // missing id
      { id: 'a', date: '2026-01-09', odometerKm: 13000, amount: 40 },             // duplicate id
      { id: 'g', date: '2026-01-04', odometerKm: 12800, amount: '40' },           // string amount
      { id: 'h', date: '2026-01-05', odometerKm: 12900, amount: 30, price: 'x', full: false },
    ],
    'unknown-car': [e('z', '2026-01-01', 1, 1)],
  }));
  assert.deepEqual(Object.keys(map), ['range-rover']);
  assert.deepEqual(map['range-rover']!.map(x => x.id), ['a', 'b', 'h']);
  assert.deepEqual(map['range-rover']![1], { id: 'b', date: '2026-01-02', odometerKm: 12500, amount: 40, price: null, full: true });
  // An invalid price is dropped, not the entry.
  assert.deepEqual(map['range-rover']![2], { id: 'h', date: '2026-01-05', odometerKm: 12900, amount: 30, price: null, full: false });
});

test('serialize → parse round-trips per vehicle id; vehicles are isolated', () => {
  let map = withEntry({}, 'bmw-x7', e('a', '2026-01-01', 12345, 42, true, 7000));
  map = withEntry(map, 'audi-s-etron-gt', e('b', '2026-01-02', 4000, 55.5));
  const stored = JSON.parse(serializeFuelLog(map));
  assert.equal(stored.version, FUEL_LOG_VERSION);
  assert.deepEqual(Object.keys(stored.vehicles).sort(), ['audi-s-etron-gt', 'bmw-x7']);
  const back = parseFuelLog(serializeFuelLog(map));
  assert.deepEqual(back, map);
  assert.deepEqual(logFor(back, 'range-rover'), []);
  assert.deepEqual(logFor(back, 'ferrari-296'), []);
  // Removing from one vehicle leaves the other untouched; an emptied vehicle disappears.
  const removed = withoutEntry(back, 'bmw-x7', 'a');
  assert.deepEqual(Object.keys(removed), ['audi-s-etron-gt']);
  assert.deepEqual(removed['audi-s-etron-gt'], back['audi-s-etron-gt']);
});

test('withEntry replaces by id, keeps log order, and ignores invalid entries', () => {
  let map = withEntry({}, 'range-rover', e('b', '2026-01-05', 12800, 40));
  map = withEntry(map, 'range-rover', e('a', '2026-01-01', 12345, 42));
  assert.deepEqual(logFor(map, 'range-rover').map(x => x.id), ['a', 'b']);
  map = withEntry(map, 'range-rover', e('a', '2026-01-01', 12345, 43));
  assert.equal(logFor(map, 'range-rover').length, 2);
  assert.equal(logFor(map, 'range-rover')[0].amount, 43);
  assert.equal(withEntry(map, 'range-rover', e('c', 'yesterday', 1, 1)), map);
  // Same day: odometer decides the order.
  assert.deepEqual(sortLog([e('x', '2026-01-01', 200, 1), e('y', '2026-01-01', 100, 1)]).map(x => x.id), ['y', 'x']);
});

test('full-tank method: km between consecutive full fills ÷ amount at the later fill', () => {
  // Fake: 12345 km → 12765 km on 42.0 L = 10.0 km/L; then 300 km on 25 L = 12.0 km/L.
  const log = [e('a', '2026-01-01', 12345, 60), e('b', '2026-01-10', 12765, 42), e('c', '2026-01-20', 13065, 25)];
  const result = logEconomy(log)!;
  assert.equal(result.segments.length, 2);
  assert.equal(result.segments[0].economy, 10);
  assert.equal(result.latest.economy, 12);
  assert.equal(result.latest.endId, 'c');
  // Distance-weighted: 720 km / 67 L, not the mean of 10 and 12.
  assert.ok(Math.abs(result.average - 720 / 67) < 1e-9);
});

test('too few entries: none, one, or only partial fills give no economy (nothing invented)', () => {
  assert.equal(logEconomy([]), null);
  assert.equal(logEconomy([e('a', '2026-01-01', 12345, 42)]), null);
  assert.equal(logEconomy([e('a', '2026-01-01', 12345, 42, false), e('b', '2026-01-05', 12800, 42, false)]), null);
  assert.equal(logEconomy([e('a', '2026-01-01', 12345, 42, false), e('b', '2026-01-05', 12800, 42, true)]), null);
});

test('partial fills: counted toward the next full fill; trailing partials wait; out-of-order odometers are skipped', () => {
  const log = [
    e('a', '2026-01-01', 12345, 50),
    e('b', '2026-01-05', 12545, 20, false),  // partial: its 20 L were burned before the next full fill
    e('c', '2026-01-10', 12845, 30),         // 500 km on 20 + 30 = 50 L → 10 km/L
    e('d', '2026-01-12', 12945, 10, false),  // trailing partial: no segment yet
  ];
  const result = logEconomy(log)!;
  assert.equal(result.segments.length, 1);
  assert.deepEqual({ km: result.latest.distanceKm, amount: result.latest.amount, economy: result.latest.economy }, { km: 500, amount: 50, economy: 10 });
  // A later full fill with a lower odometer (typo) yields no segment, and the next segment starts from it.
  const typo = logEconomy([e('a', '2026-01-01', 12345, 50), e('b', '2026-01-05', 12000, 40), e('c', '2026-01-09', 12400, 40)])!;
  assert.equal(typo.segments.length, 1);
  assert.equal(typo.latest.economy, 10);
});

test('EV path: kWh in, km/kWh and kWh/100 km out; energy from the table or from a charge-only report', () => {
  const etron = VEHICLES.findIndex(v => v.id === 'audi-s-etron-gt');
  assert.equal(energyOf(VEHICLES[etron], null), 'electric');
  assert.equal(energyOf(VEHICLES[0], null), 'fuel');
  assert.equal(energyOf(VEHICLES[0], { fuelPercent: null, socPercent: 50 }), 'electric');
  assert.equal(energyOf(VEHICLES[0], { fuelPercent: 50, socPercent: null }), 'fuel');
  assert.equal(amountUnit('electric'), 'kWh');
  // Fake: 4000 → 4250 km on 50 kWh = 5 km/kWh = 20 kWh/100 km.
  const result = logEconomy([e('a', '2026-01-01', 4000, 60), e('b', '2026-01-05', 4250, 50)])!;
  assert.equal(result.latest.economy, 5);
  assert.equal(formatEconomy(result.latest.economy, 'electric', 'perUnit'), '5.0 km/kWh');
  assert.equal(formatEconomy(result.latest.economy, 'electric', 'per100'), '20.0 kWh/100 km');
});

test('units: km/L is primary, L/100 km is 100 ÷ km/L; unknown is "—"', () => {
  assert.equal(unitLabel('fuel', 'perUnit'), 'km/L');
  assert.equal(unitLabel('fuel', 'per100'), 'L/100 km');
  assert.equal(unitLabel('electric', 'perUnit'), 'km/kWh');
  assert.equal(convertEconomy(10, 'perUnit'), 10);
  assert.equal(convertEconomy(10, 'per100'), 10);
  assert.equal(convertEconomy(12.5, 'per100'), 8);
  assert.equal(convertEconomy(8, 'per100'), 12.5);
  for (const bad of [0, -1, NaN, Infinity]) assert.equal(convertEconomy(bad, 'per100'), null);
  assert.equal(formatEconomy(null, 'fuel', 'perUnit'), '—');
  assert.equal(formatEconomy(12.345, 'fuel', 'perUnit'), '12.3 km/L');
  assert.equal(formatEconomy(12.5, 'fuel', 'per100'), '8.0 L/100 km');
  assert.equal(parseUnit(null), 'perUnit');
  assert.equal(parseUnit('per100'), 'per100');
  assert.equal(parseUnit('garbage'), 'perUnit');
});

test('entry form: validates every field, accepts decimal commas, rejects future days, price optional', () => {
  const ok = entryFromDraft({ date: '2026-01-10', amount: '42,0', odometer: '12,345', price: '', full: true }, 'id1', 'fuel', '2026-11-17');
  assert.deepEqual(ok, { entry: { id: 'id1', date: '2026-01-10', amount: 42, odometerKm: 12345, price: null, full: true }, errors: null });
  const priced = entryFromDraft({ date: '2026-01-10', amount: '42.0', odometer: '12345', price: '7000', full: false }, 'id2', 'fuel', '2026-11-17');
  assert.equal(priced.entry?.price, 7000);
  assert.equal(priced.entry?.full, false);
  assert.equal(unitPrice(priced.entry!), 7000 / 42);
  const bad = entryFromDraft({ date: '2026-13-01', amount: '', odometer: 'abc', price: '-3', full: true }, 'id3', 'fuel', '2026-11-17');
  assert.equal(bad.entry, null);
  assert.deepEqual(Object.keys(bad.errors!).sort(), ['amount', 'date', 'odometer', 'price']);
  assert.equal(entryFromDraft({ date: '2026-11-18', amount: '1', odometer: '1', price: '', full: true }, 'x', 'fuel', '2026-11-17').errors?.date, 'The date is in the future');
  assert.match(entryFromDraft({ date: '2026-01-01', amount: '0', odometer: '1', price: '', full: true }, 'x', 'electric', '2026-11-17').errors!.amount!, /kWh/);
  assert.equal(parseDecimal(''), null);
  assert.equal(parseDecimal('1,234.5'), 1234.5);
  assert.ok(Number.isNaN(parseDecimal('1.2.3')!));
});

test('helpers: JST day, ids are unique-ish and storage-safe, normalizeEntry rejects non-objects', () => {
  assert.equal(todayJst(Date.parse('2026-11-17T15:30:00Z')), '2026-11-18');
  assert.match(newEntryId(Date.now()), /^[a-z0-9]+-[a-z0-9]{6}$/);
  assert.notEqual(newEntryId(1, () => 0.1), newEntryId(1, () => 0.2));
  for (const bad of [null, 1, 'x', []]) assert.equal(normalizeEntry(bad), null);
});
