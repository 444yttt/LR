// "Update now" UI: the action, its status line, and the updating pulse on vehicle values. State comes from
// src/liveRefresh.ts; motion follows ./motion (press scale, short ease-out fades, Reduce Motion fallbacks).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import {
  initialLiveRefresh, liveRefreshLine, liveRefreshView, minutesLeft, nextChangeIn,
  type LiveRefresh, type LiveRefreshState,
} from '../liveRefresh.ts';
import { PressScale, ease, haptics, useMotion } from './motion';
import { useData, useFeed } from './parts';
import { Label, ink, medium, mute, typeStyle, white, type Px } from './theme';

/**
 * "Update now" for one vehicle, or null when the vehicle has no signed-in feed. Production: the Range Rover's live
 * gateway state. Demo: the fixture's synthetic state (the action does nothing there).
 */
export function useLiveRefresh(vehicle: number): { live: LiveRefresh; run: () => Promise<void> } | null {
  const data = useData();
  const feed = useFeed(vehicle);
  if (!feed?.hasSession) return null;
  return { live: feed.demo ? feed.liveRefresh ?? initialLiveRefresh : data.liveRefresh, run: data.refreshNow };
}

/** Device time that re-renders exactly when the countdown minute or the view state changes. */
export function useLiveClock(live: LiveRefresh): number {
  const [now, setNow] = useState(Date.now);
  const wait = nextChangeIn(live, now);
  useEffect(() => {
    if (wait === null) return;
    const id = setTimeout(() => setNow(Date.now()), wait + 50);
    return () => clearTimeout(id);
  }, [wait, live]);
  // A new state starts from the current time, not the last tick.
  useEffect(() => setNow(Date.now()), [live]);
  return now;
}

/** Haptic + VoiceOver announcement for the outcome of a request this control started. */
function useOutcomeFeedback(live: LiveRefresh, now: number) {
  const armed = useRef(false);
  const previous = useRef<LiveRefreshState>(live.state);
  useEffect(() => {
    const was = previous.current;
    previous.current = live.state;
    if (!armed.current || was !== 'requesting' || live.state === 'requesting') return;
    armed.current = false;
    if (live.state === 'done') haptics.success();
    else if (live.state === 'rateLimited' || live.state === 'failed') haptics.warning();
    const line = liveRefreshLine(live, now);
    if (line) AccessibilityInfo.announceForAccessibility(line);
  }, [live.state]);
  return () => { armed.current = true; };
}

/**
 * Compact pill: refresh glyph + label. The glyph turns while the vehicle is being read; it is disabled while a read is
 * running or the gateway's 5-minute window is still closed, and re-enables itself when that window passes.
 */
export function UpdateNowButton({ px, vehicle, style }: { px: Px; vehicle: number; style?: StyleProp<ViewStyle> }) {
  const action = useLiveRefresh(vehicle);
  const live = action?.live ?? initialLiveRefresh;
  const now = useLiveClock(live);
  const view = liveRefreshView(live, now);
  const arm = useOutcomeFeedback(live, now);
  const feed = useFeed(vehicle);
  if (!action) return null;
  const requesting = view === 'requesting';
  const limited = view === 'rateLimited';
  // A stored-report GET (app foreground, rate-limit fallback) is running: the hook would ignore a tap.
  const reading = feed?.phase === 'loading' && !requesting;
  const label = requesting ? 'Updating…' : limited ? 'In ' + minutesLeft(live, now) + ' min' : 'Update now';
  const hint = limited ? 'Updated recently. Try again in ' + minutesLeft(live, now) + ' min' : 'Reads the latest report from the vehicle';
  return <PressScale accessibilityRole="button" accessibilityLabel="Update now" accessibilityHint={hint}
    accessibilityState={{ disabled: requesting || limited || reading, busy: requesting || reading }} disabled={requesting || limited || reading} hitSlop={8}
    onPress={() => { arm(); haptics.soft(); void action.run(); }}
    style={[{ height: px(32), paddingHorizontal: px(12), borderRadius: px(16), backgroundColor: white, flexDirection: 'row', alignItems: 'center' }, style]}>
    <Spinner px={px} spinning={requesting} />
    <Label numberOfLines={1} style={typeStyle(px, 12, medium, ink, { marginLeft: px(6) })}>{label}</Label>
  </PressScale>;
}

/** Circular-arrow glyph; one turn per 900 ms while spinning, eased back to rest when done. Static under Reduce Motion. */
function Spinner({ px, spinning }: { px: Px; spinning: boolean }) {
  const { reduced } = useMotion();
  const turn = useSharedValue(0);
  useEffect(() => {
    if (reduced) { cancelAnimation(turn); turn.value = 0; return; }
    if (spinning) {
      turn.value = turn.value % 1;
      turn.value = withRepeat(withTiming(turn.value + 1, { duration: 900, easing: Easing.linear }), -1, false);
    } else {
      cancelAnimation(turn);
      turn.value = withTiming(Math.ceil(turn.value), { duration: 260, easing: ease.out });
    }
    return () => cancelAnimation(turn);
  }, [spinning, reduced]);
  const animated = useAnimatedStyle(() => ({ transform: [{ rotate: turn.value * 360 + 'deg' }] }));
  const size = px(14);
  return <Animated.View style={[{ width: size, height: size }, animated]} accessible={false}>
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M20 12a8 8 0 1 1-2.34-5.66" stroke={spinning ? mute : ink} strokeWidth={2.2} strokeLinecap="round" />
      <Path d="M20 4v4.5h-4.5" stroke={spinning ? mute : ink} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  </Animated.View>;
}

/**
 * One line of text that cross-fades when it changes (out 140 ms, in 220 ms). Reduce Motion swaps it instantly.
 */
export function CrossFadeText({ value, style }: { value: string; style: TextStyle }) {
  const { reduced } = useMotion();
  const [shown, setShown] = useState(value);
  const opacity = useSharedValue(1);
  useEffect(() => {
    if (value === shown) { opacity.value = reduced ? 1 : withTiming(1, { duration: 220, easing: ease.out }); return; }
    if (reduced) { opacity.value = 1; setShown(value); return; }
    opacity.value = withTiming(0, { duration: 140, easing: ease.inOut });
    const id = setTimeout(() => {
      setShown(value);
      opacity.value = withTiming(1, { duration: 220, easing: ease.out });
    }, 140);
    return () => clearTimeout(id);
  }, [value, reduced]);
  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={animated}><Label style={style}>{shown}</Label></Animated.View>;
}

/** Status line for the current "Update now" state, falling back to `idle` text (e.g. the last-update footer). */
export function LiveStatusLine({ vehicle, idle, style }: { vehicle: number; idle: string | null; style: TextStyle }) {
  const action = useLiveRefresh(vehicle);
  const live = action?.live ?? initialLiveRefresh;
  const now = useLiveClock(live);
  const text = (action && liveRefreshLine(live, now)) ?? idle;
  if (text === null) return null;
  return <CrossFadeText value={text} style={style} />;
}

/**
 * Wraps vehicle values: a slow breathing fade while the vehicle is being read, so existing values read as "being
 * refreshed" without disappearing. Reduce Motion holds a steady dim instead.
 */
export function UpdatingPulse({ vehicle, children, style }: { vehicle: number; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { reduced } = useMotion();
  const action = useLiveRefresh(vehicle);
  const active = action ? liveRefreshView(action.live, Date.now()) === 'requesting' : false;
  const level = useSharedValue(1);
  useEffect(() => {
    cancelAnimation(level);
    if (!active) { level.value = reduced ? 1 : withTiming(1, { duration: 260, easing: ease.out }); return; }
    if (reduced) { level.value = 0.6; return; }
    level.value = withRepeat(withTiming(0.5, { duration: 750, easing: Easing.inOut(Easing.quad) }), -1, true);
    return () => cancelAnimation(level);
  }, [active, reduced]);
  const animated = useAnimatedStyle(() => ({ opacity: level.value }));
  return <Animated.View style={[style, animated]} pointerEvents="box-none">{children}</Animated.View>;
}
