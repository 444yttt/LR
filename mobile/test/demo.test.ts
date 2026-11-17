// Demo fixtures must stay out of production: the gate, the per-vehicle feed selection, and the import graph.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { VEHICLES, connectionState, drivesView, healthView, metrics, vehicleFeeds, type GarageInput } from '../src/garageModel.ts';
import { DEMO_SCENARIOS, demoFeed, demoFeeds, parseScenario } from '../src/demo/fixtures.ts';

const now = Date.parse('2026-11-14T03:00:00Z');
const live: GarageInput = { phase: 'ready', snapshot: null, hasSession: true, discoveryFailed: false, lastSyncedAt: null };
const root = new URL('..', import.meta.url).pathname;

const app = readFileSync(join(root, 'App.tsx'), 'utf8');
/** The exact gate expression App.tsx uses, evaluated against a stub environment. */
function gate(value: string | undefined): boolean {
  const match = /const Demo[^=]*=\s*([^?]+)\?\s*require\('\.\/src\/demo\/DemoApp'\)/.exec(app);
  assert.ok(match, 'App.tsx gate not found');
  return new Function('process', 'return (' + match[1] + ');')({ env: value === undefined ? {} : { EXPO_PUBLIC_DEMO_DATA: value } });
}

test('demo data is enabled only by EXPO_PUBLIC_DEMO_DATA=1, as a build-time constant comparison', () => {
  assert.equal(gate('1'), true);
  for (const value of [undefined, '', '0', 'true', 'yes', ' 1', 'demo', '01']) assert.equal(gate(value), false, String(value));
  // Written out in full so Expo inlines it and Metro drops the require from production bundles.
  assert.match(app, /process\.env\.EXPO_PUBLIC_DEMO_DATA === '1'\s*\?\s*require\('\.\/src\/demo\/DemoApp'\)\.DemoApp/);
});

test('production feeds: Range Rover, BMW X7 and Audi S e-tron GT read the gateway; Ferrari 296 has none', () => {
  assert.deepEqual(VEHICLES.map(vehicle => vehicle.name), ['Range Rover', 'BMW X7', 'Audi S e-tron GT', 'Ferrari 296']);
  assert.deepEqual(VEHICLES.map(vehicle => vehicle.connected), [true, true, true, false]);
  const feeds = vehicleFeeds(live, null);
  assert.deepEqual(feeds[0], live);
  // Connected, but nothing received from the gateway yet: no values, never fixtures.
  for (const i of [1, 2]) {
    assert.deepEqual(feeds[i], { ...live, snapshot: null });
    assert.equal(connectionState(feeds[i]!, now, i).kind, 'notFetched');
  }
  assert.equal(feeds[3], null);
  // With no feed the screens fall back to the offline copy and blank metrics, whatever fixtures exist.
  assert.equal(healthView(3, feeds[3], now).title, 'Not connected');
  assert.deepEqual(metrics(feeds[3], now), { rangeKm: null, fuelPercent: null, batteryPercent: null, level: { label: 'Fuel', percent: null }, lastDrive: null, idleDays: null });
  assert.ok(feeds.every(feed => !feed?.demo));
});

test('demo feeds cover every vehicle in every state and are always flagged as demo', () => {
  const expected = { live: 'fresh', requesting: 'fresh', rateLimited: 'fresh', refreshFailed: 'fresh', loading: 'connecting', notFetched: 'notFetched', updateFailed: 'updateFailed', authExpired: 'authExpired', empty: 'fresh' };
  for (const scenario of DEMO_SCENARIOS) {
    const feeds = vehicleFeeds(live, demoFeeds(scenario, now));
    assert.equal(feeds.length, VEHICLES.length);
    feeds.forEach((feed, vehicle) => {
      assert.ok(feed?.demo, `${scenario} ${vehicle}`);
      assert.equal(connectionState(feed!, now, vehicle).kind, expected[scenario], `${scenario} ${vehicle}`);
    });
  }
  assert.equal(drivesView(demoFeed(3, 'live', now), now).kind, 'list');
  assert.equal(drivesView(demoFeed(1, 'empty', now), now).kind, 'empty');
  assert.equal(metrics(demoFeed(1, 'live', now), now).rangeKm, 655);
  assert.deepEqual(metrics(demoFeed(2, 'live', now), now).level, { label: 'Battery', percent: 71 });
  assert.equal(metrics(demoFeed(3, 'empty', now), now).rangeKm, null);
  assert.equal(parseScenario('updateFailed'), 'updateFailed');
  assert.equal(parseScenario('bogus'), 'live');
});

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

test('only the demo entry point imports the fixtures, and App loads it only behind the gate', () => {
  const offenders = [...sources(join(root, 'src')), join(root, 'App.tsx')]
    .filter(path => !relative(root, path).startsWith('src/demo/'))
    .filter(path => /demo\/(fixtures|DemoApp)/.test(readFileSync(path, 'utf8')))
    .map(path => relative(root, path));
  assert.deepEqual(offenders, ['App.tsx']);
  assert.doesNotMatch(app, /^import .*demo\//m);
});

test('fixtures carry no identifiers or locations', () => {
  const text = readFileSync(join(root, 'src/demo/fixtures.ts'), 'utf8').split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(text, /\b[A-HJ-NPR-Z0-9]{17}\b/, 'VIN-like string');
  assert.doesNotMatch(text, /latitude|longitude|\blat\b|\blng\b|address|vin\b/i);
});
