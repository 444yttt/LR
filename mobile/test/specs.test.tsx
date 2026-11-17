// Render test: user-entered vehicle specs on the detail, the Garage card, and the edit screen. AsyncStorage is the
// in-memory jest mock (test/jestSetup.js). Spec values are obviously fake TEST DATA ONLY, not any real vehicle's specs.
import { useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { GarageApp } from '../src/GarageApp';
import type { Route } from '../src/garageModel';
import { parseSnapshot } from '../src/telemetry';
import type { Data } from '../src/ui/parts';
import { useNav } from '../src/ui/stack';
import { SPECS_STORAGE_KEY, parseSpecs, serializeSpecs } from '../src/vehicleSpecs';

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
const data: Data = {
  phase: 'ready', hasSession: true, discoveryFailed: false, lastSyncedAt: now - 60_000, notificationFailed: false, canSignIn: true,
  snapshot: parseSnapshot({ status: 'fresh', fetchedAt: ago(4), lastDriveVerified: true, lastDriveAt: ago(120), rangeKm: 500, fuelPercent: 60, health: 'good', trips: [ago(120)] }),
  refresh: async () => {}, refreshNow: async () => {}, liveRefresh: { state: 'idle', retryAt: null, at: null }, signIn: async () => {}, signOut: async () => {}, retryDiscovery: () => {},
};
function Jump({ routes }: { routes: Route[] }) {
  const nav = useNav();
  useEffect(() => { nav.reset(routes); }, []);
  return null;
}
/** Lets the storage read (and the edit screen's wait for it) settle inside act. */
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
async function mount(routes: Route[]) {
  const view = render(<GarageApp data={data}><Jump routes={routes} /></GarageApp>);
  await settle();
  return view;
}
const seed = (vehicles: Parameters<typeof serializeSpecs>[0]) => AsyncStorage.setItem(SPECS_STORAGE_KEY, serializeSpecs(vehicles));
const fake = { grade: 'Test Trim', engine: 'V6', year: '2020', options: ['Test Audio', 'Test Wheels'] };

beforeEach(async () => { await AsyncStorage.clear(); });

test('detail without specs: base name and model only, no options block, specs row present', async () => {
  await mount([{ name: 'vehicle', vehicle: 0 }]);
  expect(screen.getByTestId('vehicle-title').props.children).toBe('Range Rover');
  expect(screen.getByText('L460')).toBeTruthy();
  expect(screen.queryByTestId('vehicle-options')).toBeNull();
  expect(screen.queryByText('OPTIONS')).toBeNull();
  expect(screen.getByLabelText('Vehicle specs')).toBeTruthy();
  expect(within(screen.getByTestId('garage-canvas')).getByTestId('card-name-range-rover').props.children).toBe('Range Rover');
});

test('detail with specs: composed name, year on the model line, options list; the Garage card shows the name too', async () => {
  await seed({ 'range-rover': fake });
  await mount([{ name: 'vehicle', vehicle: 0 }]);
  expect(screen.getByTestId('vehicle-title').props.children).toBe('Range Rover Test Trim V6');
  expect(screen.getByText('L460 · 2020')).toBeTruthy();
  const options = screen.getByTestId('vehicle-options');
  expect(within(options).getByText('Test Audio')).toBeTruthy();
  expect(within(options).getByText('Test Wheels')).toBeTruthy();
  expect(screen.getByTestId('card-name-range-rover').props.children).toBe('Range Rover Test Trim V6');
  // Specs are per vehicle id: the others keep their base names.
  expect(screen.getByTestId('card-name-ferrari-296').props.children).toBe('Ferrari 296');
  expect(screen.getByTestId('card-name-bmw-x7').props.children).toBe('BMW X7');
});

test('a composed name too long for the card keeps the base name on the card; the detail shows it in full', async () => {
  await seed({ 'bmw-x7': { ...fake, grade: 'Test Trim With Long Name', options: [] } });
  await mount([{ name: 'vehicle', vehicle: 1 }]);
  expect(screen.getByTestId('card-name-bmw-x7').props.children).toBe('BMW X7');
  expect(screen.getByTestId('vehicle-title').props.children).toBe('BMW X7 Test Trim With Long Name V6');
  // Too long for one line even at 22pt: two lines, model line moved down below them.
  expect(screen.getByTestId('vehicle-title').props.numberOfLines).toBe(2);
  expect(screen.queryByTestId('vehicle-options')).toBeNull();
});

test('corrupt storage is treated as no specs', async () => {
  await AsyncStorage.setItem(SPECS_STORAGE_KEY, '{not json');
  await mount([{ name: 'vehicle', vehicle: 0 }]);
  expect(screen.getByTestId('vehicle-title').props.children).toBe('Range Rover');
  expect(screen.queryByTestId('vehicle-options')).toBeNull();
});

test('edit flow (Ferrari, no live feed): empty form, type, add an option, Save in the trailing slot, back on the detail', async () => {
  await mount([{ name: 'vehicle', vehicle: 3 }]);
  act(() => { fireEvent.press(screen.getByLabelText('Vehicle specs')); });
  await settle();
  const headers = screen.getAllByRole('header');
  expect(headers[headers.length - 1].props.children).toBe('Vehicle specs');
  for (const label of ['Grade / trim', 'Engine / powertrain', 'Model year']) {
    expect(screen.getByLabelText(label).props.value).toBe('');
    expect(screen.getByLabelText(label).props.placeholder).toBe('Unknown');
  }
  const bars = screen.getAllByTestId('nav-bar');
  const save = within(bars[bars.length - 1]).getByLabelText('Save');
  // Nothing typed yet: Save is disabled.
  expect(save.props.accessibilityState.disabled).toBe(true);

  fireEvent.changeText(screen.getByLabelText('Grade / trim'), '  Test Trim ');
  fireEvent.changeText(screen.getByLabelText('Engine / powertrain'), 'V6');
  fireEvent.changeText(screen.getByLabelText('Model year'), '2020');
  act(() => { fireEvent.press(screen.getByLabelText('Add option')); });
  fireEvent.changeText(screen.getByLabelText('Option 1'), 'Test Audio');
  act(() => { fireEvent.press(screen.getByLabelText('Add option')); });
  expect(screen.getByLabelText('Option 2')).toBeTruthy();
  // An empty option row is dropped on save.
  expect(screen.getByLabelText('Save').props.accessibilityState.disabled).toBe(false);
  await act(async () => { fireEvent.press(screen.getByLabelText('Save')); });

  expect(screen.queryByLabelText('Grade / trim')).toBeNull();
  expect(screen.getByTestId('vehicle-title').props.children).toBe('Ferrari 296 Test Trim V6');
  expect(screen.getByText('Ferrari · 2020')).toBeTruthy();
  expect(within(screen.getByTestId('vehicle-options')).getByText('Test Audio')).toBeTruthy();
  expect(screen.getByTestId('card-name-ferrari-296').props.children).toBe('Ferrari 296 Test Trim V6');
  expect(parseSpecs(await AsyncStorage.getItem(SPECS_STORAGE_KEY))).toEqual({
    'ferrari-296': { grade: 'Test Trim', engine: 'V6', year: '2020', options: ['Test Audio'] },
  });
});

test('edit screen pre-fills only what was stored; removing an option and Back without Save keeps the stored specs', async () => {
  await seed({ 'bmw-x7': fake });
  await mount([{ name: 'vehicle', vehicle: 1 }, { name: 'specs', vehicle: 1 }]);
  expect(screen.getByLabelText('Grade / trim').props.value).toBe('Test Trim');
  expect(screen.getByLabelText('Option 2').props.value).toBe('Test Wheels');
  act(() => { fireEvent.press(screen.getByLabelText('Remove Test Wheels')); });
  expect(screen.queryByLabelText('Option 2')).toBeNull();
  act(() => { fireEvent.press(screen.getAllByLabelText('Back')[0]); });
  expect(screen.queryByLabelText('Grade / trim')).toBeNull();
  expect(within(screen.getByTestId('vehicle-options')).getByText('Test Wheels')).toBeTruthy();
});

test('clearing every field and saving returns to the base name with no options block', async () => {
  await seed({ 'range-rover': fake });
  await mount([{ name: 'vehicle', vehicle: 0 }, { name: 'specs', vehicle: 0 }]);
  expect(screen.getByLabelText('Engine / powertrain').props.value).toBe('V6');
  for (const label of ['Grade / trim', 'Engine / powertrain', 'Model year']) fireEvent.changeText(screen.getByLabelText(label), '');
  act(() => { fireEvent.press(screen.getByLabelText('Remove Test Audio')); });
  act(() => { fireEvent.press(screen.getByLabelText('Remove Test Wheels')); });
  await act(async () => { fireEvent.press(screen.getByLabelText('Save')); });
  expect(screen.getByTestId('vehicle-title').props.children).toBe('Range Rover');
  expect(screen.getByText('L460')).toBeTruthy();
  expect(screen.queryByTestId('vehicle-options')).toBeNull();
  expect(parseSpecs(await AsyncStorage.getItem(SPECS_STORAGE_KEY))).toEqual({});
});

test('edit screen is a keyboard-safe form: no pull-to-refresh, taps persist with the keyboard up, bottom clears the home indicator', async () => {
  await mount([{ name: 'vehicle', vehicle: 0 }, { name: 'specs', vehicle: 0 }]);
  expect(screen.getByTestId('subscreen-keyboard')).toBeTruthy();
  const scroll = screen.getByTestId('subscreen-scroll');
  expect(scroll.props.refreshControl).toBeUndefined();
  expect(scroll.props.keyboardShouldPersistTaps).toBe('handled');
  expect(scroll.props.contentContainerStyle.paddingBottom).toBeGreaterThanOrEqual(34 + 16);
});
