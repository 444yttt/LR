import test from 'node:test';
import assert from 'node:assert/strict';
import { localVehicleRows, combineVehicleRows } from '../src/local-vehicles.js';

const NOW = Date.parse('2026-11-17T07:00:00Z');
const RANGE_D1_COLUMNS = [
  'id', 'make', 'model', 'model_year', 'display_name', 'enabled',
  'source', 'connection_status', 'last_drive_at', 'last_drive_verified', 'fetched_at',
  'data_status', 'range_km', 'electric_range_km', 'fuel_percent',
  'soc_percent', 'battery_12v_voltage', 'health_status', 'faults_count',
  'odometer_km', 'status_updated_at', 'health_updated_at',
  'maintenance_due_count'
].sort();

test('BMW X7 and Audi S e-tron GT have exactly the JLR API row shape', () => {
  const rows = localVehicleRows(NOW);
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), RANGE_D1_COLUMNS);
    assert.equal(row.enabled, 1);
    assert.equal(row.source, 'local');
    assert.equal(row.last_drive_verified, 0);
    assert.equal(row.data_status, 'fresh');
    assert.equal(row.connection_status, 'connected');
    assert.equal(row.health_status, 'good');
    assert.ok(Date.parse(row.last_drive_at) < NOW);
    assert.ok(Date.parse(row.fetched_at) <= NOW);
    assert.ok(!Object.hasOwn(row, 'demo'));
    assert.ok(!Object.hasOwn(row, 'is_mock'));
  }
  assert.equal(rows[0].model, 'X7');
  assert.equal(rows[0].fuel_percent, 73);
  assert.equal(rows[0].soc_percent, null);
  assert.equal(rows[1].model, 'S e-tron GT');
  assert.equal(rows[1].fuel_percent, null);
  assert.equal(rows[1].soc_percent, 68);
});

test('Range Rover row is unchanged and first, with both local vehicles appended', () => {
  const jlr = {
    id: 'range-l460', make: 'Land Rover', model: 'Range Rover',
    last_drive_at: '2026-11-08T06:00:29.000Z',
    source: 'jlr', data_status: 'fresh', fetched_at: '2026-11-17T06:50:00Z', enabled: 1
  };
  const combined = combineVehicleRows([jlr], NOW);
  assert.equal(combined.length, 3);
  assert.deepEqual(combined[0], {...jlr, connection_status: 'connected'});
  assert.deepEqual(combined.map(v => v.id), [
    'range-l460', 'bmw-x7', 'audi-s-etron-gt'
  ]);
});

test('Real OEM-backed row supersedes local row without duplicates', () => {
  const oemX7 = { id: 'bmw-x7', source: 'bmw', range_km: 520 };
  const combined = combineVehicleRows([oemX7], NOW);
  assert.equal(combined.filter(v => v.id === 'bmw-x7').length, 1);
  assert.deepEqual(combined[0], {...oemX7, connection_status: 'disconnected'});
});

test('No input mutation and invalid inputs rejected', () => {
  const oem = [{ id: 'range-l460' }];
  combineVehicleRows(oem, NOW);
  assert.deepEqual(oem, [{ id: 'range-l460' }]);
  assert.throws(() => combineVehicleRows(null, NOW), TypeError);
  assert.throws(() => localVehicleRows(Number.NaN), TypeError);
});

test('Fixture timestamps are ISO and deterministic given an injected clock', () => {
  assert.deepEqual(localVehicleRows(NOW), localVehicleRows(NOW));
  const newSample = localVehicleRows(NOW + 60_000);
  assert.notEqual(newSample[0].fetched_at, localVehicleRows(NOW)[0].fetched_at);
});

test('Connection status is explicit for both OEM and fixture rows', () => {
  const current = combineVehicleRows([{id:'range-l460',enabled:1,fetched_at:'2026-11-17T06:00:00Z',data_status:'fresh'}], NOW);
  assert.equal(current[0].connection_status,'connected');
  assert.equal(current[1].connection_status,'connected');
  assert.equal(current[2].connection_status,'connected');
  const stale = combineVehicleRows([{id:'range-l460',enabled:1,fetched_at:null,data_status:'error'}], NOW);
  assert.equal(stale[0].connection_status,'disconnected');
});
