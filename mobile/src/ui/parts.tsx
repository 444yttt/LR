import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { RefreshControl, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedScrollHandler } from 'react-native-reanimated';
import type { GarageData } from '../useGarage';
import type { GarageInput } from '../garageModel.ts';
import { PressScale, Reveal, haptics } from './motion';
import { useEntry, useNav } from './stack';
import { At, ink, medium, mute, place, regular, rule, semibold, typeStyle, usePx, white, type Px } from './theme';

export type Data = Pick<GarageData, 'snapshot' | 'phase' | 'refresh' | 'signIn' | 'signOut' | 'notificationFailed' | 'discoveryFailed'
  | 'lastSyncedAt' | 'retryDiscovery' | 'hasSession' | 'canSignIn'>;

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

/**
 * Pull-to-refresh that only spins for a pull the user made, then confirms the outcome with a haptic.
 */
export function usePullToRefresh() {
  const data = useData();
  const [pulling, setPulling] = useState(false);
  useEffect(() => {
    if (!pulling || data.phase === 'loading') return;
    setPulling(false);
    if (data.phase === 'ready') haptics.success();
    else if (data.phase === 'failed' || data.phase === 'expired') haptics.warning();
  }, [pulling, data.phase]);
  if (!data.hasSession) return undefined;
  return <RefreshControl tintColor={mute} refreshing={pulling} onRefresh={() => {
    haptics.soft();
    setPulling(true);
    void data.refresh();
  }} />;
}

/** Figma "Activity action" row: white, radius 16, 65 tall, label + chevron. */
export function ActionRow({ px, title, onPress, disabled, placed = false, detail, style, chevron = true }: {
  px: Px; title: string; onPress: () => void; disabled?: boolean; placed?: boolean; detail?: string; style?: StyleProp<ViewStyle>; chevron?: boolean;
}) {
  return <PressScale accessibilityRole="button" accessibilityLabel={detail ? title + ', ' + detail : title} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={[placed ? place(px, 16, 747, 358, 65, 16) : { width: px(358), height: px(65), borderRadius: px(16), marginTop: px(12) }, { backgroundColor: white }, style]}>
    <Text style={typeStyle(px, 15, medium, ink, place(px, 16, 21))}>{title}</Text>
    {!!detail && <Text numberOfLines={1} style={typeStyle(px, 12, regular, mute, { position: 'absolute', right: px(chevron ? 44 : 16), top: px(24), maxWidth: px(170), textAlign: 'right' })}>{detail}</Text>}
    {chevron && <Text style={typeStyle(px, 23, regular, mute, place(px, 322, 15))}>›</Text>}
  </PressScale>;
}

export function Card({ px, children, style }: { px: Px; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ width: px(358), borderRadius: px(18), backgroundColor: white, marginTop: px(18), overflow: 'hidden' }, style]}>{children}</View>;
}

export function Eyebrow({ px, value, style }: { px: Px; value: string; style?: StyleProp<ViewStyle> }) {
  return <View style={style}><Text style={typeStyle(px, 10, medium, mute)}>{value.toUpperCase()}</Text></View>;
}

export const Rule = ({ px, inset = 14 }: { px: Px; inset?: number }) =>
  <View style={{ height: 1, backgroundColor: rule, marginHorizontal: px(inset) }} />;

/** A labelled value inside a card (eyebrow, value, optional caption). Unknown values read "—". */
export function Field({ px, label, value, caption, right }: { px: Px; label: string; value: string | null; caption?: string | null; right?: ReactNode }) {
  return <View style={{ paddingHorizontal: px(14), paddingVertical: px(15), flexDirection: 'row', alignItems: 'center' }}>
    <View style={{ flex: 1 }}>
      <Text style={typeStyle(px, 10, medium, mute)}>{label.toUpperCase()}</Text>
      <Text style={typeStyle(px, 15, semibold, ink, { marginTop: px(6) })}>{value ?? '—'}</Text>
      {!!caption && <Text style={typeStyle(px, 12, regular, mute, { marginTop: px(4) })}>{caption}</Text>}
    </View>
    {right}
  </View>;
}

/** Status-panel style block: eyebrow, 25pt headline, 12pt caption. */
export function Headline({ px, eyebrow, title, caption, loading }: { px: Px; eyebrow: string; title: ReactNode; caption?: string; loading?: ReactNode }) {
  return <View style={{ paddingHorizontal: px(14), paddingTop: px(20), paddingBottom: px(22) }}>
    <Text style={typeStyle(px, 10, medium, mute)}>{eyebrow.toUpperCase()}</Text>
    <View style={{ marginTop: px(10), minHeight: px(25 * 1.21) }}>{loading ?? <Text style={typeStyle(px, 25, semibold, ink)}>{title}</Text>}</View>
    {!!caption && <Text style={typeStyle(px, 12, regular, mute, { marginTop: px(8) })}>{caption}</Text>}
  </View>;
}

export function Note({ px, children, style }: { px: Px; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ marginTop: px(32), width: px(358) }, style]}>
    <View style={{ height: 1, backgroundColor: rule }} />
    <Text style={typeStyle(px, 10, regular, mute, { marginTop: px(13), marginHorizontal: px(6) })}>{children}</Text>
  </View>;
}

export function SectionLabel({ px, value }: { px: Px; value: string }) {
  return <Text style={typeStyle(px, 11, medium, mute, { marginTop: px(26), marginLeft: px(8) })}>{value.toUpperCase()}</Text>;
}

export function BackButton({ px, label = 'Back' }: { px: Px; label?: string }) {
  const nav = useNav();
  return <PressScale accessibilityRole="button" accessibilityLabel={label} scale={0.9} onPress={nav.pop} style={place(px, 14, 45, 50, 50)}>
    <Text style={typeStyle(px, 28, medium, ink, place(px, 9, 7))}>‹</Text>
  </PressScale>;
}

/**
 * Pushed-screen scaffold: back chevron at (14, 45), 31pt title at y 105, 12pt caption, then flowing content
 * at the 16pt page inset. Content reveals in a short stagger after the push.
 */
export function SubScreen({ title, caption, children, back }: { title: string; caption?: string; children: ReactNode; back?: string }) {
  const px = usePx();
  const entry = useEntry();
  const refresh = usePullToRefresh();
  const onScroll = useAnimatedScrollHandler(event => { if (entry) entry.scroll.value = event.contentOffset.y; });
  return <Animated.ScrollView style={{ flex: 1 }} contentInsetAdjustmentBehavior="never" onScroll={onScroll} scrollEventThrottle={16}
    contentContainerStyle={{ paddingBottom: px(56), minHeight: px(920) }} refreshControl={refresh}>
    <BackButton px={px} label={back ?? 'Back'} />
    <View style={{ paddingTop: px(105), paddingHorizontal: px(16) }}>
      <Reveal delay={120}>
        <Text accessibilityRole="header" style={typeStyle(px, 31, semibold, ink, { marginLeft: px(6) })}>{title}</Text>
        {!!caption && <Text style={typeStyle(px, 12, regular, mute, { marginLeft: px(7), marginTop: px(2.5) })}>{caption}</Text>}
      </Reveal>
      <Reveal delay={190}>{children}</Reveal>
    </View>
  </Animated.ScrollView>;
}

export { At };
