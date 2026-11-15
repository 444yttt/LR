// Render + gesture test: fixed navigation slots on every pushed screen, and swipe-down to close the vehicle detail.
// All data is synthetic.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import { GarageApp } from '../src/GarageApp';
import type { Route } from '../src/garageModel';
import { parseSnapshot } from '../src/telemetry';
import type { Data } from '../src/ui/parts';
import { navSlots, topShift } from '../src/ui/safeArea';
import { useNav } from '../src/ui/stack';
import { dismissMetrics } from '../src/ui/dismiss';

let mockReduced = true;
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
// The stock mock's makeMutable is the identity function; the stack keeps progress in mutables, so give them a `.value`.
jest.mock('react-native-reanimated', () => ({
  ...require('react-native-reanimated/mock'), useReducedMotion: () => mockReduced, makeMutable: (value: unknown) => ({ value }),
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
const mount = (routes: Route[]) => render(<GarageApp data={data}><Jump routes={routes} /></GarageApp>);
const flat = (node: { props: { style?: unknown } }) => StyleSheet.flatten(node.props.style as never) as Record<string, number>;
const px = (value: number) => value * mockWindow.width / 390;
const close = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThan(0.51);
const shift = topShift(px, 62);

beforeEach(() => { mockReduced = true; });

const screens: { route: Route; back: string; trailing?: string }[] = [
  { route: { name: 'vehicle', vehicle: 0 }, back: 'Back to Garage', trailing: 'Update now' },
  { route: { name: 'vehicle', vehicle: 1 }, back: 'Back to Garage' },
  { route: { name: 'drives', vehicle: 0 }, back: 'Back' },
  { route: { name: 'status', vehicle: 0 }, back: 'Back' },
  { route: { name: 'connection', vehicle: 0 }, back: 'Back', trailing: 'Update now' },
  { route: { name: 'connection', vehicle: 2 }, back: 'Back' },
  { route: { name: 'notifications' }, back: 'Back' },
];

test.each(screens)('$route.name $route.vehicle: back and trailing actions sit in the fixed NavBar slots, outside the scroll view', ({ route, back, trailing }) => {
  mount([route]);
  const bar = screen.getByTestId('nav-bar');
  // The bar is a sibling of the scroll view (it never scrolls), not a descendant.
  const scroll = screen.queryByTestId('vehicle-scroll') ?? screen.getByTestId('subscreen-scroll');
  expect(within(scroll).queryByTestId('nav-bar')).toBeNull();
  const leading = within(bar).getByTestId('nav-leading');
  const l = flat(leading);
  close(l.left, px(navSlots.leading.x));
  close(l.top, shift + px(navSlots.leading.y));
  close(l.width, px(navSlots.leading.w));
  close(l.height, px(navSlots.leading.h));
  expect(within(leading).getByLabelText(back)).toBeTruthy();
  // Exactly one back button on the screen, and it is the slot's.
  expect(screen.getAllByLabelText(back)).toHaveLength(1);
  if (trailing) {
    const slot = within(bar).getByTestId('nav-trailing');
    const t = flat(slot);
    close(t.right, px(navSlots.trailing.right));
    close(t.top, shift + px(navSlots.trailing.y));
    close(t.height, px(navSlots.trailing.h));
    expect(within(slot).getByLabelText(trailing)).toBeTruthy();
    expect(screen.getAllByLabelText(trailing)).toHaveLength(1);
  } else expect(within(bar).queryByTestId('nav-trailing')).toBeNull();
});

test('lint: back and Update now buttons are only rendered through the NavBar slots', () => {
  const dir = join(__dirname, '../src/screens');
  for (const file of readdirSync(dir)) {
    const source = readFileSync(join(dir, file), 'utf8');
    expect(source).not.toMatch(/BackButton/);
    expect(source).not.toMatch(/accessibilityLabel="Back/);
    // UpdateNowButton only as a NavBar / SubScreen `trailing` element.
    for (const match of source.matchAll(/<UpdateNowButton/g)) {
      expect(source.slice(Math.max(0, match.index! - 40), match.index)).toMatch(/trailing=\{[^}]*$/);
    }
  }
});

test('vehicle detail: no pull-to-refresh and no top bounce, so a pull at the top belongs to swipe-down', () => {
  mount([{ name: 'vehicle', vehicle: 0 }]);
  const scroll = screen.getByTestId('vehicle-scroll');
  expect(scroll.props.refreshControl).toBeUndefined();
  expect(scroll.props.bounces).toBe(false);
});

const pull = (translationY: number, velocityY: number) => fireGestureHandler(getByGestureTestId('swipe-dismiss'), [
  { state: State.BEGAN, translationY: 0, velocityY: 0 },
  { state: State.ACTIVE, translationY: 10, velocityY: 0 },
  { translationY: 10 + translationY / 2, velocityY },
  { translationY: 10 + translationY, velocityY },
  { state: State.END, translationY: 10 + translationY, velocityY },
]);

for (const reduced of [false, true]) {
  describe(reduced ? 'Reduce Motion' : 'full motion', () => {
    beforeEach(() => { mockReduced = reduced; });

    test('swipe down past the threshold closes the detail back to the Garage', () => {
      mount([{ name: 'vehicle', vehicle: 0 }]);
      expect(screen.getByLabelText('Back to Garage')).toBeTruthy();
      act(() => { pull(dismissMetrics(mockWindow.height).commit + 20, 200); });
      expect(screen.queryByLabelText('Back to Garage')).toBeNull();
      expect(screen.getByTestId('garage-scroll')).toBeTruthy();
    });

    test('a short slow pull springs back and keeps the detail; the back button still works afterwards', () => {
      mount([{ name: 'vehicle', vehicle: 0 }]);
      act(() => { pull(40, 100); });
      expect(screen.getByLabelText('Back to Garage')).toBeTruthy();
      act(() => { fireEvent.press(screen.getByLabelText('Back to Garage')); });
      expect(screen.queryByLabelText('Back to Garage')).toBeNull();
    });

    test('scrolled down: the pull scrolls the list (re-anchors) instead of closing', () => {
      let nav: ReturnType<typeof useNav> | null = null;
      function Grab() { nav = useNav(); return null; }
      render(<GarageApp data={data}><Jump routes={[{ name: 'vehicle', vehicle: 0 }]} /><Grab /></GarageApp>);
      // The list is 80pt down for the whole stroke (the scroll view consumes the pull).
      nav!.entries[0].scroll.value = 80;
      act(() => { pull(dismissMetrics(mockWindow.height).commit + 60, 1400); });
      expect(screen.getByLabelText('Back to Garage')).toBeTruthy();
      expect(nav!.entries[0].progress.value).toBe(1);
    });

    test('an interrupted pull (system cancel) springs back instead of sticking mid-flight', () => {
      let nav: ReturnType<typeof useNav> | null = null;
      function Grab() { nav = useNav(); return null; }
      render(<GarageApp data={data}><Jump routes={[{ name: 'vehicle', vehicle: 0 }]} /><Grab /></GarageApp>);
      const far = dismissMetrics(mockWindow.height).commit + 80;
      act(() => {
        fireGestureHandler(getByGestureTestId('swipe-dismiss'), [
          { state: State.BEGAN, translationY: 0 },
          { state: State.ACTIVE, translationY: 10 },
          { translationY: 10 + far, velocityY: 1500 },
          { state: State.CANCELLED, translationY: 10 + far, velocityY: 1500 },
        ]);
      });
      expect(screen.getByLabelText('Back to Garage')).toBeTruthy();
      expect(nav!.entries[0].progress.value).toBe(1);
      expect(nav!.entries[0].follow.value).toBe(0);
      // Navigation is not left busy: the back button still closes.
      act(() => { fireEvent.press(screen.getByLabelText('Back to Garage')); });
      expect(screen.queryByLabelText('Back to Garage')).toBeNull();
    });

    test('a short fast fling closes', () => {
      mount([{ name: 'vehicle', vehicle: 0 }]);
      act(() => { pull(40, 1400); });
      expect(screen.queryByLabelText('Back to Garage')).toBeNull();
    });
  });
}
