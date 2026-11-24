// WidgetSync inside the live Garage: writes the App Group snapshot on refresh, keeps it during launch restore, flags
// an expired sign-in, clears it on sign-out, and follows the opened vehicle. Values are SYNTHETIC TEST DATA ONLY.
import { useEffect } from 'react';
import { act, render } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GarageApp } from '../src/GarageApp';
import { parseVehicleList } from '../src/gatewayVehicles';
import type { Route } from '../src/garageModel';
import type { Data } from '../src/ui/parts';
import { useNav } from '../src/ui/stack';
import { WidgetSync } from '../src/widget';
import { WIDGET_SELECTION_KEY, WIDGET_SNAPSHOT_KEY, type WidgetStorage } from '../src/widgetSnapshot';

jest.mock('@bacons/apple-targets', () => ({
  ExtensionStorage: Object.assign(jest.fn().mockImplementation(() => ({ set: jest.fn(), remove: jest.fn() })), { reloadWidget: jest.fn() }),
}));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return {
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
    SafeAreaView: View,
    useSafeAreaInsets: () => ({ top: 62, bottom: 34, left: 0, right: 0 }),
    useSafeAreaFrame: () => ({ x: 0, y: 0, width: 402, height: 874 }),
  };
});
jest.mock('react-native-reanimated', () => ({
  ...require('react-native-reanimated/mock'), useReducedMotion: () => true, makeMutable: (value: unknown) => ({ value }),
}));
jest.mock('react-native-worklets', () => ({ ...jest.requireActual('react-native-worklets'), scheduleOnRN: (fn: (...args: unknown[]) => void, ...args: unknown[]) => fn(...args) }));

const now = Date.now();
const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
const snapshots = parseVehicleList({ vehicles: [
  { id: 'range-l460', status: 'fresh', fetchedAt: ago(4), rangeKm: 480, fuelPercent: 55, vin: 'TESTVIN0000000000', trips: [ago(60)], lastDriveAt: ago(60), lastDriveVerified: true },
  { id: 'audi-s-etron-gt', status: 'fresh', fetchedAt: ago(20), rangeKm: null, electricRangeKm: 300, fuelPercent: null, socPercent: 66 },
] });

function makeData(extra: Partial<Data>): Data {
  return {
    phase: 'ready', hasSession: true, discoveryFailed: false, lastSyncedAt: now, notificationFailed: false, canSignIn: true,
    snapshot: snapshots['range-rover']!, snapshots,
    refresh: async () => {}, refreshNow: async () => {}, liveRefresh: { state: 'idle', retryAt: null, at: null },
    signIn: async () => {}, signOut: async () => {}, retryDiscovery: () => {},
    ...extra,
  };
}

function fakeStorage() {
  const values = new Map<string, string>();
  const log: string[] = [];
  const storage: WidgetStorage = {
    set: (key, value) => { log.push('set'); values.set(key, value); },
    remove: key => { log.push('remove'); values.delete(key); },
    reloadWidget: () => { log.push('reload'); },
  };
  const read = () => { const text = values.get(WIDGET_SNAPSHOT_KEY); return text ? JSON.parse(text) : null; };
  return { storage, values, log, read };
}

function Jump({ routes }: { routes: Route[] }) {
  const nav = useNav();
  useEffect(() => { if (routes.length) nav.reset(routes); }, [routes]);
  return null;
}

const tree = (data: Data, storage: WidgetStorage, routes: Route[] = []) =>
  <GarageApp data={data}><Jump routes={routes} /><WidgetSync storage={storage} /></GarageApp>;

beforeEach(async () => { await AsyncStorage.clear(); });

test('launch restore keeps the widget; a successful refresh writes; sign-out clears', async () => {
  const fake = fakeStorage();
  fake.values.set(WIDGET_SNAPSHOT_KEY, '{"previous":true}');
  const view = render(tree(makeData({ phase: 'loading', snapshots: {}, snapshot: null }), fake.storage));
  await act(async () => {});
  expect(fake.log).toEqual([]);
  expect(fake.read()).toEqual({ previous: true });

  view.rerender(tree(makeData({}), fake.storage));
  await act(async () => {});
  expect(fake.log).toEqual(['set', 'reload']);
  const written = fake.read();
  expect(written.selectedVehicleId).toBe('range-rover');
  expect(written.vehicles[0]).toMatchObject({ name: 'Range Rover', levelLabel: 'Fuel', levelPercent: 55, rangeKm: 480, stale: false });
  expect(written.vehicles[2]).toMatchObject({ name: 'Audi S e-tron GT', levelLabel: 'Battery', levelPercent: 66, rangeKm: 300 });
  expect(fake.values.get(WIDGET_SNAPSHOT_KEY)).not.toMatch(/TESTVIN|trip|drive|vin/i);

  // Same content again (e.g. a re-render) does not rewrite or reload.
  view.rerender(tree(makeData({}), fake.storage));
  await act(async () => {});
  expect(fake.log).toHaveLength(2);

  // A failed refresh over earlier values keeps them (no rewrite needed: same content).
  view.rerender(tree(makeData({ phase: 'failed' }), fake.storage));
  await act(async () => {});
  expect(fake.read().vehicles[0].levelPercent).toBe(55);

  view.rerender(tree(makeData({ phase: 'signedOut', snapshots: {}, snapshot: null, hasSession: false }), fake.storage));
  await act(async () => {});
  expect(fake.log.slice(-2)).toEqual(['remove', 'reload']);
  expect(fake.values.has(WIDGET_SNAPSHOT_KEY)).toBe(false);
});

test('sign-in expired writes the indicator-only state with no levels', async () => {
  const fake = fakeStorage();
  render(tree(makeData({ phase: 'expired', snapshots: {}, snapshot: null, hasSession: false }), fake.storage));
  await act(async () => {});
  const written = fake.read();
  expect(written.session).toBe('expired');
  for (const vehicle of written.vehicles) {
    expect(vehicle).toMatchObject({ authExpired: true, levelPercent: null, rangeKm: null, updatedAt: null });
  }
});

test('opening a vehicle makes it the widget default and remembers it', async () => {
  const fake = fakeStorage();
  render(tree(makeData({}), fake.storage, [{ name: 'vehicle', vehicle: 2 }]));
  await act(async () => {});
  expect(fake.read().selectedVehicleId).toBe('audi-s-etron-gt');
  expect(await AsyncStorage.getItem(WIDGET_SELECTION_KEY)).toBe('audi-s-etron-gt');
});

test('a stored choice is the default on the next launch', async () => {
  await AsyncStorage.setItem(WIDGET_SELECTION_KEY, 'bmw-x7');
  const fake = fakeStorage();
  render(tree(makeData({}), fake.storage));
  await act(async () => {});
  expect(fake.read().selectedVehicleId).toBe('bmw-x7');
  // Only one write: the first one already waited for the stored choice.
  expect(fake.log).toEqual(['set', 'reload']);
});
