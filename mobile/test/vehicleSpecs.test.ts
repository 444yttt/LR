// Vehicle specs: storage document parsing and the display-name rules. Values are obviously fake TEST DATA ONLY
// ("Test Trim", "V6", "2020", "Test Audio"); they are not any real vehicle's specs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VEHICLES } from '../src/garageModel.ts';
import {
  SPECS_VERSION, cardName, cardNameWidth, displayName, emptySpecs, isEmptySpecs, modelLine, normalizeSpecs, parseSpecs,
  serializeSpecs, specsFor, textWidth, titleSize, withSpecs, type VehicleSpecs,
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
  assert.equal(specs.engine.length, 40);
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
});

test('Garage card name: composed when it fits beside the chevron, otherwise the base name', () => {
  for (const vehicle of VEHICLES) {
    assert.equal(cardName(vehicle, emptySpecs), vehicle.name);
    assert.equal(cardName(vehicle, fake), vehicle.name + ' Test Trim V6');
    assert.ok(textWidth(cardName(vehicle, fake), 20 * 1.15) <= cardNameWidth);
    const long = { ...fake, grade: 'Test Trim With A Very Long Name', engine: 'V6 Test Hybrid' };
    assert.equal(cardName(vehicle, long), vehicle.name);
  }
});

test('detail title size: 31pt when the name fits, stepping down for long names, never below 22pt', () => {
  assert.equal(titleSize(VEHICLES[0].name), 31);
  assert.equal(titleSize(displayName(VEHICLES[0].name, { ...emptySpecs, engine: 'V6' })), 31);
  const longer = titleSize(displayName(VEHICLES[0].name, fake));
  assert.ok(longer < 31 && longer >= 22);
  assert.ok(textWidth(displayName(VEHICLES[0].name, fake), longer) <= 346);
  assert.equal(titleSize('W'.repeat(80)), 22);
});
