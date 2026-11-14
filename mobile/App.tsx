import { useState } from 'react';
import { Image, Modal, Pressable, RefreshControl, ScrollView, StatusBar, Text, View, useWindowDimensions, type TextStyle } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { SvgXml } from 'react-native-svg';
import { floorSvg, shadowSvg } from './src/stageAssets';
import { useGarage } from './src/useGarage';
import { enableInactivityAlerts, notifyIfDue } from './src/notifications';
import { idleDays, isFresh } from './src/telemetry';

const cars = [
  { name: 'Range Rover', model: 'L460', image: require('./assets/range-rover-l460.png') },
  { name: 'Ferrari 296', model: 'Ferrari', image: require('./assets/ferrari-296.png') },
  { name: 'BMW M4', model: 'BMW', image: require('./assets/bmw-m4.png') },
];

const page = '#F8F8F7';
const ink = '#1B1D20';
const mute = '#73777D';
const rule = '#E3E5E6';
const white = '#FFFFFF';
const regular = 'Inter_400Regular';
const medium = 'Inter_500Medium';
const semibold = 'Inter_600SemiBold';
const designWidth = 390;
// Inter typo ascender 1984 + descender 494, unitsPerEm 2048. Cap tops then sit ~0.241em below the line top.
const interLine = (1984 + 494) / 2048;
const dateFormat = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Tokyo' });
const displayDate = (date: string) => dateFormat.format(new Date(date));

type Px = (value: number) => number;

function usePx(): Px {
  const { width } = useWindowDimensions();
  const scale = width > 0 ? width / designWidth : 1;
  return (value) => value * scale;
}

const cardY = [156, 395, 634];
const floors = [
  { x: 16.5, y: 99.04, w: 292, h: 27 },
  { x: 9, y: 128.12, w: 338, h: 56 },
];
// Contact-shadow SVGs include the layer-blur padding (radius 4 on cards, 6 on detail).
const shadows = [
  [
    { x: 71.28, y: 109, w: 182.45, h: 6, blur: 4 },
    { x: 72.61, y: 109, w: 179.78, h: 6, blur: 4 },
    { x: 64.6, y: 109, w: 195.8, h: 6, blur: 4 },
  ],
  [
    { x: 52.96, y: 152, w: 250.09, h: 8, blur: 6 },
    { x: 50.73, y: 152, w: 254.54, h: 8, blur: 6 },
    { x: 42.72, y: 152, w: 270.56, h: 8, blur: 6 },
  ],
];
const profiles = [
  [
    { x: 60, y: 30.02, w: 205, h: 82 },
    { x: 61.5, y: 53.57, w: 202, h: 58.4 },
    { x: 52.5, y: 40.16, w: 220, h: 71.8 },
  ],
  [
    { x: 37.5, y: 42.63, w: 281, h: 112.4 },
    { x: 35, y: 72.28, w: 286, h: 82.7 },
    { x: 26, y: 55.73, w: 304, h: 99.3 },
  ],
];

function place(px: Px, x: number, y: number, w?: number, h?: number, radius?: number) {
  return {
    position: 'absolute' as const,
    left: px(x),
    top: px(y),
    width: w === undefined ? undefined : px(w),
    height: h === undefined ? undefined : px(h),
    borderRadius: radius === undefined ? undefined : px(radius),
  };
}

function typeStyle(px: Px, size: number, font: string, color: string, extra?: TextStyle): TextStyle {
  return {
    fontFamily: font,
    fontSize: px(size),
    lineHeight: px(size * interLine),
    color,
    letterSpacing: 0,
    ...extra,
  };
}

function At({ px, value, x, y, size, font = regular, color = ink, width }: { px: Px; value: string; x: number; y: number; size: number; font?: string; color?: string; width?: number }) {
  return <Text style={typeStyle(px, size, font, color, { position: 'absolute', left: px(x), top: px(y), width: width === undefined ? undefined : px(width) })}>{value}</Text>;
}

function Stage({ px, index, detail = false }: { px: Px; index: number; detail?: boolean }) {
  const mode = detail ? 1 : 0;
  const floor = floors[mode];
  const shadow = shadows[mode][index];
  const profile = profiles[mode][index];
  return <View style={place(px, detail ? 17 : 0, detail ? 208 : 0, detail ? 356 : 325, detail ? 204 : 121)} accessible={false} pointerEvents="none">
    <View style={place(px, floor.x, floor.y, floor.w, floor.h)}>
      <SvgXml xml={floorSvg[mode]} width="100%" height="100%" />
    </View>
    <View style={place(px, shadow.x - shadow.blur, shadow.y - shadow.blur, shadow.w + shadow.blur * 2, shadow.h + shadow.blur * 2)}>
      <SvgXml xml={shadowSvg[mode][index]} width="100%" height="100%" />
    </View>
    <Image source={cars[index].image} resizeMode="contain" accessible={false} style={place(px, profile.x, profile.y, profile.w, profile.h)} />
  </View>;
}

function Action({ px, title, onPress, disabled, placed = false }: { px: Px; title: string; onPress: () => void; disabled?: boolean; placed?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [placed ? place(px, 16, 747, 358, 65, 16) : { width: px(358), height: px(65), borderRadius: px(16), marginTop: px(20) },
      { backgroundColor: white, opacity: pressed || disabled ? 0.55 : 1 }]}>
    <Text style={typeStyle(px, 15, medium, ink, place(px, 16, 21))}>{title}</Text>
    <Text style={typeStyle(px, 23, regular, mute, place(px, 322, 15))}>›</Text>
  </Pressable>;
}

function Garage() {
  const px = usePx();
  const [index, setIndex] = useState<number | null>(null);
  const [sheet, setSheet] = useState<'drives' | 'connection' | 'add' | null>(null);
  const [alertStatus, setAlertStatus] = useState('');
  const data = useGarage();
  const { snapshot, phase } = data;
  const now = Date.now();
  const roverStatus = phase === 'expired' ? 'Sign-in expired'
    : phase === 'failed' || snapshot?.status === 'error' ? 'Update failed'
    : snapshot?.status === 'reauthorize' ? 'JLR authorization expired'
    : phase === 'loading' ? 'Updating'
    : snapshot?.status === 'pending' ? 'Waiting for vehicle data'
    : snapshot?.fetchedAt ? (isFresh(snapshot, now) ? 'Last update available' : 'Last update is stale')
    : 'Sync unverified';
  const statuses = [roverStatus, 'Not connected', 'Setup required'];
  const lastDrive = snapshot?.lastDriveVerified && snapshot.lastDriveAt ? displayDate(snapshot.lastDriveAt) : null;
  const recentDrives = snapshot?.lastDriveVerified ? snapshot.trips : null;
  const idle = idleDays(snapshot, now);
  const isRover = index === 0;
  const roverHealth = snapshot && isFresh(snapshot, now) ? snapshot.health : null;
  const statusTitle = isRover ? (roverHealth === 'good' ? 'No reported issues'
    : roverHealth === 'service-required' ? 'Service required'
    : roverHealth === 'attention-required' ? 'Attention required' : 'Not checked')
    : index === 1 ? 'Not connected' : 'Setup required';
  const description = isRover ? (roverHealth ? 'Reported by JLR diagnostics' : 'Health data not yet verified')
    : index === 1 ? 'Vehicle data source not connected' : 'Vehicle data setup is incomplete';
  const footer = isRover ? (snapshot?.fetchedAt ? 'Last successful update · ' + displayDate(snapshot.fetchedAt) + ' JST' : 'No verified vehicle update available')
    : 'Live vehicle data unavailable';
  const frame = index === null ? 940 : 920;

  return <View style={{ flex: 1, backgroundColor: page }}>
    <StatusBar barStyle="dark-content" />
    <ScrollView key={index ?? 'garage'} style={{ flex: 1 }} contentInsetAdjustmentBehavior="never"
      contentContainerStyle={{ height: px(frame) }}
      refreshControl={data.hasSession ? <RefreshControl refreshing={phase === 'loading'} onRefresh={() => void data.refresh()} /> : undefined}>
      {index === null ? <View style={{ height: px(940) }}>
        <At px={px} value="Garage" x={22} y={58} size={35} font={semibold} />
        <Pressable accessibilityRole="button" accessibilityLabel="Add vehicle" hitSlop={10} onPress={() => setSheet('add')} style={place(px, 338, 59, 32, 42)}>
          <Text style={typeStyle(px, 27, regular, ink)}>＋</Text>
        </Pressable>
        <At px={px} value="3 VEHICLES" x={24} y={109} size={11} font={medium} color={mute} />
        {cars.map((car, i) => <Pressable key={car.name} accessibilityRole="button" accessibilityLabel={car.name + ', ' + statuses[i]}
          onPress={() => setIndex(i)} style={[place(px, 16, cardY[i], 358, 225, 19), { backgroundColor: white }]}>
          <At px={px} value={car.name} x={15} y={20} size={20} font={semibold} />
          <Text style={typeStyle(px, 23, regular, mute, place(px, 325, 16))}>›</Text>
          <At px={px} value={statuses[i].toUpperCase()} x={15} y={51} size={10} font={medium} color={mute} />
          <View style={place(px, 18, 70, 325, 121)}>
            <Stage px={px} index={i} />
          </View>
          <View style={[place(px, 14, 192, 330, 1), { backgroundColor: rule }]} />
          <At px={px} value={i === 0 ? 'LAST DRIVE' : 'CONNECTION'} x={14} y={200} size={9} font={medium} color={mute} />
          <At px={px} value={i === 0 ? (lastDrive ?? 'UNVERIFIED') : 'NO DATA'} x={209} y={200} size={10} font={medium} width={130} />
        </Pressable>)}
      </View> : <View style={{ height: px(920) }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to Garage" onPress={() => setIndex(null)} style={place(px, 14, 45, 50, 50)}>
          <Text style={typeStyle(px, 28, medium, ink, place(px, 9, 7))}>‹</Text>
        </Pressable>
        <At px={px} value={cars[index].name} x={22} y={105} size={31} font={semibold} />
        <At px={px} value={cars[index].model} x={23} y={145} size={12} color={mute} />
        <Pressable accessibilityRole="button" accessibilityLabel="Data connection status" onPress={() => setSheet('connection')} hitSlop={8} style={place(px, 23, 170)}>
          <Text style={typeStyle(px, 10, medium, mute)}>{statuses[index].toUpperCase()}</Text>
        </Pressable>
        <Stage px={px} index={index} detail />
        <View style={[place(px, 16, 421, 358, 167, 18), { backgroundColor: white }]} />
        <View style={[place(px, 190, 442, 1, 125), { backgroundColor: rule }]} />
        <View style={[place(px, 30, 515, 328, 1), { backgroundColor: rule }]} />
        <At px={px} value="RANGE" x={30} y={443} size={10} font={medium} color={mute} />
        <At px={px} value={isRover && snapshot?.rangeKm != null ? snapshot.rangeKm + ' km' : '— km'} x={30} y={466} size={25} font={semibold} />
        <At px={px} value="FUEL" x={204} y={443} size={10} font={medium} color={mute} />
        <At px={px} value={isRover && snapshot?.fuelPercent != null ? snapshot.fuelPercent + ' %' : '— %'} x={204} y={466} size={25} font={semibold} />
        <At px={px} value="LAST DRIVE" x={30} y={529} size={10} font={medium} color={mute} />
        <At px={px} value={isRover ? (lastDrive ?? '—') : '—'} x={30} y={549} size={15} font={semibold} />
        <At px={px} value="IDLE" x={204} y={529} size={10} font={medium} color={mute} />
        <At px={px} value={isRover && idle !== null ? idle + (idle === 1 ? ' day' : ' days') : '—'} x={204} y={549} size={16} font={semibold} />
        <View style={[place(px, 16, 606, 358, 121, 18), { backgroundColor: white }]} />
        <At px={px} value="VEHICLE STATUS" x={30} y={626} size={10} font={medium} color={mute} />
        <At px={px} value={statusTitle} x={30} y={652} size={25} font={semibold} />
        <At px={px} value={description} x={30} y={690} size={12} color={mute} />
        <Action px={px} placed title={isRover ? 'Recent drives' : 'Connection settings'} onPress={() => setSheet(isRover ? 'drives' : 'connection')} />
        <View style={[place(px, 16, 838, 358, 1), { backgroundColor: rule }]} />
        <At px={px} value={footer} x={22} y={852} size={10} color={mute} />
      </View>}
    </ScrollView>
    <Modal visible={sheet !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSheet(null)}>
      <SafeAreaView style={{ flex: 1, backgroundColor: page }}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: px(16), paddingBottom: px(24) }}>
          <Action px={px} title="Done" onPress={() => setSheet(null)} />
          <Text style={typeStyle(px, 28, semibold, ink, { marginVertical: px(18) })}>{sheet === 'drives' ? 'Recent drives' : sheet === 'add' ? 'Add vehicle' : 'Data connection'}</Text>
          {sheet === 'drives' ? <>
            {!recentDrives?.length && <Text style={typeStyle(px, 14, regular, mute)}>{recentDrives ? 'No recent drives available.' : 'Verified drive history is unavailable.'}</Text>}
            {recentDrives?.map(date => <View key={date} style={{ width: px(358), minHeight: px(65), borderRadius: px(16), backgroundColor: white, justifyContent: 'center', paddingHorizontal: px(16), marginTop: px(20) }}>
              <Text style={typeStyle(px, 15, regular, ink)}>{displayDate(date) + ' JST'}</Text>
            </View>)}
          </> : sheet === 'add' ? <Text style={typeStyle(px, 14, regular, mute)}>Adding a vehicle is unavailable in this build.</Text>
          : isRover ? <>
            <Text style={typeStyle(px, 17, medium, ink)}>{roverStatus}</Text>
            <Text style={typeStyle(px, 12, regular, mute, { marginVertical: px(12) })}>{phase === 'unconfigured' ? 'Vehicle sign-in is not configured for this build.'
              : snapshot?.status === 'reauthorize' ? 'Reconnect the JLR account before updating vehicle data.'
              : phase === 'expired' ? 'Sign in again to restore access.' : footer}</Text>
            {phase !== 'unconfigured' && (data.hasSession
              ? <Action px={px} title="Refresh data" disabled={phase === 'loading'} onPress={() => void data.refresh()} />
              : data.discoveryFailed
                ? <Action px={px} title="Retry sign-in setup" onPress={data.retryDiscovery} />
                : <Action px={px} title="Sign in" disabled={!data.canSignIn || phase === 'signingIn'} onPress={() => void data.signIn()} />)}
            <Action px={px} title="Enable inactivity alerts" onPress={() => void enableInactivityAlerts().then(async ok => {
              setAlertStatus(ok ? 'Inactivity alerts enabled on this device.' : 'Notifications are disabled in iOS Settings.');
              if (ok && snapshot) await notifyIfDue(snapshot);
            }).catch(() => setAlertStatus('Unable to enable or deliver notifications.'))} />
            {!!alertStatus && <Text style={typeStyle(px, 12, regular, mute, { marginTop: px(10) })}>{alertStatus}</Text>}
            {data.notificationFailed && <Text style={typeStyle(px, 12, regular, mute, { marginTop: px(10) })}>Notification delivery could not be scheduled.</Text>}
          </> : <Text style={typeStyle(px, 14, regular, mute)}>{description}</Text>}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  </View>;
}

export default function App() {
  const [loaded, error] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold });
  if (!loaded && !error) return <View style={{ flex: 1, backgroundColor: page }} />;
  return <SafeAreaProvider><Garage /></SafeAreaProvider>;
}
