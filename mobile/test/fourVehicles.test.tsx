// Render test: four Garage cards, X7 / S e-tron GT connected with gateway values, Ferrari still offline. Values are #19's
// documented SYNTHETIC fixtures (X7 645 km / 73 % fuel, S e-tron GT 329 km / 68 % SOC) and made-up Range Rover numbers.
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { GarageApp } from '../src/GarageApp';
import { parseVehicleList } from '../src/gatewayVehicles';
import type { Route } from '../src/garageModel';
import type { Data } from '../src/ui/parts';
import { canvases, topShift } from '../src/ui/safeArea';
import { cardY } from '../src/vehicleGeometry';
import { useNav } from '../src/ui/stack';

const mockWindow = { width: 402, height: 874, scale: 3, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => mockWindow }));
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
const row = (extra: Record<string, unknown>) => ({ status: 'fresh', lastDriveVerified: true, health: 'good', connection: 'connected', ...extra });
/** A GET /v1/vehicles body, through the app's own parser. */
const snapshots = parseVehicleList({ vehicles: [
  row({ id: 'range-l460', source: 'jlr', fetchedAt: ago(4), lastDriveAt: ago(120), rangeKm: 500, fuelPercent: 60, trips: [ago(120)] }),
  row({ id: 'bmw-x7', source: 'local', modelYear: 2026, fetchedAt: ago(22), lastDriveAt: ago(2 * 1440), rangeKm: 645, fuelPercent: 73, socPercent: null, electricRangeKm: null, trips: [ago(2 * 1440)] }),
  row({ id: 'audi-s-etron-gt', source: 'local', modelYear: 2026, fetchedAt: ago(34), lastDriveAt: ago(4 * 1440), rangeKm: 329, fuelPercent: null, socPercent: 68, electricRangeKm: 329, trips: [ago(4 * 1440)] }),
] });
function makeData(refreshNow = jest.fn(async (_vehicle?: number) => {})): Data {
  return {
    phase: 'ready', hasSession: true, discoveryFailed: false, lastSyncedAt: now - 60_000, notificationFailed: false, canSignIn: true,
    snapshot: snapshots['range-rover']!, snapshots,
    refresh: async () => {}, refreshNow, liveRefresh: { state: 'idle', retryAt: null, at: null }, signIn: async () => {}, signOut: async () => {}, retryDiscovery: () => {},
  };
}
function Jump({ routes }: { routes: Route[] }) {
  const nav = useNav();
  useEffect(() => { nav.reset(routes); }, []);
  return null;
}
const mount = (routes: Route[] = [], data = makeData()) => render(<GarageApp data={data}>{routes.length ? <Jump routes={routes} /> : null}</GarageApp>);
const flat = (style: unknown) => StyleSheet.flatten(style as never) as Record<string, number>;
const px = (value: number) => value * mockWindow.width / 390;
const allText = () => screen.UNSAFE_root.findAll((node: { props: Record<string, unknown> }) => typeof node.props.children === 'string').map((node: { props: Record<string, unknown> }) => node.props.children as string);
const noBadge = () => expect(allText().join(' | ')).not.toMatch(/demo|mock|sample|synthetic|setup required/i);

test('Garage: four cards in order; X7 and S e-tron GT connected and valued, Ferrari not connected, no demo badge', () => {
  mount();
  expect(['range-rover', 'bmw-x7', 'audi-s-etron-gt', 'ferrari-296'].map(id => screen.getByTestId('card-name-' + id).props.children))
    .toEqual(['Range Rover', 'BMW X7', 'Audi S e-tron GT', 'Ferrari 296']);
  expect(screen.getByText('4 VEHICLES')).toBeTruthy();
  expect(screen.getByLabelText('BMW X7, Updated 22 min ago')).toBeTruthy();
  expect(screen.getByLabelText('Audi S e-tron GT, Updated 34 min ago')).toBeTruthy();
  expect(screen.getByLabelText('Ferrari 296, Not connected')).toBeTruthy();
  expect(screen.getByText('NOT CONNECTED')).toBeTruthy();
  expect(screen.getAllByText('NO DATA')).toHaveLength(1);
  expect(screen.getAllByText('LAST DRIVE')).toHaveLength(3);
  noBadge();
});

test('Garage: the fourth card clears the home indicator and the canvas scrolls past it; cards sit below the title', () => {
  mount();
  const shift = topShift(px, 62);
  const content = flat(screen.getByTestId('garage-scroll').props.contentContainerStyle).height;
  const lastBottom = shift + px(cardY[3] + 225);
  expect(content - lastBottom).toBeGreaterThanOrEqual(34 + px(16) - 0.5);
  expect(content).toBeGreaterThan(mockWindow.height);
  close(content, px(canvases.garage.height) + shift);
  for (let i = 1; i < cardY.length; i++) expect(cardY[i] - cardY[i - 1]).toBeGreaterThanOrEqual(225 + 14);
});
const close = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThan(0.51);

test('tapping the S e-tron GT card opens its detail: range and battery charge from the gateway, no fuel level', () => {
  mount();
  act(() => { fireEvent.press(screen.getByLabelText('Audi S e-tron GT, Updated 34 min ago')); });
  expect(screen.getByTestId('vehicle-title').props.children).toBe('Audi S e-tron GT');
  expect(screen.getByText('Audi · 2026')).toBeTruthy();
  expect(screen.getByText('BATTERY')).toBeTruthy();
  expect(screen.queryByText('FUEL')).toBeNull();
  expect(screen.getByText('329 km')).toBeTruthy();
  expect(screen.getByText('68 %')).toBeTruthy();
  expect(screen.getByText('4 days')).toBeTruthy();
  expect(screen.getByText('No reported issues')).toBeTruthy();
  expect(screen.getByText('Recent drives')).toBeTruthy();
  expect(screen.getByLabelText('Update now')).toBeTruthy();
  noBadge();
});

test('BMW X7 detail: range and fuel from the gateway, connected; Update now re-reads that vehicle only', () => {
  const refreshNow = jest.fn(async (_vehicle?: number) => {});
  mount([{ name: 'vehicle', vehicle: 1 }], makeData(refreshNow));
  expect(screen.getByText('BMW · 2026')).toBeTruthy();
  expect(screen.getByText('FUEL')).toBeTruthy();
  expect(screen.getByText('645 km')).toBeTruthy();
  expect(screen.getByText('73 %')).toBeTruthy();
  expect(screen.getByLabelText('Connection: Updated 22 min ago')).toBeTruthy();
  act(() => { fireEvent.press(screen.getByLabelText('Update now')); });
  expect(refreshNow).toHaveBeenCalledWith(1);
  noBadge();
});

test('Ferrari 296 is unchanged: not connected, no values, no Update now', () => {
  mount([{ name: 'vehicle', vehicle: 3 }]);
  expect(screen.getByLabelText('Connection: Not connected')).toBeTruthy();
  expect(screen.getByText('— km')).toBeTruthy();
  expect(screen.getByText('— %')).toBeTruthy();
  expect(screen.queryByLabelText('Update now')).toBeNull();
  expect(screen.getByText('Connection settings')).toBeTruthy();
  expect(screen.getByText('Live vehicle data unavailable')).toBeTruthy();
});

test('S e-tron GT connection and status screens read as connected through the Nostos gateway', () => {
  const view = mount([{ name: 'connection', vehicle: 2 }]);
  expect(screen.getByText('Connected')).toBeTruthy();
  expect(screen.getByText('Audi S e-tron GT · Nostos gateway')).toBeTruthy();
  noBadge();
  view.unmount();
  mount([{ name: 'drives', vehicle: 2 }]);
  expect(screen.getByText('Recent drives')).toBeTruthy();
  expect(screen.queryByText(/None are verified|No recent drives/)).toBeNull();
  noBadge();
});
