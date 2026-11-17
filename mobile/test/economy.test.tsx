// Render test: fuel economy screen, refuel entry and the tank-capacity spec. AsyncStorage is the in-memory jest mock
// (test/jestSetup.js). Every value is obviously fake TEST DATA ONLY (tank 80 L, 42.0 L, odometer 12345, ¥7000); none
// is any real vehicle's specs, odometer, fuel or history.
import { useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { GarageApp } from '../src/GarageApp';
import type { Route } from '../src/garageModel';
import { FUEL_LOG_STORAGE_KEY, UNIT_STORAGE_KEY, parseFuelLog, serializeFuelLog, todayJst, type FuelLogMap, type RefuelEntry } from '../src/fuelLog';
import type { HistoryLoad } from '../src/gatewayVehicles';
import { parseSnapshot } from '../src/telemetry';
import type { Data } from '../src/ui/parts';
import { useNav } from '../src/ui/stack';
import { SPECS_STORAGE_KEY, emptySpecs, parseSpecs, serializeSpecs } from '../src/vehicleSpecs';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => ({ width: 402, height: 874, scale: 3, fontScale: 1 }) }));
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
const base: Data = {
  phase: 'ready', hasSession: true, discoveryFailed: false, lastSyncedAt: now - 60_000, notificationFailed: false, canSignIn: true,
  snapshot: parseSnapshot({ status: 'fresh', fetchedAt: ago(4), lastDriveVerified: true, lastDriveAt: ago(120), rangeKm: 500, fuelPercent: 60, odometerKm: 12345, health: 'good', trips: [ago(120)] }),
  refresh: async () => {}, refreshNow: async () => {}, liveRefresh: { state: 'idle', retryAt: null, at: null }, signIn: async () => {}, signOut: async () => {}, retryDiscovery: () => {},
};
function Jump({ routes }: { routes: Route[] }) {
  const nav = useNav();
  useEffect(() => { nav.reset(routes); }, []);
  return null;
}
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
async function mount(routes: Route[], data: Data = base) {
  const view = render(<GarageApp data={data}><Jump routes={routes} /></GarageApp>);
  await settle();
  return view;
}
const fill = (id: string, date: string, odometerKm: number, amount: number, full = true, price: number | null = null): RefuelEntry =>
  ({ id, date, odometerKm, amount, full, price });
const seedLog = (map: FuelLogMap) => AsyncStorage.setItem(FUEL_LOG_STORAGE_KEY, serializeFuelLog(map));
const seedCapacity = (id: 'range-rover' | 'audi-s-etron-gt', capacity: number) =>
  AsyncStorage.setItem(SPECS_STORAGE_KEY, serializeSpecs({ [id]: { ...emptySpecs, options: [], capacity } }));
// Fake: 12345 → 12765 km on 42 L = 10.0 km/L, then 300 km on 25 L = 12.0 km/L.
const fakeLog: RefuelEntry[] = [fill('a', '2026-01-01', 12345, 60), fill('b', '2026-01-10', 12765, 42, true, 7000), fill('c', '2026-01-20', 13065, 25)];
const topBar = () => { const bars = screen.getAllByTestId('nav-bar'); return bars[bars.length - 1]; };
/** Every rendered string, for "no number shown" checks. */
const texts = () => screen.UNSAFE_root.findAll((node: { props: { children?: unknown } }) => typeof node.props.children === 'string').map((node: { props: { children?: unknown } }) => node.props.children as string).join('\n');

beforeEach(async () => { await AsyncStorage.clear(); });

test('detail: a Fuel economy row (Efficiency for the EV) with no value until the log can give one', async () => {
  await mount([{ name: 'vehicle', vehicle: 0 }]);
  expect(screen.getByLabelText('Fuel economy')).toBeTruthy();
  expect(screen.getByLabelText('Vehicle specs')).toBeTruthy();
  screen.unmount();
  await mount([{ name: 'vehicle', vehicle: 2 }]);
  expect(screen.getByLabelText('Efficiency')).toBeTruthy();
  screen.unmount();
  await seedLog({ 'range-rover': fakeLog });
  await mount([{ name: 'vehicle', vehicle: 0 }]);
  expect(screen.getByLabelText('Fuel economy, 12.0 km/L')).toBeTruthy();
});

test('economy screen, nothing entered: every source says why it is empty; no number is shown', async () => {
  await mount([{ name: 'vehicle', vehicle: 0 }, { name: 'economy', vehicle: 0 }]);
  expect(screen.getAllByRole('header').pop()!.props.children).toBe('Fuel economy');
  expect(screen.getByText('No entries yet')).toBeTruthy();
  expect(screen.getByText('Tank capacity needed')).toBeTruthy();
  expect(screen.getByText('Not reported')).toBeTruthy();
  expect(screen.getByText('JLR Data Hub does not report fuel consumption for this vehicle.')).toBeTruthy();
  expect(screen.queryByTestId('economy-latest')).toBeNull();
  expect(texts()).not.toMatch(/\d+\.\d km\/L/);
  // Add refuel sits in the NavBar's trailing slot; back in the leading slot.
  expect(within(topBar()).getByLabelText('Add refuel')).toBeTruthy();
  expect(within(topBar()).getByTestId('nav-leading')).toBeTruthy();
  // The capacity prompt leads to Vehicle specs.
  act(() => { fireEvent.press(screen.getByLabelText('Enter capacity in Vehicle specs')); });
  await settle();
  expect(screen.getAllByRole('header').pop()!.props.children).toBe('Vehicle specs');
});

test('capacity set but no history yet (gateway not deployed, or a fixture vehicle): "Not enough data yet"', async () => {
  await seedCapacity('range-rover', 80);
  const loadHistory = jest.fn(async (): Promise<HistoryLoad> => ({ kind: 'notDeployed' }));
  await mount([{ name: 'vehicle', vehicle: 0 }, { name: 'economy', vehicle: 0 }], { ...base, loadHistory });
  expect(loadHistory).toHaveBeenCalledWith(0);
  expect(screen.getByText('Not enough data yet')).toBeTruthy();
  expect(screen.queryByTestId('economy-latest')).toBeNull();
});

test('fake log: latest, distance-weighted average, per-fill bars and the log list; unit switch to L/100 km', async () => {
  await seedLog({ 'range-rover': fakeLog });
  await mount([{ name: 'vehicle', vehicle: 0 }, { name: 'economy', vehicle: 0 }]);
  expect(screen.getByLabelText('Latest 12.0 km/L')).toBeTruthy();
  expect(screen.getByLabelText('Average ' + (720 / 67).toFixed(1) + ' km/L')).toBeTruthy();
  expect(screen.getByLabelText(/^Economy per full tank, oldest to newest: 10.0, 12.0 km\/L$/)).toBeTruthy();
  expect(screen.getByText('42 L · 12,765 km · ¥7,000 (¥167/L) · Full')).toBeTruthy();
  act(() => { fireEvent.press(screen.getByLabelText('L/100 km')); });
  expect(screen.getByLabelText('Latest 8.3 L/100 km')).toBeTruthy();
  await settle();
  expect(await AsyncStorage.getItem(UNIT_STORAGE_KEY)).toBe('per100');
  // Sources stay separate: the telemetry card still has its own empty state.
  expect(screen.getByText('Tank capacity needed')).toBeTruthy();
});

test('fake history + capacity: the telemetry estimate is shown and labelled as an estimate', async () => {
  await seedCapacity('range-rover', 80);
  const point = (day: number, fuelPercent: number, odometerKm: number) => ({ fetchedAt: new Date(Date.UTC(2026, 0, day)).toISOString(), fuelPercent, socPercent: null, odometerKm });
  const loadHistory = async (): Promise<HistoryLoad> => ({ kind: 'ok', points: [point(1, 30, 12345), point(2, 80, 12345), point(5, 30, 12745)] });
  await mount([{ name: 'vehicle', vehicle: 0 }, { name: 'economy', vehicle: 0 }], { ...base, loadHistory });
  expect(screen.getByLabelText('Latest 10.0 km/L')).toBeTruthy();
  expect(screen.getByText(/^Estimate: fuel-level drop × your 80 L capacity/)).toBeTruthy();
  // No log: that source stays empty.
  expect(screen.getByText('No entries yet')).toBeTruthy();
});

test('EV and Ferrari: km/kWh and battery capacity for the EV; no data source for the Ferrari', async () => {
  await mount([{ name: 'vehicle', vehicle: 2 }, { name: 'economy', vehicle: 2 }]);
  expect(screen.getAllByRole('header').pop()!.props.children).toBe('Efficiency');
  expect(screen.getByText('Battery capacity needed')).toBeTruthy();
  expect(screen.getByLabelText('km/kWh')).toBeTruthy();
  expect(screen.getByLabelText('kWh/100 km')).toBeTruthy();
  expect(screen.getByLabelText('Add charge')).toBeTruthy();
  screen.unmount();
  await mount([{ name: 'vehicle', vehicle: 3 }, { name: 'economy', vehicle: 3 }]);
  expect(screen.getAllByText('No vehicle data source is connected.').length).toBe(2);
  expect(screen.queryByTestId('economy-latest')).toBeNull();
});

test('refuel entry: validates, offers (never pre-fills) the latest odometer, Save in the trailing slot stores and returns', async () => {
  await mount([{ name: 'vehicle', vehicle: 0 }, { name: 'economy', vehicle: 0 }]);
  act(() => { fireEvent.press(within(topBar()).getByLabelText('Add refuel')); });
  await settle();
  expect(screen.getAllByRole('header').pop()!.props.children).toBe('Add refuel');
  expect(screen.getByTestId('subscreen-keyboard')).toBeTruthy();
  expect(screen.getAllByTestId('subscreen-scroll').pop()!.props.keyboardShouldPersistTaps).toBe('handled');
  expect(screen.getByLabelText('Date').props.value).toBe(todayJst(Date.now()));
  expect(screen.getByLabelText('Odometer (km)').props.value).toBe('');
  const save = within(topBar()).getByLabelText('Save');
  expect(save.props.accessibilityState.disabled).toBe(true);
  fireEvent.changeText(screen.getByLabelText('Fuel added (L)'), '42,0');
  act(() => { fireEvent.press(screen.getByLabelText('Use the latest vehicle reading, 12,345 km')); });
  expect(screen.getByLabelText('Odometer (km)').props.value).toBe('12345');
  // A future date is refused with a message, nothing is stored.
  fireEvent.changeText(screen.getByLabelText('Date'), '2999-01-01');
  await act(async () => { fireEvent.press(within(topBar()).getByLabelText('Save')); });
  expect(screen.getByText('The date is in the future')).toBeTruthy();
  expect(await AsyncStorage.getItem(FUEL_LOG_STORAGE_KEY)).toBeNull();
  fireEvent.changeText(screen.getByLabelText('Date'), '2026-01-01');
  fireEvent.changeText(screen.getByLabelText('Total price (¥) · optional'), '7000');
  await act(async () => { fireEvent.press(within(topBar()).getByLabelText('Save')); });
  await settle();
  expect(screen.getAllByRole('header').pop()!.props.children).toBe('Fuel economy');
  expect(screen.getByText('42 L · 12,345 km · ¥7,000 (¥167/L) · Full')).toBeTruthy();
  // One full fill is not enough for an economy.
  expect(screen.getByText('Not enough entries')).toBeTruthy();
  const stored = parseFuelLog(await AsyncStorage.getItem(FUEL_LOG_STORAGE_KEY));
  expect(Object.keys(stored)).toEqual(['range-rover']);
  expect(stored['range-rover']![0]).toMatchObject({ date: '2026-01-01', amount: 42, odometerKm: 12345, price: 7000, full: true });
});

test('editing an entry: Back leaves it unchanged; delete needs a second tap', async () => {
  await seedLog({ 'bmw-x7': fakeLog });
  await mount([{ name: 'vehicle', vehicle: 1 }, { name: 'economy', vehicle: 1 }, { name: 'refuel', vehicle: 1, entry: 'b' }]);
  expect(screen.getAllByRole('header').pop()!.props.children).toBe('Edit entry');
  expect(screen.getByLabelText('Fuel added (L)').props.value).toBe('42');
  fireEvent.changeText(screen.getByLabelText('Fuel added (L)'), '1');
  act(() => { fireEvent.press(within(topBar()).getByLabelText('Back')); });
  await settle();
  expect(parseFuelLog(await AsyncStorage.getItem(FUEL_LOG_STORAGE_KEY))['bmw-x7']![1].amount).toBe(42);
  act(() => { fireEvent.press(screen.getByLabelText(/^Jan 10, 2026/)); });
  await settle();
  act(() => { fireEvent.press(screen.getByLabelText('Delete entry')); });
  expect(parseFuelLog(await AsyncStorage.getItem(FUEL_LOG_STORAGE_KEY))['bmw-x7']!.length).toBe(3);
  await act(async () => { fireEvent.press(screen.getByLabelText('Tap again to delete')); });
  await settle();
  expect(parseFuelLog(await AsyncStorage.getItem(FUEL_LOG_STORAGE_KEY))['bmw-x7']!.map(e => e.id)).toEqual(['a', 'c']);
});

test('corrupt log storage is an empty log, never a crash', async () => {
  await AsyncStorage.setItem(FUEL_LOG_STORAGE_KEY, '{not json');
  await mount([{ name: 'vehicle', vehicle: 0 }, { name: 'economy', vehicle: 0 }]);
  expect(screen.getByText('No entries yet')).toBeTruthy();
});

test('specs: tank capacity is empty by default, stored when entered, and an invalid value blocks Save', async () => {
  await AsyncStorage.setItem(SPECS_STORAGE_KEY, JSON.stringify({ version: 1, vehicles: { 'range-rover': { grade: 'Test Trim', engine: 'V6', year: '2020', options: ['Test Audio'] } } }));
  await mount([{ name: 'vehicle', vehicle: 0 }, { name: 'specs', vehicle: 0 }]);
  const field = screen.getByLabelText('Tank capacity (L)');
  expect(field.props.value).toBe('');
  expect(field.props.placeholder).toBe('Unknown');
  // The v1 document's other fields loaded.
  expect(screen.getByLabelText('Grade / trim').props.value).toBe('Test Trim');
  fireEvent.changeText(field, 'abc');
  expect(screen.getByText('Enter a number between 1 and 300')).toBeTruthy();
  expect(within(topBar()).getByLabelText('Save').props.accessibilityState.disabled).toBe(true);
  fireEvent.changeText(screen.getByLabelText('Tank capacity (L)'), '80');
  await act(async () => { fireEvent.press(within(topBar()).getByLabelText('Save')); });
  expect(parseSpecs(await AsyncStorage.getItem(SPECS_STORAGE_KEY))['range-rover']).toEqual({ grade: 'Test Trim', engine: 'V6', year: '2020', options: ['Test Audio'], capacity: 80 });
  screen.unmount();
  await mount([{ name: 'vehicle', vehicle: 2 }, { name: 'specs', vehicle: 2 }]);
  expect(screen.getByLabelText('Battery capacity (kWh)').props.value).toBe('');
});
