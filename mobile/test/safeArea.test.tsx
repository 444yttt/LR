// Render test: key screens apply the device safe-area insets. react-native-safe-area-context is mocked with non-zero
// insets (iPhone 16 Pro: top 62, bottom 34) or with iPhone SE insets (top 20, bottom 0). All data here is synthetic.
import { useEffect } from 'react';
import { StatusBar, StyleSheet } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { GarageApp } from '../src/GarageApp';
import type { Route } from '../src/garageModel';
import { parseSnapshot } from '../src/telemetry';
import type { Data } from '../src/ui/parts';
import { bottomExtra, bottomPadding, canvases, designSafeTop, fontScaleCap, topShift } from '../src/ui/safeArea';
import { useNav } from '../src/ui/stack';

let mockInsets = { top: 62, bottom: 34, left: 0, right: 0 };
// Device window in points (the jest default, 750×1334, is not a real iPhone and would hide the shift).
let mockWindow = { width: 402, height: 874, scale: 3, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => mockWindow }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return {
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
    SafeAreaView: View,
    useSafeAreaInsets: () => mockInsets,
    useSafeAreaFrame: () => ({ x: 0, y: 0, width: 402, height: 874 }),
  };
});
jest.mock('react-native-reanimated', () => ({ ...require('react-native-reanimated/mock'), useReducedMotion: () => true }));

const now = Date.now();
const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
const data: Data = {
  phase: 'ready', hasSession: true, discoveryFailed: false, lastSyncedAt: now - 60_000, notificationFailed: false, canSignIn: true,
  snapshot: parseSnapshot({ status: 'fresh', fetchedAt: ago(4), lastDriveVerified: true, lastDriveAt: ago(120), rangeKm: 500, fuelPercent: 60, health: 'good', trips: [ago(120), ago(600)] }),
  refresh: async () => {}, signIn: async () => {}, signOut: async () => {}, retryDiscovery: () => {},
};

function Jump({ routes }: { routes: Route[] }) {
  const nav = useNav();
  useEffect(() => { nav.reset(routes); }, []);
  return null;
}
const mount = (routes: Route[] = []) => render(<GarageApp data={data}>{routes.length ? <Jump routes={routes} /> : null}</GarageApp>);

const flat = (node: { props: { style?: unknown } }) => StyleSheet.flatten(node.props.style as never) as Record<string, number>;
const px = (value: number) => value * mockWindow.width / 390;
const close = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThan(0.51);

beforeEach(() => {
  mockInsets = { top: 62, bottom: 34, left: 0, right: 0 };
  mockWindow = { width: 402, height: 874, scale: 3, fontScale: 1 };
});

describe('pure geometry', () => {
  test('shift is the part of the top inset below the Figma safe line; never negative', () => {
    const p402 = (v: number) => v * 402 / 390;
    expect(topShift(p402, 62)).toBeCloseTo(62 - 45 * 402 / 390);
    expect(topShift((v: number) => v * 375 / 390, 20)).toBe(0);
    expect(topShift((v: number) => v, designSafeTop)).toBe(0);
    expect(bottomExtra(p402, 34, canvases.garage.height - canvases.garage.contentBottom)).toBe(0);
    expect(bottomExtra((v: number) => v, 34, 20)).toBe(30);
    expect(bottomPadding((v: number) => v, 34, 56)).toBe(56);
    expect(bottomPadding((v: number) => v, 50, 56)).toBe(66);
  });
});

describe('iPhone 16 Pro insets (62 / 34)', () => {
  test('Garage: canvas below the Dynamic Island, indicators inset, refresh spinner offset, status backdrop, dark status bar', () => {
    mount();
    const shift = topShift(px, 62);
    expect(shift).toBeGreaterThan(0);
    close(flat(screen.getByTestId('garage-canvas')).top, shift);
    const scroll = screen.getByTestId('garage-scroll');
    expect(scroll.props.scrollIndicatorInsets).toEqual({ top: 62, bottom: 34, left: 0, right: 0 });
    expect(scroll.props.automaticallyAdjustsScrollIndicatorInsets).toBe(false);
    expect(scroll.props.contentInsetAdjustmentBehavior).toBe('never');
    close(flat({ props: { style: scroll.props.contentContainerStyle } }).height, px(canvases.garage.height) + shift);
    expect(scroll.props.refreshControl.props.progressViewOffset).toBe(62);
    expect(flat(screen.getByTestId('status-backdrop')).height).toBe(62);
    expect(screen.UNSAFE_getByType(StatusBar).props.barStyle).toBe('dark-content');
    // Title top, in screen points, clears the status bar inset.
    const title = screen.getByText('Garage');
    expect(flat(title).top + shift).toBeGreaterThan(62);
    expect(title.props.maxFontSizeMultiplier).toBe(fontScaleCap.canvas);
  });

  test('vehicle detail: same shift as the Garage (hero coordinates stay consistent), bottom clears the home indicator', () => {
    mount([{ name: 'vehicle', vehicle: 0 }]);
    const shift = topShift(px, 62);
    close(flat(screen.getByTestId('vehicle-canvas')).top, shift);
    close(flat(screen.getByTestId('garage-canvas')).top, shift);
    const scroll = screen.getByTestId('vehicle-scroll');
    expect(scroll.props.scrollIndicatorInsets.bottom).toBe(34);
    const height = flat({ props: { style: scroll.props.contentContainerStyle } }).height;
    // Last content (footer) sits at least the home indicator + breathing room above the end of the scroll content.
    expect(height - (shift + px(canvases.vehicle.contentBottom))).toBeGreaterThanOrEqual(34 + px(16) - 0.5);
  });

  test('sub-screens (drives, status, connection, notifications): back + title shifted, bottom padding clears the home indicator', () => {
    const shift = topShift(px, 62);
    for (const route of [{ name: 'drives', vehicle: 0 }, { name: 'status', vehicle: 0 }, { name: 'connection', vehicle: 0 }, { name: 'notifications' }] as Route[]) {
      const view = mount([route]);
      close(flat(screen.getByTestId('subscreen-back')).top, shift);
      const scroll = screen.getByTestId('subscreen-scroll');
      const container = flat({ props: { style: scroll.props.contentContainerStyle } });
      expect(container.paddingBottom).toBeGreaterThanOrEqual(34 + px(16));
      expect(scroll.props.scrollIndicatorInsets).toEqual({ top: 62, bottom: 34, left: 0, right: 0 });
      expect(screen.getByRole('header').props.maxFontSizeMultiplier).toBe(fontScaleCap.flow);
      view.unmount();
    }
  });

  test('+ sheet: capped below the status bar, bottom padding above the home indicator', () => {
    mount();
    act(() => { fireEvent.press(screen.getByLabelText('Add vehicle')); });
    const panel = flat(screen.getByTestId('sheet-panel'));
    close(panel.maxHeight, mockWindow.height - 62 - px(12));
    const header = screen.getByText('Add vehicle', { exact: true });
    expect(header.props.maxFontSizeMultiplier).toBe(fontScaleCap.flow);
  });
});

describe('iPhone 16 Pro Max insets (62 / 34, 440 wide)', () => {
  test('Garage and detail share the shift; title clears the inset', () => {
    mockWindow = { width: 440, height: 956, scale: 3, fontScale: 1 };
    mount([{ name: 'vehicle', vehicle: 2 }]);
    const shift = topShift(px, 62);
    expect(shift).toBeGreaterThan(0);
    close(flat(screen.getByTestId('vehicle-canvas')).top, shift);
    close(flat(screen.getByTestId('garage-canvas')).top, shift);
  });
});

describe('iPhone SE insets (20 / 0)', () => {
  test('no shift: the Figma layout already clears a 20pt status bar', () => {
    mockInsets = { top: 20, bottom: 0, left: 0, right: 0 };
    mockWindow = { width: 375, height: 667, scale: 2, fontScale: 1 };
    mount([{ name: 'vehicle', vehicle: 0 }]);
    expect(flat(screen.getByTestId('vehicle-canvas')).top).toBe(0);
    expect(flat(screen.getByTestId('garage-canvas')).top).toBe(0);
    expect(screen.getByTestId('vehicle-scroll').props.scrollIndicatorInsets).toEqual({ top: 20, bottom: 0, left: 0, right: 0 });
  });
});
