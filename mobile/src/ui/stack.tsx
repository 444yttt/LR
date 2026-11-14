import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { interpolate, makeMutable, useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import type { Route } from '../garageModel.ts';
import { ease, haptics, springs, useMotion } from './motion';
import type { Origin } from './stage';
import { page } from './theme';

export type Entry = {
  key: string;
  route: Route;
  /** 0 = off screen / on the card, 1 = presented. Driven only on the UI thread. */
  progress: SharedValue<number>;
  /** Screen scroll offset. A reversing hero adds it so the car lands back on its card from wherever it was scrolled. */
  scroll: SharedValue<number>;
  origin: Origin | null;
  hero: boolean;
  landed: boolean;
};

type Nav = {
  entries: Entry[];
  push(route: Route, origin?: Origin | null): void;
  pop(): void;
  reset(routes: Route[]): void;
};

const NavContext = createContext<Nav | null>(null);
export function useNav(): Nav {
  const nav = useContext(NavContext);
  if (!nav) throw new Error('useNav outside Stack');
  return nav;
}
/** The entry rendering the current screen. */
const EntryContext = createContext<Entry | null>(null);
export const useEntry = () => useContext(EntryContext);

const timing = {
  push: { duration: 420, easing: ease.out },
  pop: { duration: 340, easing: ease.out },
  heroIn: { duration: 640, easing: ease.hero },
  heroOut: { duration: 500, easing: ease.hero },
};

let nextKey = 0;

export function Stack({ base, render, children }: { base: ReactNode; render: (entry: Entry) => ReactNode; children?: ReactNode }) {
  const { reduced } = useMotion();
  const { width } = useWindowDimensions();
  const [entries, setEntries] = useState<Entry[]>([]);
  const list = useRef(entries);
  list.current = entries;
  const busy = useRef(false);

  const remove = useCallback((key: string) => {
    busy.current = false;
    setEntries(current => current.filter(entry => entry.key !== key));
  }, []);
  const land = useCallback((key: string) => {
    busy.current = false;
    setEntries(current => current.map(entry => entry.key === key ? { ...entry, landed: true } : entry));
  }, []);

  const make = (route: Route, origin: Origin | null, presented: boolean): Entry => ({
    key: 'screen-' + nextKey++, route, origin,
    hero: route.name === 'vehicle',
    progress: makeMutable(presented ? 1 : 0),
    scroll: makeMutable(0),
    landed: presented,
  });

  const push = useCallback((route: Route, origin: Origin | null = null) => {
    if (busy.current) return;
    const entry = make(route, origin, reduced);
    setEntries(current => [...current, entry]);
    if (reduced) return;
    busy.current = true;
    const key = entry.key;
    entry.progress.value = withTiming(1, entry.hero ? timing.heroIn : timing.push, finished => {
      if (finished) scheduleOnRN(land, key);
    });
  }, [reduced, land]);

  const pop = useCallback(() => {
    const top = list.current[list.current.length - 1];
    if (!top || busy.current) return;
    if (reduced) { remove(top.key); return; }
    busy.current = true;
    const key = top.key;
    top.progress.value = withTiming(0, top.hero ? timing.heroOut : timing.pop, finished => {
      if (finished) scheduleOnRN(remove, key);
    });
  }, [reduced, remove]);

  const reset = useCallback((routes: Route[]) => {
    busy.current = false;
    setEntries(routes.map(route => make(route, null, true)));
  }, []);

  const nav = useMemo<Nav>(() => ({ entries, push, pop, reset }), [entries, push, pop, reset]);

  return <NavContext.Provider value={nav}>
    <Layer next={entries[0]} top={!entries.length} width={width}>{base}</Layer>
    {entries.map((entry, i) => <EntryContext.Provider key={entry.key} value={entry}>
      <Layer entry={entry} next={entries[i + 1]} top={i === entries.length - 1} width={width} onCancelBack={() => { busy.current = false; }}
        onBackStart={() => { busy.current = true; }} remove={remove}>
        {render(entry)}
      </Layer>
    </EntryContext.Provider>)}
    {children}
  </NavContext.Provider>;
}

function Layer({ entry, next, top, width, children, onBackStart, onCancelBack, remove }: {
  entry?: Entry; next?: Entry; top: boolean; width: number; children: ReactNode;
  onBackStart?: () => void; onCancelBack?: () => void; remove?: (key: string) => void;
}) {
  const { reduced } = useMotion();
  const own = entry?.progress;
  const above = next?.progress;
  const heroAbove = next?.hero ?? false;
  const hero = entry?.hero ?? false;
  const fallback = useSharedValue(0);
  const ownValue = own ?? fallback;
  const aboveValue = above ?? fallback;
  const parallax = -width * 0.28;

  const style = useAnimatedStyle(() => {
    const transforms: ({ translateX: number } | { scale: number })[] = [];
    let opacity = 1;
    if (entry && !hero) transforms.push({ translateX: (1 - ownValue.value) * width });
    if (above) {
      if (heroAbove) {
        // Clear the Garage before the detail header arrives so the two titles never overlap.
        opacity = interpolate(aboveValue.value, [0, 0.4], [1, 0], 'clamp');
        transforms.push({ scale: 1 - aboveValue.value * 0.035 });
      } else transforms.push({ translateX: aboveValue.value * parallax });
    }
    return { opacity, transform: transforms };
  });
  // A faint scrim on the outgoing screen so pushed screens separate without drop shadows.
  const scrim = useAnimatedStyle(() => ({ opacity: above && !heroAbove ? aboveValue.value * 0.06 : 0 }));
  // Hero screens paint their canvas separately so the car never fades with it.
  const canvas = useAnimatedStyle(() => ({ opacity: hero ? interpolate(ownValue.value, [0, 0.55], [0, 1], 'clamp') : 1 }));

  const backGesture = useMemo(() => {
    if (!entry || !own || !remove) return null;
    const key = entry.key;
    const distance = hero ? width * 0.75 : width;
    const soft = haptics.soft;
    return Gesture.Pan()
      .enabled(top)
      .hitSlop({ left: 0, width: 28 })
      .activeOffsetX(10)
      .failOffsetY([-14, 14])
      // Only an activated pan (≥10pt horizontal) claims navigation; taps on the back chevron in this strip still pop.
      .onStart(() => { if (onBackStart) scheduleOnRN(onBackStart); })
      .onUpdate(event => {
        own.value = Math.min(1, Math.max(0, 1 - event.translationX / distance));
      })
      .onEnd(event => {
        const done = event.translationX > distance * 0.33 || event.velocityX > 650;
        if (done) {
          own.value = reduced ? 0 : withTiming(0, { duration: hero ? 380 : 260, easing: ease.out }, finished => {
            if (finished) scheduleOnRN(remove, key);
          });
          if (reduced) scheduleOnRN(remove, key);
          scheduleOnRN(soft);
        } else {
          own.value = withSpring(1, springs.release);
          if (onCancelBack) scheduleOnRN(onCancelBack);
        }
      });
  }, [entry?.key, top, width, reduced]);

  const body = <Animated.View pointerEvents={top ? 'auto' : 'none'} style={[StyleSheet.absoluteFill, style]}>
    <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: page }, canvas]} />
    {children}
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }, scrim]} />
  </Animated.View>;
  return backGesture ? <GestureDetector gesture={backGesture}>{body}</GestureDetector> : body;
}

/**
 * Bottom sheet: spring in over a dimmed Garage, drag down or tap the scrim to dismiss.
 * Stays mounted while animating out.
 */
export function Sheet({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: ReactNode }) {
  const { reduced } = useMotion();
  const { height } = useWindowDimensions();
  const [mounted, setMounted] = useState(visible);
  const shown = useSharedValue(0);
  const drag = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      drag.value = 0;
      shown.value = reduced ? 1 : withSpring(1, springs.sheet);
    } else if (mounted) {
      if (reduced) { shown.value = 0; setMounted(false); return; }
      shown.value = withTiming(0, { duration: 260, easing: ease.out }, finished => {
        if (finished) scheduleOnRN(setMounted, false);
      });
    }
  }, [visible, reduced]);

  const pan = useMemo(() => Gesture.Pan()
    .activeOffsetY(8)
    .onUpdate(event => { drag.value = Math.max(0, event.translationY); })
    .onEnd(event => {
      if (event.translationY > 120 || event.velocityY > 900) scheduleOnRN(onClose);
      else drag.value = withSpring(0, springs.sheet);
    }), [onClose]);

  const scrim = useAnimatedStyle(() => ({ opacity: shown.value * 0.18 * (1 - Math.min(1, drag.value / 400)) }));
  const panel = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - shown.value) * height * 0.7 + drag.value }] }));
  if (!mounted) return null;
  return <View style={StyleSheet.absoluteFill} pointerEvents={visible ? 'auto' : 'none'}>
    <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }, scrim]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close" style={StyleSheet.absoluteFill} onPress={onClose} />
    </Animated.View>
    <GestureDetector gesture={pan}>
      <Animated.View accessibilityViewIsModal style={[{ position: 'absolute', left: 0, right: 0, bottom: 0 }, panel]}>{children}</Animated.View>
    </GestureDetector>
  </View>;
}
