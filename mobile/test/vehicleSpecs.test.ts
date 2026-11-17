// Vehicle specs: storage document parsing and the display-name rules. Values are obviously fake TEST DATA ONLY
// ("Test Trim", "V6", "2020", "Test Audio"); they are not any real vehicle's specs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VEHICLES } from '../src/garageModel.ts';
import { VEHICLE_IDS } from '../src/vehicleSpecs.ts';
import {
  SPECS_VERSION, cardName, cardNameWidth, displayName, emptySpecs, isEmptySpecs, modelLine, normalizeSpecs, parseSpecs,
  serializeSpecs, specLimits, specsFor, textWidth, titleLayout, titleWidth, headerLimit, withSpecs, type VehicleSpecs,
} from '../src/vehicleSpecs.ts';

const fake: VehicleSpecs = { grade: 'Test Trim', engine: 'V6', year: '2020', options: ['Test Audio', 'Test Wheels'] };
const doc = (vehicles: unknown, version: unknown = SPECS_VERSION) => JSON.stringify({ version, vehicles });

test('parse: missing, empty, corrupt, wrong-version and wrong-shape storage is empty specs, never a throw', () => {
  for (const raw of [null, undefined, '', '{', 'not json', 'null', '42', '"text"', '[]', '{}',
    doc({ 'range-rover': fake }, 2), doc({ 'range-rover': fake }, '1'), doc(null), doc([fake]), doc('x')]) {
    assert.deepEqual(parseSpecs(raw as string | null), {}, String(raw));
  }
});

test('parse: missing keys and wrong types become empty fields; unknown vehicles and keys are dropped', () => {
  const map = parseSpecs(doc({
    'range-rover': { grade: 'Test Trim' },
    'ferrari-296': { engine: 7, year: null, options: 'Test Audio', extra: 'x' },
    'bmw-x7': { options: ['  Test   Audio ', '', 3, '   '] },
    'unknown-car': fake,
  }));
  assert.deepEqual(map['range-rover'], { grade: 'Test Trim', engine: '', year: '', options: [] });
  // Every field invalid → nothing entered → no entry at all.
  assert.equal(map['ferrari-296'], undefined);
  assert.deepEqual(map['bmw-x7'], { grade: '', engine: '', year: '', options: ['Test Audio'] });
  assert.deepEqual(Object.keys(map).sort(), ['bmw-x7', 'range-rover']);
});

test('serialize → parse round-trips, keyed by vehicle id (not position), versioned, empty vehicles omitted', () => {
  const map = { 'bmw-x7': fake, 'range-rover': { ...emptySpecs } };
  const raw = serializeSpecs(map);
  const stored = JSON.parse(raw);
  assert.equal(stored.version, SPECS_VERSION);
  assert.deepEqual(Object.keys(stored.vehicles), ['bmw-x7']);
  assert.deepEqual(parseSpecs(raw), { 'bmw-x7': fake });
  assert.deepEqual(specsFor(parseSpecs(raw), 'range-rover'), emptySpecs);
});

test('normalise: trims, collapses whitespace and newlines, caps lengths and option count', () => {
  const specs = normalizeSpecs({ grade: '  Test \n Trim  ', engine: 'V6'.repeat(40), year: ' 2020 ', options: Array.from({ length: 40 }, (_, i) => ' Test Audio ' + i) });
  assert.equal(specs.grade, 'Test Trim');
  assert.equal(specs.engine.length, specLimits.engine);
  assert.equal(specs.year, '2020');
  assert.equal(specs.options.length, 30);
  assert.equal(specs.options[0], 'Test Audio 0');
  assert.ok(isEmptySpecs(normalizeSpecs({ grade: '   ', options: ['', '  '] })));
});

test('withSpecs replaces one vehicle and removes it when cleared', () => {
  let map = withSpecs({}, 'ferrari-296', fake);
  map = withSpecs(map, 'range-rover', { ...emptySpecs, year: '2020' });
  assert.deepEqual(Object.keys(map).sort(), ['ferrari-296', 'range-rover']);
  map = withSpecs(map, 'ferrari-296', { grade: ' ', engine: '', year: '', options: [' '] });
  assert.deepEqual(Object.keys(map), ['range-rover']);
});

test('display name: base name plus whatever of grade and engine was entered; empty fields add no tokens', () => {
  const base = VEHICLES[0].name;
  assert.equal(displayName(base, emptySpecs), base);
  assert.equal(displayName(base, { ...emptySpecs, grade: 'Test Trim' }), base + ' Test Trim');
  assert.equal(displayName(base, { ...emptySpecs, engine: 'V6' }), base + ' V6');
  assert.equal(displayName(base, fake), base + ' Test Trim V6');
  // Whitespace-only values (e.g. from an older document) still add nothing; never double spaces or trailing spaces.
  assert.equal(displayName(base, { ...emptySpecs, grade: '   ', engine: ' V6 ' }), base + ' V6');
  assert.doesNotMatch(displayName(base, { ...emptySpecs, grade: ' ' }), /\s{2}|\s$/);
  // Year and options never join the name.
  assert.equal(displayName(base, { ...emptySpecs, year: '2020', options: ['Test Audio'] }), base);
});

test('model line: the existing model, plus " · year" only when a year was entered', () => {
  const model = VEHICLES[0].model;
  assert.equal(modelLine(model, emptySpecs), model);
  assert.equal(modelLine(model, { ...emptySpecs, year: '2020' }), model + ' · 2020');
  assert.equal(modelLine(model, { ...fake, year: '  ' }), model);
  // A model year reported by the vehicle's gateway row shows only when the owner entered none; the owner's wins.
  assert.equal(modelLine(model, emptySpecs, 2026), model + ' · 2026');
  assert.equal(modelLine(model, { ...emptySpecs, year: '2020' }, 2026), model + ' · 2020');
  assert.equal(modelLine(model, emptySpecs, null), model);
});

test('Garage card name: composed when it fits beside the chevron, otherwise the base name', () => {
  for (const vehicle of VEHICLES) {
    assert.equal(cardName(vehicle, emptySpecs), vehicle.name);
    // "Audi S e-tron GT Test Trim V6" is wider than the card line at the Dynamic Type cap: the card keeps the base name.
    const fits = vehicle.id !== 'audi-s-etron-gt';
    assert.equal(cardName(vehicle, fake), fits ? vehicle.name + ' Test Trim V6' : vehicle.name, vehicle.id);
    assert.ok(textWidth(cardName(vehicle, fake), 20 * 1.15) <= cardNameWidth);
    const long = { ...fake, grade: 'Test Trim With Long Name', engine: 'V6 Test Hybrid' };
    assert.equal(cardName(vehicle, long), vehicle.name);
  }
});

test('detail header: 31pt for names that fit; long names step down, then wrap to two lines, always above the hero stage', () => {
  const base = VEHICLES[0].name;
  assert.deepEqual(titleLayout(base), { size: 31, lines: 1, top: 105, modelTop: 145, statusTop: 170 });
  assert.equal(titleLayout(displayName(base, { ...emptySpecs, engine: 'V6' })).size, 31);
  const medium = titleLayout(displayName(base, fake));
  assert.ok(medium.lines === 1 && medium.size < 31 && medium.size >= 22);
  assert.ok(textWidth(displayName(base, fake), medium.size) <= titleWidth);
  // The longest names the form allows, in wide letters, at the Dynamic Type canvas cap.
  const longest = { ...emptySpecs, grade: 'W'.repeat(specLimits.grade), engine: 'M'.repeat(specLimits.engine) };
  for (const vehicle of VEHICLES) {
    for (const scale of [1, 1.15, 2]) {
      const layout = titleLayout(displayName(vehicle.name, longest), scale);
      assert.equal(layout.lines, 2);
      assert.ok(layout.size >= 17 && layout.size <= 22);
      assert.ok(layout.modelTop >= 145 && layout.statusTop >= layout.modelTop + 25);
      // Status line (10pt) ends above the hero stage even at the cap.
      assert.ok(layout.statusTop + 10 * 1.21 * 1.15 <= headerLimit, String(layout.statusTop));
    }
  }
});

test('specs allow-list is exactly the VEHICLES ids, Audi included; empty specs stay empty for every vehicle', () => {
  assert.deepEqual(VEHICLE_IDS, VEHICLES.map(vehicle => vehicle.id));
  const raw = doc({ 'audi-s-etron-gt': { grade: 'Test Trim' }, 'audi-s-etron': { grade: 'x' } });
  assert.deepEqual(Object.keys(parseSpecs(raw)), ['audi-s-etron-gt']);
  for (const vehicle of VEHICLES) assert.equal(specsFor(parseSpecs(null), vehicle.id), emptySpecs);
});
