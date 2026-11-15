import { useState } from 'react';
import { Image, Modal, Pressable, RefreshControl, ScrollView, StatusBar, StyleSheet, Text, View, type TextStyle } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { SvgXml } from 'react-native-svg';
import { floorSvg, shadowSvg } from './src/stageAssets';
import { useGarage } from './src/useGarage';
import { enableInactivityAlerts, notifyIfDue } from './src/notifications';
import { idleDays, isFresh } from './src/telemetry';

const cars = [
  { name: 'Range Rover', model: 'L460', image: require('./assets/range-rover-l460.png'), ratio: 1713 / 685, widths: [205, 281] },
  { name: 'Ferrari 296', model: 'Ferrari', image: require('./assets/ferrari-296.png'), ratio: 1784 / 516, widths: [202, 286] },
  { name: 'BMW M4', model: 'BMW', image: require('./assets/bmw-m4.png'), ratio: 1721 / 562, widths: [220, 304] },
];
const palette = { page: '#f8f8f7', ink: '#1b1d20', secondary: '#73777d', line: '#e3e5e6', white: '#ffffff' };
const regular = 'Inter_400Regular';
const medium = 'Inter_500Medium';
const semibold = 'Inter_600SemiBold';
const dateFormat = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Tokyo' });
const displayDate = (date: string) => dateFormat.format(new Date(date));

function Copy({ value, size = 12, font = regular, muted = false, style }: { value: string; size?: number; font?: string; muted?: boolean; style?: TextStyle }) {
  return <Text style={[{ fontSize: size, fontFamily: font, color: muted ? palette.secondary : palette.ink }, style]}>{value}</Text>;
}

function Stage({ index, detail = false }: { index: number; detail?: boolean }) {
  const car = cars[index];
  const mode = detail ? 1 : 0;
  const width = car.widths[mode];
  const height = width / car.ratio;
  const baseline = detail ? 155 : 112;
  const floorHeight = detail ? 56 : 27;
  const shadowHeight = detail ? 20 : 14;
  return <View style={[styles.stage, { height: detail ? 204 : 121 }]} accessible={false}>
    <View pointerEvents="none" style={[styles.artLayer, { top: baseline - floorHeight * .48 }]}>
      <SvgXml xml={floorSvg[mode]} />
    </View>
    <View pointerEvents="none" style={[styles.artLayer, { top: baseline - (detail ? 9 : 7), height: shadowHeight }]}>
      <SvgXml xml={shadowSvg[mode][index]} />
    </View>
    <View pointerEvents="none" style={[styles.artLayer, { top: baseline - height }]}>
      <Image source={car.image} style={{ width, height }} resizeMode="contain" accessible={false} />
    </View>
  </View>;
}

function Metric({ title, value, large }: { title: string; value: string; large?: boolean }) {
  return <View style={styles.metric}><Copy value={title} muted size={10} font={medium} />
    <Copy value={value} size={large ? 25 : 15} font={semibold} style={{ marginTop: 8 }} /></View>;
}

function Action({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.action, { opacity: pressed || disabled ? .55 : 1 }]}>
    <Copy value={title} size={15} font={medium} /><Copy value="›" size={23} muted />
  </Pressable>;
}

function Garage() {
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

  return <SafeAreaView style={styles.page} edges={['top', 'bottom']}>
    <StatusBar barStyle="dark-content" />
    <ScrollView key={index ?? 'garage'} contentContainerStyle={styles.body}
      refreshControl={data.hasSession ? <RefreshControl refreshing={phase === 'loading'} onRefresh={() => void data.refresh()} /> : undefined}>
      {index === null ? <>
        <View style={styles.garageHeader}>
          <Copy value="Garage" size={35} font={semibold} />
          <Pressable accessibilityRole="button" accessibilityLabel="Add vehicle" hitSlop={10} onPress={() => setSheet('add')}>
            <Copy value="＋" size={29} />
          </Pressable>
        </View>
        <Copy value="3 VEHICLES" size={11} muted style={styles.garageCount} />
        {cars.map((car, i) => <Pressable key={car.name} accessibilityRole="button" accessibilityLabel={car.name + ', ' + statuses[i]}
          onPress={() => setIndex(i)} style={styles.card}>
          <Copy value={car.name} size={20} font={semibold} />
          <Copy value={statuses[i].toUpperCase()} size={10} muted font={medium} style={{ marginTop: 7 }} />
          <Copy value="›" size={23} muted style={styles.cardChevron} />
          <Stage index={i} />
          <View style={styles.cardFooter}><Copy value={i === 0 ? 'LAST DRIVE' : 'CONNECTION'} size={9} muted />
            <Copy value={i === 0 ? (lastDrive ?? 'UNVERIFIED') : 'NO DATA'} size={10} font={medium} style={styles.cardFooterValue} /></View>
        </Pressable>)}
      </> : <>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to Garage" onPress={() => setIndex(null)} style={styles.back}>
          <Copy value="‹" size={28} font={medium} />
        </Pressable>
        <View style={styles.vehicleHeader}>
          <Copy value={cars[index].name} size={31} font={semibold} />
          <Copy value={cars[index].model} size={12} muted style={{ marginTop: 3 }} />
          <Pressable accessibilityRole="button" accessibilityLabel="Data connection status" onPress={() => setSheet('connection')} style={{ marginTop: 10 }}>
            <Copy value={statuses[index].toUpperCase()} size={10} font={medium} muted />
          </Pressable>
        </View>
        <Stage index={index} detail />
        <View style={styles.snapshot}>
          <View style={[styles.metricRow, styles.firstRow]}>
            <Metric title="RANGE" value={isRover && snapshot?.rangeKm != null ? snapshot.rangeKm + ' km' : '— km'} large />
            <Metric title="FUEL" value={isRover && snapshot?.fuelPercent != null ? snapshot.fuelPercent + ' %' : '— %'} large />
          </View>
          <View style={styles.metricRow}>
            <Metric title="LAST DRIVE" value={isRover ? (lastDrive ?? '—') : '—'} />
            <Metric title="IDLE" value={isRover && idle !== null ? idle + (idle === 1 ? ' day' : ' days') : '—'} />
          </View>
          <View pointerEvents="none" style={styles.metricDivider} />
        </View>
        <View style={styles.vehicleStatus}>
          <Copy value="VEHICLE STATUS" size={10} font={medium} muted />
          <Copy value={statusTitle} size={25} font={semibold} style={{ marginTop: 13 }} />
          <Copy value={description} size={12} muted style={{ marginTop: 6 }} />
        </View>
        <Action title={isRover ? 'Recent drives' : 'Connection settings'} onPress={() => setSheet(isRover ? 'drives' : 'connection')} />
        <View style={styles.footer}><Copy value={footer} size={10} muted /></View>
      </>}
    </ScrollView>
    <Modal visible={sheet !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSheet(null)}>
      <SafeAreaView style={styles.page}>
        <ScrollView contentContainerStyle={styles.body}>
          <Action title="Done" onPress={() => setSheet(null)} />
          <Copy value={sheet === 'drives' ? 'Recent drives' : sheet === 'add' ? 'Add vehicle' : 'Data connection'} size={28} font={semibold} style={{ marginVertical: 18 }} />
          {sheet === 'drives' ? <>
            {!recentDrives?.length && <Copy value={recentDrives ? 'No recent drives available.' : 'Verified drive history is unavailable.'} muted size={14} />}
            {recentDrives?.map(date => <View style={styles.action} key={date}><Copy value={displayDate(date) + ' JST'} size={15} /></View>)}
          </> : sheet === 'add' ? <Copy value="Adding a vehicle is unavailable in this build." muted size={14} />
          : isRover ? <>
            <Copy value={roverStatus} size={17} font={medium} />
            <Copy value={phase === 'unconfigured' ? 'Vehicle sign-in is not configured for this build.'
              : snapshot?.status === 'reauthorize' ? 'Reconnect the JLR account before updating vehicle data.'
              : phase === 'expired' ? 'Sign in again to restore access.' : footer} muted style={{ marginVertical: 12 }} />
            {phase !== 'unconfigured' && (data.hasSession
              ? <Action title="Refresh data" disabled={phase === 'loading'} onPress={() => void data.refresh()} />
              : data.discoveryFailed
                ? <Action title="Retry sign-in setup" onPress={data.retryDiscovery} />
                : <Action title="Sign in" disabled={!data.canSignIn || phase === 'signingIn'} onPress={() => void data.signIn()} />)}
            <Action title="Enable inactivity alerts" onPress={() => void enableInactivityAlerts().then(async ok => {
              setAlertStatus(ok ? 'Inactivity alerts enabled on this device.' : 'Notifications are disabled in iOS Settings.');
              if (ok && snapshot) await notifyIfDue(snapshot);
            }).catch(() => setAlertStatus('Unable to enable or deliver notifications.'))} />
            {!!alertStatus && <Copy value={alertStatus} muted style={{ marginTop: 10 }} />}
            {data.notificationFailed && <Copy value="Notification delivery could not be scheduled." muted style={{ marginTop: 10 }} />}
          </> : <Copy value={description} muted size={14} />}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  </SafeAreaView>;
}

export default function App() {
  const [loaded, error] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold });
  if (!loaded && !error) return <View style={styles.page} />;
  return <SafeAreaProvider><Garage /></SafeAreaProvider>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: palette.page },
  body: { width: '100%', maxWidth: 450, alignSelf: 'center', paddingHorizontal: 16, paddingBottom: 24 },
  garageHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, paddingHorizontal: 6 },
  garageCount: { marginLeft: 8, marginTop: 7, marginBottom: 32 },
  card: { backgroundColor: palette.white, borderRadius: 18, marginBottom: 14, paddingTop: 18, paddingHorizontal: 14, minHeight: 225 },
  cardChevron: { position: 'absolute', right: 23, top: 14 },
  stage: { position: 'relative', justifyContent: 'center', overflow: 'hidden' },
  artLayer: { position: 'absolute', width: '100%', alignItems: 'center' },
  cardFooter: { borderTopWidth: 1, borderTopColor: palette.line, flexDirection: 'row', alignItems: 'center', minHeight: 27 },
  cardFooterValue: { position: 'absolute', left: '59%' },
  back: { alignSelf: 'flex-start', justifyContent: 'center', minHeight: 44, minWidth: 44, paddingLeft: 7 },
  vehicleHeader: { marginHorizontal: 6, marginTop: 8, marginBottom: 24 },
  snapshot: { backgroundColor: palette.white, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 20, minHeight: 167, marginTop: 9 },
  metricRow: { flexDirection: 'row', minHeight: 53 },
  firstRow: { borderBottomWidth: 1, borderColor: palette.line, minHeight: 75, marginBottom: 12 },
  metric: { flex: 1, paddingRight: 8 },
  metricDivider: { width: 1, backgroundColor: palette.line, position: 'absolute', left: '48.6%', top: 20, bottom: 20 },
  vehicleStatus: { marginTop: 18, minHeight: 121, borderRadius: 18, backgroundColor: palette.white, padding: 14, paddingTop: 20 },
  action: { marginTop: 20, minHeight: 65, borderRadius: 16, backgroundColor: palette.white, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  footer: { borderTopWidth: 1, borderTopColor: palette.line, marginTop: 26, paddingTop: 13, paddingHorizontal: 6 },
});
