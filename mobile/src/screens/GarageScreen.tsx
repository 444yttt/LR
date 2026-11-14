import { StatusBar, Text, View } from 'react-native';
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { VEHICLES, connectionState, metrics } from '../garageModel.ts';
import { PressScale, Reveal, Skeleton, haptics } from '../ui/motion';
import { modelInput, useData, usePullToRefresh } from '../ui/parts';
import { useNav } from '../ui/stack';
import { CardStage, cardStageOffset, cardStageOrigin, cardY } from '../ui/stage';
import { At, ink, medium, mute, place, regular, rule, semibold, typeStyle, useNow, usePx, white } from '../ui/theme';

/** 25 · Garage / Final. Layout coordinates are the Figma frame's, scaled to the window width. */
export function GarageScreen({ onAdd }: { onAdd: () => void }) {
  const px = usePx();
  const now = useNow();
  const data = useData();
  const nav = useNav();
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler(event => { scrollY.value = event.contentOffset.y; });
  const refresh = usePullToRefresh();
  const connection = connectionState(modelInput(data), now);
  const statuses = VEHICLES.map((vehicle, i) => i === 0 ? connection.status : vehicle.offlineStatus);
  const lastDrive = metrics(0, data.snapshot, now).lastDrive;
  // While a vehicle detail is presented, its car is flying on the hero layer, so the card leaves its stage empty.
  const first = nav.entries[0];
  const flying = first?.route.name === 'vehicle' ? first.route.vehicle : null;

  return <View style={{ flex: 1 }}>
    <StatusBar barStyle="dark-content" />
    <Animated.ScrollView style={{ flex: 1 }} contentInsetAdjustmentBehavior="never" onScroll={onScroll} scrollEventThrottle={16}
      contentContainerStyle={{ height: px(940) }} refreshControl={refresh}>
      <Reveal>
        <At px={px} value="Garage" x={22} y={58} size={35} font={semibold} />
        <At px={px} value={VEHICLES.length + ' VEHICLES'} x={24} y={109} size={11} font={medium} color={mute} />
      </Reveal>
      <PressScale accessibilityRole="button" accessibilityLabel="Add vehicle" hitSlop={10} scale={0.86} onPress={onAdd} style={place(px, 338, 59, 32, 42)}>
        <Text style={typeStyle(px, 27, regular, ink)}>＋</Text>
      </PressScale>
      {VEHICLES.map((vehicle, i) => <Reveal key={vehicle.id} index={i} delay={90} distance={18} style={place(px, 16, cardY[i], 358, 225)}>
        <PressScale accessibilityRole="button" accessibilityLabel={vehicle.name + ', ' + statuses[i]} accessibilityHint="Opens vehicle details"
          scale={0.97} feedback="none"
          onPress={() => {
            haptics.open();
            nav.push({ name: 'vehicle', vehicle: i }, cardStageOrigin(px, i, scrollY.value));
          }}
          style={{ width: px(358), height: px(225), borderRadius: px(19), backgroundColor: white }}>
          <At px={px} value={vehicle.name} x={15} y={20} size={20} font={semibold} />
          <Text style={typeStyle(px, 23, regular, mute, place(px, 325, 16))}>›</Text>
          <At px={px} value={statuses[i].toUpperCase()} x={15} y={51} size={10} font={medium} color={mute} />
          <View style={[place(px, cardStageOffset.x, cardStageOffset.y, 325, 121), { opacity: flying === i ? 0 : 1 }]}>
            <CardStage px={px} index={i} />
          </View>
          <View style={[place(px, 14, 192, 330, 1), { backgroundColor: rule }]} />
          <At px={px} value={i === 0 ? 'LAST DRIVE' : 'CONNECTION'} x={14} y={200} size={9} font={medium} color={mute} />
          {i === 0 && connection.loading
            ? <Skeleton width={px(74)} height={px(9)} radius={px(4)} style={place(px, 209, 201)} />
            : <At px={px} value={i === 0 ? (lastDrive ?? 'UNVERIFIED') : 'NO DATA'} x={209} y={200} size={10} font={medium} width={130} />}
        </PressScale>
      </Reveal>)}
    </Animated.ScrollView>
  </View>;
}
