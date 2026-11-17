// GET /v1/vehicles → app snapshots. Values are #19's documented SYNTHETIC fixtures (cloudflare/src/local-vehicles.js:
// X7 645 km / 73 % fuel, S e-tron GT 329 km / 68 % SOC) and made-up Range Rover numbers. Not OEM telemetry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { API_TO_APP, APP_TO_API, JLR_VEHICLE, parseVehicleList, readVehicles, requestVehicles } from '../src/gatewayVehicles.ts';
import { VEHICLES, connectionState, healthView, metrics, routeFromUrl, vehicleFeeds, type GarageInput } from '../src/garageModel.ts';

const now = Date.parse('2026-11-17T09:00:00Z');
const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
const entry = (extra: Record<string, unknown>) => ({
  status: 'fresh', lastDriveVerified: true, lastDriveTrust: 'owner-approved-unverified', health: 'good', connection: 'connected', ...extra,
});
/** The gateway's response shape (cloudflare/mobile-gateway: vehicleList). */
const payload = {
  generatedAt: ago(0),
  vehicles: [
    entry({ id: 'range-l460', source: 'jlr', fetchedAt: ago(60), lastDriveAt: ago(600), rangeKm: 500, fuelPercent: 60, electricRangeKm: null, socPercent: null, modelYear: null, trips: [ago(600)] }),
    entry({ id: 'bmw-x7', make: 'BMW', model: 'X7', modelYear: 2026, displayName: 'BMW X7', source: 'local', fetchedAt: ago(22), lastDriveAt: ago(2 * 1440),
      rangeKm: 645, fuelPercent: 73, electricRangeKm: null, socPercent: null, trips: [ago(2 * 1440)] }),
    entry({ id: 'audi-s-etron-gt', make: 'Audi', model: 'S e-tron GT', modelYear: 2026, displayName: 'Audi S e-tron GT', source: 'local', fetchedAt: ago(34), lastDriveAt: ago(4 * 1440),
      rangeKm: 329, fuelPercent: null, electricRangeKm: 329, socPercent: 68, trips: [ago(4 * 1440)] }),
  ],
};
const live: GarageInput = { phase: 'ready', snapshot: null, hasSession: true, discoveryFailed: false, lastSyncedAt: now - 60_000 };

test('ids map explicitly between the gateway (D1) and the app, both ways; nothing else maps', () => {
  assert.deepEqual(API_TO_APP, { 'range-l460': 'range-rover', 'bmw-x7': 'bmw-x7', 'audi-s-etron-gt': 'audi-s-etron-gt' });
  assert.deepEqual(APP_TO_API, { 'range-rover': 'range-l460', 'bmw-x7': 'bmw-x7', 'audi-s-etron-gt': 'audi-s-etron-gt' });
  assert.equal(JLR_VEHICLE, 'range-rover');
  assert.equal((APP_TO_API as Record<string, string | undefined>)['ferrari-296'], undefined);
  for (const id of Object.values(API_TO_APP)) assert.ok(VEHICLES.some(vehicle => vehicle.id === id && vehicle.connected), id);
  // Same ids as #19's fixture table and the gateway.
  const local = readFileSync(new URL('../../cloudflare/src/local-vehicles.js', import.meta.url), 'utf8');
  assert.match(local, /LOCAL_VEHICLE_IDS = Object\.freeze\(\['bmw-x7', 'audi-s-etron-gt'\]\)/);
});

test('parses the list into one snapshot per app vehicle; EV keeps SOC and no fuel, ICE keeps fuel and no SOC', () => {
  const snapshots = parseVehicleList(payload);
  assert.deepEqual(Object.keys(snapshots), ['range-rover', 'bmw-x7', 'audi-s-etron-gt']);
  const x7 = snapshots['bmw-x7']!, etron = snapshots['audi-s-etron-gt']!;
  assert.deepEqual([x7.rangeKm, x7.fuelPercent, x7.socPercent, x7.electricRangeKm, x7.modelYear], [645, 73, null, null, 2026]);
  assert.deepEqual([etron.rangeKm, etron.fuelPercent, etron.socPercent, etron.electricRangeKm, etron.modelYear], [329, null, 68, 329, 2026]);
  assert.equal(snapshots['range-rover']!.rangeKm, 500);
  assert.equal(snapshots['range-rover']!.modelYear, null);
  // Unknown ids, broken rows and duplicates are skipped; a broken envelope throws.
  const odd = parseVehicleList({ vehicles: [{ id: 'ferrari-296', status: 'fresh' }, { id: 'bmw-x7', status: 'nope' }, null, payload.vehicles[2], { ...payload.vehicles[2], rangeKm: 1 }] });
  assert.deepEqual(Object.keys(odd), ['audi-s-etron-gt']);
  assert.equal(odd['audi-s-etron-gt']!.rangeKm, 329);
  assert.throws(() => parseVehicleList({}));
  assert.throws(() => parseVehicleList(null));
});

test('X7 and S e-tron GT present as connected with their gateway values; Ferrari stays offline', () => {
  const feeds = vehicleFeeds(live, null, parseVehicleList(payload));
  const view = (i: number) => ({ connection: connectionState(feeds[i]!, now, i), metrics: metrics(feeds[i], now), health: healthView(i, feeds[i], now) });
  const x7 = view(1), etron = view(2);
  for (const v of [x7, etron]) {
    assert.equal(v.connection.kind, 'fresh');
    assert.equal(v.connection.title, 'Connected');
    assert.match(v.connection.status, /^Updated \d+ min ago$/);
    assert.equal(v.health.title, 'No reported issues');
    assert.ok(!/demo|mock|sample|setup|not connected/i.test(JSON.stringify(v)), JSON.stringify(v));
  }
  assert.deepEqual([x7.metrics.rangeKm, x7.metrics.level], [645, { label: 'Fuel', percent: 73 }]);
  assert.deepEqual([etron.metrics.rangeKm, etron.metrics.level, etron.metrics.fuelPercent], [329, { label: 'Battery', percent: 68 }, null]);
  assert.equal(x7.metrics.idleDays, 2);
  assert.equal(etron.metrics.idleDays, 4);
  assert.equal(feeds[3], null);
  assert.equal(healthView(3, feeds[3], now).title, 'Not connected');
  assert.equal(VEHICLES[3].offlineStatus, 'Not connected');
  // The Range Rover is unchanged by the list: same values as through /v1/range-rover.
  assert.deepEqual(metrics(feeds[0], now).level, { label: 'Fuel', percent: 60 });
});

test('deep links reach every vehicle by its app id', () => {
  VEHICLES.forEach((vehicle, i) => assert.deepEqual(routeFromUrl('garage-monitor://vehicle/' + vehicle.id), { name: 'vehicle', vehicle: i }));
  assert.equal(routeFromUrl('garage-monitor://vehicle/range-l460'), null, 'API ids are not app routes');
});

test('reads /v1/vehicles; falls back to /v1/range-rover only on 404 (gateway not redeployed yet)', async () => {
  const calls: string[] = [];
  const gateway = (status: Record<string, number>) => async (path: string) => {
    calls.push(path);
    return new Response(JSON.stringify(path === '/v1/vehicles' ? payload : payload.vehicles[0]), { status: status[path] ?? 200 });
  };
  let result = await requestVehicles(gateway({}));
  assert.deepEqual([calls, result.legacy], [['/v1/vehicles'], false]);
  assert.deepEqual(Object.keys(readVehicles(await result.response.json(), result.legacy)), ['range-rover', 'bmw-x7', 'audi-s-etron-gt']);
  calls.length = 0;
  result = await requestVehicles(gateway({ '/v1/vehicles': 404 }));
  assert.deepEqual([calls, result.legacy], [['/v1/vehicles', '/v1/range-rover'], true]);
  const legacy = readVehicles(await result.response.json(), true);
  assert.deepEqual(Object.keys(legacy), ['range-rover']);
  assert.equal(legacy['range-rover']!.rangeKm, 500);
  // 401 / 503 are the caller's to handle; no second request.
  for (const status of [401, 503]) {
    calls.length = 0;
    result = await requestVehicles(gateway({ '/v1/vehicles': status }));
    assert.deepEqual([calls, result.response.status], [['/v1/vehicles'], status]);
  }
});
