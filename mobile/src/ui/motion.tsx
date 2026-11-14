import { useEffect, useRef, type ReactNode } from 'react';
import { Platform, Pressable, Text, TextInput, View, type PressableProps, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Animated, {
  Easing, cancelAnimation, interpolate, interpolateColor, useAnimatedProps, useAnimatedStyle, useReducedMotion,
  useSharedValue, withDelay, withRepeat, withSpring, withTiming, type SharedValue,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { ink, rule, skeleton, white } from './theme';

/** One motion vocabulary for the app. Durations are short; springs are critically damped or close to it. */
export const ease = {
  /** iOS-like deceleration for screen pushes and content. */
  out: Easing.bezier(0.22, 1, 0.36, 1),
  /** Hero flight: quick lift, long soft landing. */
  hero: Easing.bezier(0.32, 0.72, 0, 1),
  inOut: Easing.bezier(0.45, 0, 0.25, 1),
};
export const springs = {
  press: { damping: 22, stiffness: 420, mass: 0.6 },
  release: { damping: 16, stiffness: 260, mass: 0.7 },
  settle: { damping: 7, stiffness: 160, mass: 0.9 },
  sheet: { damping: 26, stiffness: 240, mass: 0.9 },
};

export function useMotion() {
  return { reduced: useReducedMotion() };
}

const haptic = Platform.OS === 'ios';
export const haptics = {
  select: () => { if (haptic) void Haptics.selectionAsync().catch(() => undefined); },
  open: () => { if (haptic) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined); },
  soft: () => { if (haptic) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft).catch(() => undefined); },
  success: () => { if (haptic) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined); },
  warning: () => { if (haptic) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined); },
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type PressScaleProps = Omit<PressableProps, 'style'> & {
  style?: StyleProp<ViewStyle>;
  /** Pressed scale. Cards use 0.97; rows and buttons 0.98. */
  scale?: number;
  feedback?: 'select' | 'open' | 'none';
  children?: ReactNode;
};

/**
 * Pressable with a UI-thread scale spring and a selection haptic on press-in.
 * Reduce Motion swaps the scale for a plain opacity change.
 */
export function PressScale({ style, scale = 0.98, feedback = 'select', onPressIn, onPressOut, disabled, children, ...rest }: PressScaleProps) {
  const { reduced } = useMotion();
  const pressed = useSharedValue(0);
  const animated = useAnimatedStyle(() => reduced
    ? { opacity: disabled ? 0.55 : 1 - pressed.value * 0.4 }
    : { opacity: disabled ? 0.55 : 1, transform: [{ scale: interpolate(pressed.value, [0, 1], [1, scale]) }] });
  return <AnimatedPressable {...rest} disabled={disabled}
    onPressIn={event => {
      pressed.value = reduced ? 1 : withSpring(1, springs.press);
      if (feedback === 'select') haptics.select();
      onPressIn?.(event);
    }}
    onPressOut={event => {
      pressed.value = reduced ? 0 : withSpring(0, springs.release);
      onPressOut?.(event);
    }}
    style={[style, animated]}>
    {children}
  </AnimatedPressable>;
}

/**
 * Mount reveal: fade + 12pt rise, staggered by `index`. Runs once per mount on the UI thread.
 */
export function Reveal({ index = 0, delay = 0, style, children, distance = 12 }: { index?: number; delay?: number; style?: StyleProp<ViewStyle>; children?: ReactNode; distance?: number }) {
  const { reduced } = useMotion();
  const shown = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) { shown.value = 1; return; }
    shown.value = withDelay(delay + index * 70, withTiming(1, { duration: 520, easing: ease.out }));
  }, []);
  const animated = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{ translateY: (1 - shown.value) * distance }],
  }));
  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}

/** Fades/raises a block as a driving progress (e.g. the hero transition) passes a window. */
export function useProgressReveal(progress: SharedValue<number>, start: number, distance = 14) {
  return useAnimatedStyle(() => {
    const t = interpolate(progress.value, [start, Math.min(1, start + 0.45)], [0, 1], 'clamp');
    return { opacity: t, transform: [{ translateY: (1 - t) * distance }] };
  });
}

/** Loading placeholder with a soft highlight sweeping left to right. */
export function Skeleton({ width, height, radius = 6, style }: { width: number; height: number; radius?: number; style?: StyleProp<ViewStyle> }) {
  const { reduced } = useMotion();
  const sweep = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    sweep.value = withRepeat(withTiming(1, { duration: 1300, easing: Easing.inOut(Easing.quad) }), -1, false);
    return () => cancelAnimation(sweep);
  }, [reduced]);
  const band = Math.max(60, width * 0.6);
  const animated = useAnimatedStyle(() => ({ transform: [{ translateX: interpolate(sweep.value, [0, 1], [-band, width]) }] }));
  return <View accessibilityLabel="Loading" style={[{ width, height, borderRadius: radius, backgroundColor: skeleton, overflow: 'hidden' }, style]}>
    {!reduced && <Animated.View style={[{ position: 'absolute', top: 0, bottom: 0, width: band }, animated]}>
      <Svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 10 10">
        <Defs>
          <LinearGradient id="sweep" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={white} stopOpacity={0} />
            <Stop offset="0.5" stopColor={white} stopOpacity={0.75} />
            <Stop offset="1" stopColor={white} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="10" height="10" fill="url(#sweep)" />
      </Svg>
    </Animated.View>}
  </View>;
}

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

/**
 * Metric that counts up from 0 when a value first arrives (and glides between later values).
 * The digits are written by a UI-thread worklet into a non-editable TextInput, so no React render per frame.
 */
export function CountUp({ value, suffix, empty, style, decimals = 0 }: { value: number | null; suffix: string; empty: string; style: TextStyle; decimals?: number }) {
  const { reduced } = useMotion();
  const shown = useSharedValue(0);
  const previous = useRef<number | null>(null);
  useEffect(() => {
    if (value === null) { previous.current = null; shown.value = 0; return; }
    if (reduced) shown.value = value;
    else {
      const from = previous.current ?? 0;
      shown.value = from;
      shown.value = withTiming(value, { duration: previous.current === null ? 900 : 500, easing: Easing.out(Easing.cubic) });
    }
    previous.current = value;
  }, [value, reduced]);
  const final = value === null ? empty : value.toFixed(decimals) + suffix;
  const props = useAnimatedProps(() => ({ text: shown.value.toFixed(decimals) + suffix }) as never);
  if (value === null || Platform.OS === 'web' || reduced) return <Text style={style}>{final}</Text>;
  const height = style.lineHeight;
  return <AnimatedTextInput editable={false} pointerEvents="none" underlineColorAndroid="transparent" scrollEnabled={false}
    accessibilityLabel={final} defaultValue={final} animatedProps={props}
    style={[style, { padding: 0, margin: 0, height, minWidth: 0 }]} />;
}

/** Figma-language switch: ink track when on, rule track when off, white knob. */
export function Toggle({ value, onChange, disabled, label, px }: { value: boolean; onChange: (next: boolean) => void; disabled?: boolean; label: string; px: (v: number) => number }) {
  const { reduced } = useMotion();
  const on = useSharedValue(value ? 1 : 0);
  useEffect(() => { on.value = reduced ? (value ? 1 : 0) : withSpring(value ? 1 : 0, springs.release); }, [value, reduced]);
  const w = px(46), h = px(28), knob = px(24), travel = w - knob - px(4);
  const track = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(on.value, [0, 1], [rule, ink]) }));
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: on.value * travel }] }));
  return <Pressable accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: value, disabled }} disabled={disabled} hitSlop={8}
    onPress={() => { haptics.select(); onChange(!value); }}>
    <Animated.View style={[{ width: w, height: h, borderRadius: h / 2, padding: px(2), opacity: disabled ? 0.45 : 1 }, track]}>
      <Animated.View style={[{ width: knob, height: knob, borderRadius: knob / 2, backgroundColor: white }, thumb]} />
    </Animated.View>
  </Pressable>;
}
