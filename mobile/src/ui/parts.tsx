import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, RefreshControl, StyleSheet, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { interpolate, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import type { GarageData } from '../useGarage';
import { vehicleFeeds, type Feed, type GarageInput } from '../garageModel.ts';
import { liveRefreshView } from '../liveRefresh.ts';
import { PressScale, Reveal, haptics } from './motion';
import { useEntry, useNav } from './stack';
import { useSafeFrame } from './safe';
import { canvases, fontScaleCap, navSlots } from './safeArea';
import { At, FontCapProvider, Label, ink, medium, mute, page, place, regular, rule, semibold, typeStyle, usePx, white, type Px } from './theme';

export type Data = Pick<GarageData, 'snapshot' | 'phase' | 'refresh' | 'refreshNow' | 'liveRefresh' | 'signIn' | 'signOut' | 'notificationFailed' | 'discoveryFailed'
  | 'lastSyncedAt' | 'retryDiscovery' | 'hasSession' | 'canSignIn'> & {
  /** Synthetic per-vehicle feeds. Set only by the demo/preview entry point (src/demo); production leaves it undefined. */
  demo?: readonly Feed[] | null;
};

const DataContext = createContext<Data | null>(null);
export const DataProvider = DataContext.Provider;
export function useData(): Data {
  const data = useContext(DataContext);
  if (!data) throw new Error('useData outside DataProvider');
  return data;
}
export const modelInput = (data: Data): GarageInput => ({
  phase: data.phase, snapshot: data.snapshot, hasSession: data.hasSession, discoveryFailed: data.discoveryFailed, lastSyncedAt: data.lastSyncedAt,
});
/** Feeds for every vehicle (see garageModel.vehicleFeeds): null means "no data source", never sample values. */
export const feedsOf = (data: Data) => vehicleFeeds(modelInput(data), data.demo ?? null);
export function useFeed(vehicle: number): Feed | null {
  return feedsOf(useData())[vehicle] ?? null;
}

/**
 * Pull-to-refresh that only spins for a pull the user made, then confirms the outcome with a haptic. A pull asks for a
 * live vehicle read ("Update now"); when the gateway is rate limited it falls back to the stored report.
 */
export function usePullToRefresh() {
  const data = useData();
  const { insets } = useSafeFrame();
  const [pulling, setPulling] = useState<number | null>(null);
  const live = data.liveRefresh;
  useEffect(() => {
    if (pulling === null || data.phase === 'loading' || live.state === 'requesting') return;
    setPulling(null);
    // An outcome of this pull's live read decides the haptic; otherwise the GET result does.
    const outcome = live.at !== null && live.at >= pulling ? live.state : liveRefreshView(live, Date.now());
    if (data.phase === 'expired' || data.phase === 'failed' || outcome === 'rateLimited' || outcome === 'failed') haptics.warning();
    else if (data.phase === 'ready') haptics.success();
  }, [pulling, data.phase, live]);
  if (!data.hasSession) return undefined;
  // Scroll views run edge to edge (contentInsetAdjustmentBehavior "never"), so the spinner is moved below the
  // status bar / Dynamic Island explicitly.
  return <RefreshControl tintColor={mute} progressViewOffset={insets.top} refreshing={pulling !== null} onRefresh={() => {
    haptics.soft();
    setPulling(Date.now());
    void data.refreshNow();
  }} />;
}

/** Figma "Activity action" row: white, radius 16, 65 tall, label + chevron. */
export function ActionRow({ px, title, onPress, disabled, placed = false, detail, style, chevron = true }: {
  px: Px; title: string; onPress: () => void; disabled?: boolean; placed?: boolean; detail?: string; style?: StyleProp<ViewStyle>; chevron?: boolean;
}) {
  return <PressScale accessibilityRole="button" accessibilityLabel={detail ? title + ', ' + detail : title} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={[placed ? place(px, 16, 747, 358, 65, 16) : { width: px(358), height: px(65), borderRadius: px(16), marginTop: px(12) }, { backgroundColor: white }, style]}>
    <Label style={typeStyle(px, 15, medium, ink, place(px, 16, 21))}>{title}</Label>
    {!!detail && <Label numberOfLines={1} style={typeStyle(px, 12, regular, mute, { position: 'absolute', right: px(chevron ? 44 : 16), top: px(24), maxWidth: px(170), textAlign: 'right' })}>{detail}</Label>}
    {chevron && <Label style={typeStyle(px, 23, regular, mute, place(px, 322, 15))}>›</Label>}
  </PressScale>;
}

export function Card({ px, children, style }: { px: Px; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ width: px(358), borderRadius: px(18), backgroundColor: white, marginTop: px(18), overflow: 'hidden' }, style]}>{children}</View>;
}

export function Eyebrow({ px, value, style }: { px: Px; value: string; style?: StyleProp<ViewStyle> }) {
  return <View style={style}><Label style={typeStyle(px, 10, medium, mute)}>{value.toUpperCase()}</Label></View>;
}

export const Rule = ({ px, inset = 14 }: { px: Px; inset?: number }) =>
  <View style={{ height: 1, backgroundColor: rule, marginHorizontal: px(inset) }} />;

/** A labelled value inside a card (eyebrow, value, optional caption). Unknown values read "—". */
export function Field({ px, label, value, caption, right }: { px: Px; label: string; value: string | null; caption?: string | null; right?: ReactNode }) {
  return <View style={{ paddingHorizontal: px(14), paddingVertical: px(15), flexDirection: 'row', alignItems: 'center' }}>
    <View style={{ flex: 1 }}>
      <Label style={typeStyle(px, 10, medium, mute)}>{label.toUpperCase()}</Label>
      <Label style={typeStyle(px, 15, semibold, ink, { marginTop: px(6) })}>{value ?? '—'}</Label>
      {!!caption && <Label style={typeStyle(px, 12, regular, mute, { marginTop: px(4) })}>{caption}</Label>}
    </View>
    {right}
  </View>;
}

/** Status-panel style block: eyebrow, 25pt headline, 12pt caption. */
export function Headline({ px, eyebrow, title, caption, loading }: { px: Px; eyebrow: string; title: ReactNode; caption?: string; loading?: ReactNode }) {
  return <View style={{ paddingHorizontal: px(14), paddingTop: px(20), paddingBottom: px(22) }}>
    <Label style={typeStyle(px, 10, medium, mute)}>{eyebrow.toUpperCase()}</Label>
    <View style={{ marginTop: px(10), minHeight: px(25 * 1.21) }}>{loading ?? <Label style={typeStyle(px, 25, semibold, ink)}>{title}</Label>}</View>
    {!!caption && <Label style={typeStyle(px, 12, regular, mute, { marginTop: px(8) })}>{caption}</Label>}
  </View>;
}

export function Note({ px, children, style }: { px: Px; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ marginTop: px(32), width: px(358) }, style]}>
    <View style={{ height: 1, backgroundColor: rule }} />
    <Label style={typeStyle(px, 10, regular, mute, { marginTop: px(13), marginHorizontal: px(6) })}>{children}</Label>
  </View>;
}

export function SectionLabel({ px, value }: { px: Px; value: string }) {
  return <Label style={typeStyle(px, 11, medium, mute, { marginTop: px(26), marginLeft: px(8) })}>{value.toUpperCase()}</Label>;
}

/** Back chevron filling the NavBar's leading slot. Render it only through NavBar, so it is on the same spot everywhere. */
function BackButton({ px, label }: { px: Px; label: string }) {
  const nav = useNav();
  return <PressScale accessibilityRole="button" accessibilityLabel={label} scale={0.9} onPress={nav.pop} style={{ width: px(navSlots.leading.w), height: px(navSlots.leading.h) }}>
    <Label style={typeStyle(px, 28, medium, ink, place(px, 9, 7))}>‹</Label>
  </PressScale>;
}

/**
 * The one header for pushed screens: back in the fixed leading slot, an optional recurring action (e.g. "Update now")
 * in the fixed trailing slot (safeArea.navSlots), both shifted below the status bar / Dynamic Island by the same
 * safe-area shift as every canvas. Rendered above the screen's scroll view, so neither button scrolls or fades with
 * the content; a canvas-coloured backdrop fades in behind them once content scrolls underneath (invisible at rest,
 * so the Figma frames are unchanged). `leadingStyle` / `trailingStyle` only carry the screen's enter/exit transition.
 */
export function NavBar({ back = 'Back', trailing, leadingStyle, trailingStyle }: {
  back?: string; trailing?: ReactNode; leadingStyle?: StyleProp<ViewStyle>; trailingStyle?: StyleProp<ViewStyle>;
}) {
  const px = usePx();
  const safe = useSafeFrame();
  const entry = useEntry();
  const idle = useSharedValue(0);
  const scroll = entry?.scroll ?? idle;
  const progress = entry?.progress ?? idle;
  const hero = entry?.hero ?? false;
  const fade = px(12);
  const backdrop = useAnimatedStyle(() => {
    const scrolled = Math.min(1, Math.max(0, scroll.value / fade));
    return { opacity: scrolled * (hero ? interpolate(progress.value, [0, 0.55], [0, 1], 'clamp') : 1) };
  });
  const { leading, trailing: right } = navSlots;
  const rowTop = safe.top + px(leading.y);
  return <View testID="nav-bar" pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, top: 0, height: rowTop + px(leading.h) }}>
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: page }, backdrop]} />
    <Animated.View testID="nav-leading" style={[{ position: 'absolute', left: px(leading.x), top: rowTop, width: px(leading.w), height: px(leading.h) }, leadingStyle]}>
      <BackButton px={px} label={back} />
    </Animated.View>
    {trailing != null && <Animated.View testID="nav-trailing" pointerEvents="box-none"
      style={[{ position: 'absolute', right: px(right.right), top: safe.top + px(right.y), height: px(right.h), justifyContent: 'center', alignItems: 'flex-end' }, trailingStyle]}>
      {trailing}
    </Animated.View>}
  </View>;
}

/** Form screens (SubScreen `form`): scroll the focused field above the keyboard. No-op outside a form. */
const FormContext = createContext<{ reveal: () => void }>({ reveal: () => undefined });
export const useForm = () => useContext(FormContext);

/**
 * Pushed-screen scaffold: back chevron at (14, 45), 31pt title at y 105, 12pt caption, then flowing content
 * at the 16pt page inset. Content reveals in a short stagger after the push.
 *
 * `form`: the screen has text fields. No pull-to-refresh; the scroll view sits in a KeyboardAvoidingView (iOS padding),
 * taps on buttons work while the keyboard is up (keyboardShouldPersistTaps), dragging the list dismisses the keyboard,
 * and whenever a field gains focus or the keyboard appears the focused field is scrolled clear of the NavBar and of the
 * keyboard. With the keyboard down, the usual bottom padding keeps the last block above the home indicator.
 */
export function SubScreen({ title, caption, children, back, trailing, form = false }: {
  title: string; caption?: string; children: ReactNode; back?: string; trailing?: ReactNode; form?: boolean;
}) {
  const px = usePx();
  const entry = useEntry();
  const refresh = usePullToRefresh();
  const safe = useSafeFrame();
  const onScroll = useAnimatedScrollHandler(event => { if (entry) entry.scroll.value = event.contentOffset.y; });
  const frame = canvases.subScreen;
  const scrollRef = useRef<Animated.ScrollView>(null);
  const navBottom = safe.top + px(navSlots.leading.y + navSlots.leading.h);
  const reveal = useCallback(() => {
    const field = TextInput.State.currentlyFocusedInput() as unknown as View | null;
    const scroll = scrollRef.current as unknown as (View & { scrollTo?: (o: { y: number; animated?: boolean }) => void }) | null;
    if (!field?.measureInWindow || !scroll?.measureInWindow) return;
    scroll.measureInWindow((_sx, sy, _sw, sh) => field.measureInWindow((_fx, fy, _fw, fh) => {
      const top = sy + navBottom + px(8);
      const bottom = sy + sh - px(24);
      const y = entry?.scroll.value ?? 0;
      if (fy + fh > bottom) scroll.scrollTo?.({ y: y + fy + fh - bottom, animated: true });
      else if (fy < top) scroll.scrollTo?.({ y: Math.max(0, y - (top - fy)), animated: true });
    }));
  }, [entry, navBottom]);
  useEffect(() => {
    if (!form) return;
    // After the keyboard has settled (KeyboardAvoidingView has resized the list), bring the focused field into view.
    const shown = Keyboard.addListener('keyboardDidShow', () => reveal());
    return () => shown.remove();
  }, [form, reveal]);
  const formValue = useMemo(() => ({ reveal: () => { if (Keyboard.isVisible()) setTimeout(reveal, 60); } }), [reveal]);
  const list = <Animated.ScrollView ref={scrollRef} testID="subscreen-scroll" style={{ flex: 1 }} {...safe.scroll} onScroll={onScroll} scrollEventThrottle={16}
    keyboardShouldPersistTaps={form ? 'handled' : undefined} keyboardDismissMode={form ? 'interactive' : undefined}
    contentContainerStyle={{ paddingBottom: safe.bottomPadding(frame.paddingBottom), minHeight: px(frame.minHeight) + safe.top }} refreshControl={form ? undefined : refresh}>
    <View style={{ paddingTop: px(frame.titleTop) + safe.top, paddingHorizontal: px(16) }}>
      <Reveal delay={120}>
        <Label accessibilityRole="header" style={typeStyle(px, 31, semibold, ink, { marginLeft: px(6) })}>{title}</Label>
        {!!caption && <Label style={typeStyle(px, 12, regular, mute, { marginLeft: px(7), marginTop: px(2.5) })}>{caption}</Label>}
      </Reveal>
      <Reveal delay={190}>{children}</Reveal>
    </View>
  </Animated.ScrollView>;
  // Back button and title move down by the safe-area shift; the last block clears the home indicator.
  return <FontCapProvider value={fontScaleCap.flow}><View style={{ flex: 1 }}>
    {form
      ? <FormContext.Provider value={formValue}>
        <KeyboardAvoidingView testID="subscreen-keyboard" style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>{list}</KeyboardAvoidingView>
      </FormContext.Provider>
      : list}
    <NavBar back={back} trailing={trailing} />
  </View></FontCapProvider>;
}

export { At };
