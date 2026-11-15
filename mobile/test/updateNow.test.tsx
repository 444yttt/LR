// Render test: "Update now" on the vehicle and Connection screens. Synthetic data only.
import { useEffect } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { GarageApp } from '../src/GarageApp';
import type { Route } from '../src/garageModel';
import type { LiveRefresh } from '../src/liveRefresh';
import { parseSnapshot } from '../src/telemetry';
import type { Data } from '../src/ui/parts';
import { useNav } from '../src/ui/stack';

jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return {
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
    SafeAreaView: View,
    useSafeAreaInsets: () => ({ top: 62, bottom: 34, left: 0, right: 0 }),
    useSafeAreaFrame: () => ({ x: 0, y: 0, width: 402, height: 874 }),
  };
});
jest.mock('react-native-reanimated', () => ({ ...require('react-native-reanimated/mock'), useReducedMotion: () => true }));

const now = Date.now();
const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
function data(liveRefresh: LiveRefresh, refreshNow = jest.fn(async () => {}), refresh = jest.fn(async () => {})): Data {
  return {
    phase: 'ready', hasSession: true, discoveryFailed: false, lastSyncedAt: now - 60_000, notificationFailed: false, canSignIn: true,
    snapshot: parseSnapshot({ status: 'fresh', fetchedAt: ago(4), lastDriveVerified: true, lastDriveAt: ago(120), rangeKm: 500, fuelPercent: 60, health: 'good', trips: [ago(120)] }),
    refresh, refreshNow, liveRefresh, signIn: async () => {}, signOut: async () => {}, retryDiscovery: () => {},
  };
}
function Jump({ routes }: { routes: Route[] }) {
  const nav = useNav();
  useEffect(() => { nav.reset(routes); }, []);
  return null;
}
const mount = (value: Data, routes: Route[]) => render(<GarageApp data={value}><Jump routes={routes} /></GarageApp>);
const idle: LiveRefresh = { state: 'idle', retryAt: null, at: null };

test('vehicle screen: Update now calls refreshNow, not the GET', () => {
  const refreshNow = jest.fn(async () => {});
  const refresh = jest.fn(async () => {});
  mount(data(idle, refreshNow, refresh), [{ name: 'vehicle', vehicle: 0 }]);
  act(() => { fireEvent.press(screen.getByLabelText('Update now')); });
  expect(refreshNow).toHaveBeenCalledTimes(1);
  expect(refresh).not.toHaveBeenCalled();
});

test('vehicle screen: requesting, rate limited and failed copy; button disabled while busy or limited', () => {
  const view = mount(data({ state: 'requesting', retryAt: null, at: now }), [{ name: 'vehicle', vehicle: 0 }]);
  expect(screen.getByText('Updating from vehicle…')).toBeTruthy();
  expect(screen.getByLabelText('Update now').props.accessibilityState.disabled).toBe(true);
  view.unmount();

  const limited = mount(data({ state: 'rateLimited', retryAt: now + 4 * 60_000 + 30_000, at: now }), [{ name: 'vehicle', vehicle: 0 }]);
  expect(screen.getByText('Updated recently — try again in 5 min')).toBeTruthy();
  expect(screen.getByLabelText('Update now').props.accessibilityState.disabled).toBe(true);
  limited.unmount();

  mount(data({ state: 'failed', retryAt: null, at: now }), [{ name: 'vehicle', vehicle: 0 }]);
  expect(screen.getByText('Couldn’t reach the vehicle. Showing the last saved data.')).toBeTruthy();
  expect(screen.getByText('500 km')).toBeTruthy();
  expect(screen.getByLabelText('Update now').props.accessibilityState.disabled).toBe(false);
});

test('connection screen: the update action uses refreshNow', () => {
  const refreshNow = jest.fn(async () => {});
  const refresh = jest.fn(async () => {});
  mount(data({ state: 'done', retryAt: null, at: Date.now() }, refreshNow, refresh), [{ name: 'vehicle', vehicle: 0 }, { name: 'connection', vehicle: 0 }]);
  expect(screen.getAllByText('Updated just now').length).toBeGreaterThan(0);
  const buttons = screen.getAllByLabelText('Update now');
  act(() => { fireEvent.press(buttons[buttons.length - 1]); });
  expect(refreshNow).toHaveBeenCalledTimes(1);
  expect(refresh).not.toHaveBeenCalled();
});
