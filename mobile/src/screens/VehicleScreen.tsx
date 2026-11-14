import { Pressable, Text, View } from 'react-native';
import Animated, { useAnimatedScrollHandler } from 'react-native-reanimated';
import { VEHICLES, connectionState, healthView, lastUpdateLine, metrics } from '../garageModel.ts';
import { CountUp, PressScale, Skeleton, useProgressReveal } from '../ui/motion';
import { ActionRow, BackButton, useFeed, usePullToRefresh } from '../ui/parts';
import { useNav, type Entry } from '../ui/stack';
import { HeroStage } from '../ui/stage';
import { At, ink, medium, mute, place, regular, rule, semibold, typeStyle, useNow, usePx, white, type Px } from '../ui/theme';

/**
 * 26–28 · vehicle detail. The car, floor, and contact shadow arrive on the hero layer; every other block
 * fades up in sequence from the same progress value, so the back swipe scrubs the whole transition.
 */
export function VehicleScreen({ entry, vehicle }: { entry: Entry; vehicle: number }) {
  const px = usePx();
  const now = useNow();
  const nav = useNav();
  const info = VEHICLES[vehicle];
  // Only a vehicle with a feed (production: the Range Rover) shows values; the others keep their offline copy.
  const feed = useFeed(vehicle);
  const connection = feed ? connectionState(feed, now, vehicle) : null;
  const loading = connection?.loading ?? false;
  const values = metrics(feed, now);
  const health = healthView(vehicle, feed, now);
  const status = connection?.status ?? info.offlineStatus;
  const footer = feed ? (feed.demo ? 'Demo data · ' : '') + lastUpdateLine(feed.snapshot, now) : 'Live vehicle data unavailable';
  const refresh = usePullToRefresh();
  const onScroll = useAnimatedScrollHandler(event => { entry.scroll.value = event.contentOffset.y; });
  const p = entry.progress;
  const header = useProgressReveal(p, 0.34);
  const info1 = useProgressReveal(p, 0.4);
  const info2 = useProgressReveal(p, 0.46);
  const info3 = useProgressReveal(p, 0.5);
  const info4 = useProgressReveal(p, 0.55);
  const back = useProgressReveal(p, 0.36, 0);
  const metric = typeStyle(px, 25, semibold, ink);

  return <Animated.ScrollView style={{ flex: 1 }} contentInsetAdjustmentBehavior="never" onScroll={onScroll} scrollEventThrottle={16}
    contentContainerStyle={{ height: px(920) }} refreshControl={feed && !feed.demo ? refresh : undefined}>
    <Animated.View style={[place(px, 0, 0, 390, 100), back]}>
      <BackButton px={px} label="Back to Garage" />
    </Animated.View>
    <Animated.View style={[place(px, 0, 0, 390, 200), header]} pointerEvents="box-none">
      <Text accessibilityRole="header" style={typeStyle(px, 31, semibold, ink, place(px, 22, 105))}>{info.name}</Text>
      <At px={px} value={info.model} x={23} y={145} size={12} color={mute} />
      <Pressable accessibilityRole="button" accessibilityLabel={'Connection: ' + status} accessibilityHint="Opens connection settings"
        hitSlop={10} onPress={() => nav.push({ name: 'connection', vehicle })} style={place(px, 23, 170)}>
        <Text style={typeStyle(px, 10, medium, mute)}>{status.toUpperCase()}</Text>
      </Pressable>
    </Animated.View>

    <HeroStage px={px} index={vehicle} origin={entry.origin} progress={p} scrollOffset={entry.scroll} onReady={entry.begin} />

    <Animated.View style={[place(px, 16, 421, 358, 167, 18), { backgroundColor: white }, info1]}>
      <View style={[place(px, 174, 21, 1, 125), { backgroundColor: rule }]} />
      <View style={[place(px, 14, 94, 328, 1), { backgroundColor: rule }]} />
      <At px={px} value="RANGE" x={14} y={22} size={10} font={medium} color={mute} />
      <Metric px={px} x={14} y={45} loading={loading} value={values.rangeKm} suffix=" km" empty="— km" style={metric} />
      <At px={px} value="FUEL" x={188} y={22} size={10} font={medium} color={mute} />
      <Metric px={px} x={188} y={45} loading={loading} value={values.fuelPercent} suffix=" %" empty="— %" style={metric} />
      <At px={px} value="LAST DRIVE" x={14} y={108} size={10} font={medium} color={mute} />
      {loading ? <Skeleton width={px(96)} height={px(13)} radius={px(5)} style={place(px, 14, 131)} />
        : <At px={px} value={values.lastDrive ?? '—'} x={14} y={128} size={15} font={semibold} />}
      <At px={px} value="IDLE" x={188} y={108} size={10} font={medium} color={mute} />
      {loading ? <Skeleton width={px(56)} height={px(13)} radius={px(5)} style={place(px, 188, 131)} />
        : <At px={px} value={values.idleDays !== null ? values.idleDays + (values.idleDays === 1 ? ' day' : ' days') : '—'} x={188} y={128} size={16} font={semibold} />}
    </Animated.View>

    <Animated.View style={[place(px, 16, 606, 358, 121), info2]}>
      <PressScale accessibilityRole="button" accessibilityLabel={'Vehicle status: ' + health.title + '. ' + health.caption} accessibilityHint="Opens vehicle status"
        onPress={() => nav.push({ name: 'status', vehicle })} style={{ width: px(358), height: px(121), borderRadius: px(18), backgroundColor: white }}>
        <At px={px} value="VEHICLE STATUS" x={14} y={20} size={10} font={medium} color={mute} />
        {loading ? <Skeleton width={px(150)} height={px(20)} radius={px(6)} style={place(px, 14, 51)} />
          : <At px={px} value={health.title} x={14} y={46} size={25} font={semibold} />}
        <At px={px} value={health.caption} x={14} y={84} size={12} color={mute} />
      </PressScale>
    </Animated.View>

    <Animated.View style={[place(px, 0, 747, 390, 65), info3]}>
      <ActionRow px={px} style={{ position: 'absolute', left: px(16), top: 0, marginTop: 0 }}
        title={feed ? 'Recent drives' : 'Connection settings'}
        onPress={() => nav.push(feed ? { name: 'drives', vehicle } : { name: 'connection', vehicle })} />
    </Animated.View>

    <Animated.View style={[place(px, 16, 838, 358, 40), info4]}>
      <View style={{ height: 1, backgroundColor: rule }} />
      <Pressable accessibilityRole="button" accessibilityHint="Opens connection settings" onPress={() => nav.push({ name: 'connection', vehicle })} hitSlop={8}>
        <Text style={typeStyle(px, 10, regular, mute, { marginTop: px(13), marginLeft: px(6) })}>{footer}</Text>
      </Pressable>
    </Animated.View>
  </Animated.ScrollView>;
}

function Metric({ px, x, y, loading, value, suffix, empty, style }: {
  px: Px; x: number; y: number; loading: boolean; value: number | null; suffix: string; empty: string; style: ReturnType<typeof typeStyle>;
}) {
  if (loading) return <Skeleton width={px(92)} height={px(20)} radius={px(6)} style={place(px, x, y + 5)} />;
  return <View style={place(px, x, y, 150)}>
    <CountUp value={value} suffix={suffix} empty={empty} style={style} />
  </View>;
}
