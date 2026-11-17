import { Pressable, StyleSheet, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedScrollHandler } from 'react-native-reanimated';
import { VEHICLES, connectionState, healthView, lastUpdateLine, metrics, offersUpdateNow } from '../garageModel.ts';
import { CountUp, PressScale, Skeleton, useProgressReveal } from '../ui/motion';
import { ActionRow, NavBar, useFeed } from '../ui/parts';
import { useSafeFrame } from '../ui/safe';
import { vehicleLayout, vehicleRows } from '../ui/safeArea';
import { useSpecs } from '../ui/specs';
import { displayName, modelLine, titleSize, titleWidth } from '../vehicleSpecs.ts';
import { useNav, useSwipeDismiss, type Entry } from '../ui/stack';
import { LiveStatusLine, UpdateNowButton, UpdatingPulse } from '../ui/live';
import { HeroStage } from '../ui/stage';
import { At, Label, ink, medium, mute, place, regular, rule, semibold, typeStyle, useNow, usePx, white, type Px } from '../ui/theme';

/**
 * 26–28 · vehicle detail. The car, floor, and contact shadow arrive on the hero layer; every other block
 * fades up in sequence from the same progress value, so the back button, the edge swipe and the swipe down all play
 * (or scrub) the same transition in reverse. Back and "Update now" sit in the fixed NavBar slots above the scroll view.
 *
 * No pull-to-refresh here: at the top of the list a downward pull closes the screen (stack.useSwipeDismiss), so the
 * scroll view does not bounce at the top. The same live read stays on the "Update now" button and the Garage's pull.
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
  // "Update now" only where a live read makes sense: a signed-in feed that is not waiting for its first data.
  const updatable = connection ? offersUpdateNow(connection) : false;
  const footer = feed ? (feed.demo ? 'Demo data · ' : '') + lastUpdateLine(feed.snapshot, now) : 'Live vehicle data unavailable';
  const onScroll = useAnimatedScrollHandler(event => { entry.scroll.value = event.contentOffset.y; });
  const p = entry.progress;
  const header = useProgressReveal(p, 0.34);
  const info1 = useProgressReveal(p, 0.4);
  const info2 = useProgressReveal(p, 0.46);
  const info3 = useProgressReveal(p, 0.5);
  const info4 = useProgressReveal(p, 0.53);
  const info5 = useProgressReveal(p, 0.56);
  const info6 = useProgressReveal(p, 0.6);
  const back = useProgressReveal(p, 0.36, 0);
  const metric = typeStyle(px, 25, semibold, ink);
  const safe = useSafeFrame();
  // Owner-entered specs (on-device only): composed title, model year on the model line, options card when present.
  const specs = useSpecs(vehicle);
  const name = displayName(info.name, specs);
  const size = titleSize(name);
  const frame = vehicleLayout(specs.options.length);
  const dismiss = useSwipeDismiss(entry);

  return <View style={{ flex: 1 }}><GestureDetector gesture={dismiss.gesture}><Animated.ScrollView ref={dismiss.ref} testID="vehicle-scroll" style={{ flex: 1 }}
    {...safe.scroll} onScroll={onScroll} scrollEventThrottle={16} bounces={false}
    contentContainerStyle={{ height: safe.canvasHeight(frame.height, frame.contentBottom) }}>
    {/* The Figma canvas, shifted below the status bar / Dynamic Island by the same amount as the Garage canvas. */}
    <View testID="vehicle-canvas" style={{ position: 'absolute', left: 0, right: 0, top: safe.top, height: px(frame.height) }} pointerEvents="box-none">
      <Animated.View style={[place(px, 0, 0, 390, 200), header]} pointerEvents="box-none">
        {/* One line; a long composed name steps down in size with its baseline kept where the 31pt title's sits. */}
        <Label testID="vehicle-title" accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}
          style={typeStyle(px, size, semibold, ink, place(px, 22, 105 + (31 - size) * 1984 / 2048, titleWidth))}>{name}</Label>
        <At px={px} value={modelLine(info.model, specs)} x={23} y={145} size={12} color={mute} width={340} />
        <Pressable accessibilityRole="button" accessibilityLabel={'Connection: ' + status} accessibilityHint="Opens connection settings"
          hitSlop={10} onPress={() => nav.push({ name: 'connection', vehicle })} style={place(px, 23, 170)}>
          <Label style={typeStyle(px, 10, medium, mute)}>{status.toUpperCase()}</Label>
        </Pressable>
      </Animated.View>


      <Animated.View style={[place(px, 16, 421, 358, 167, 18), { backgroundColor: white }, info1]}>
        <View style={[place(px, 174, 21, 1, 125), { backgroundColor: rule }]} />
        <View style={[place(px, 14, 94, 328, 1), { backgroundColor: rule }]} />
        <At px={px} value="RANGE" x={14} y={22} size={10} font={medium} color={mute} />
        <At px={px} value="FUEL" x={188} y={22} size={10} font={medium} color={mute} />
        <At px={px} value="LAST DRIVE" x={14} y={108} size={10} font={medium} color={mute} />
        <At px={px} value="IDLE" x={188} y={108} size={10} font={medium} color={mute} />
        {/* Values breathe while the vehicle is being read; new values then glide in through CountUp. */}
        <UpdatingPulse vehicle={vehicle} style={StyleSheet.absoluteFill}>
          <Metric px={px} x={14} y={45} loading={loading} value={values.rangeKm} suffix=" km" empty="— km" style={metric} />
          <Metric px={px} x={188} y={45} loading={loading} value={values.fuelPercent} suffix=" %" empty="— %" style={metric} />
          {loading ? <Skeleton width={px(96)} height={px(13)} radius={px(5)} style={place(px, 14, 131)} />
            : <At px={px} value={values.lastDrive ?? '—'} x={14} y={128} size={15} font={semibold} />}
          {loading ? <Skeleton width={px(56)} height={px(13)} radius={px(5)} style={place(px, 188, 131)} />
            : <At px={px} value={values.idleDays !== null ? values.idleDays + (values.idleDays === 1 ? ' day' : ' days') : '—'} x={188} y={128} size={16} font={semibold} />}
        </UpdatingPulse>
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

      <Animated.View style={[place(px, 0, frame.action, 390, 65), info3]}>
        <ActionRow px={px} style={{ position: 'absolute', left: px(16), top: 0, marginTop: 0 }}
          title={feed ? 'Recent drives' : 'Connection settings'}
          onPress={() => nav.push(feed ? { name: 'drives', vehicle } : { name: 'connection', vehicle })} />
      </Animated.View>

      <Animated.View style={[place(px, 0, frame.specs, 390, 65), info4]}>
        <ActionRow px={px} style={{ position: 'absolute', left: px(16), top: 0, marginTop: 0 }} title="Vehicle specs"
          onPress={() => nav.push({ name: 'specs', vehicle })} />
      </Animated.View>

      {frame.options && <Animated.View testID="vehicle-options" accessible accessibilityLabel={'Options: ' + specs.options.join(', ')}
        style={[place(px, 16, frame.options.y, 358, frame.options.height, 18), { backgroundColor: white }, info5]}>
        <At px={px} value="OPTIONS" x={14} y={20} size={10} font={medium} color={mute} />
        {specs.options.map((option, i) => <Label key={i} numberOfLines={1}
          style={typeStyle(px, 14, regular, ink, place(px, 14, vehicleRows.optionsTop + i * vehicleRows.optionLine, 330))}>{option}</Label>)}
      </Animated.View>}

      <Animated.View style={[place(px, 16, frame.footer, 358, 40), info6]}>
        <View style={{ height: 1, backgroundColor: rule }} />
        <Pressable accessibilityRole="button" accessibilityHint="Opens connection settings" onPress={() => nav.push({ name: 'connection', vehicle })} hitSlop={8}>
          <View style={{ marginTop: px(13), marginLeft: px(6) }}>
            <LiveStatusLine vehicle={vehicle} idle={footer} style={typeStyle(px, 10, regular, mute)} />
          </View>
        </Pressable>
      </Animated.View>

      {/* Last in the canvas: the flying car passes over the fading blocks, never under them. At rest the stage
          (y 208–412) overlaps no block, so the resting frame is unchanged. */}
      <HeroStage px={px} index={vehicle} origin={entry.origin} progress={p} scrollOffset={entry.scroll} onReady={entry.begin} top={safe.top} travel={entry.travel} />
    </View>
  </Animated.ScrollView></GestureDetector>
  <NavBar back="Back to Garage" leadingStyle={back} trailing={updatable ? <UpdateNowButton px={px} vehicle={vehicle} /> : undefined} trailingStyle={header} />
  </View>;
}

function Metric({ px, x, y, loading, value, suffix, empty, style }: {
  px: Px; x: number; y: number; loading: boolean; value: number | null; suffix: string; empty: string; style: ReturnType<typeof typeStyle>;
}) {
  if (loading) return <Skeleton width={px(92)} height={px(20)} radius={px(6)} style={place(px, x, y + 5)} />;
  return <View style={place(px, x, y, 150)}>
    <CountUp value={value} suffix={suffix} empty={empty} style={style} />
  </View>;
}
