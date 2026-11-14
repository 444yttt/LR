import { useCallback, useEffect, useState } from 'react';
import { Alert, AppState, Linking, Platform, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  VEHICLES, connectionState, displayDate, healthView, permissionCopy, relativeTime,
  type AlertPrefs, type PermissionState,
} from '../garageModel.ts';
import { vehicleCredits } from '../credits';
import { loadAlertPrefs, notifyIfDue, permissionState, saveAlertPrefs } from '../notifications';
import { PressScale, Skeleton, Toggle, haptics } from '../ui/motion';
import { ActionRow, Card, Field, Headline, Note, Rule, SectionLabel, SubScreen, useData, useFeed } from '../ui/parts';
import { useNav } from '../ui/stack';
import { ink, medium, mute, page, regular, rule, semibold, typeStyle, useNow, usePx, white, type Px } from '../ui/theme';

const categories = [
  { key: 'good', title: 'No reported issues' },
  { key: 'attention-required', title: 'Attention required' },
  { key: 'service-required', title: 'Service required' },
  { key: null, title: 'Not checked' },
] as const;

export function StatusScreen({ vehicle }: { vehicle: number }) {
  const px = usePx();
  const now = useNow();
  const info = VEHICLES[vehicle];
  const feed = useFeed(vehicle);
  const snapshot = feed?.snapshot ?? null;
  const health = healthView(vehicle, feed, now);
  const loading = feed ? connectionState(feed, now, vehicle).loading : false;
  const reported = health.reported ? snapshot?.health ?? null : null;
  return <SubScreen title="Vehicle status" caption={info.name}>
    <Card px={px} style={{ marginTop: px(24) }}>
      <Headline px={px} eyebrow="Vehicle status" title={health.title} caption={health.caption}
        loading={loading ? <Skeleton width={px(170)} height={px(20)} radius={px(6)} style={{ marginTop: px(5) }} /> : undefined} />
      <Rule px={px} />
      <Text style={typeStyle(px, 12, regular, mute, { margin: px(14), marginTop: px(14), marginBottom: px(18) })}>{health.detail}</Text>
    </Card>
    {feed && <>
      <SectionLabel px={px} value="Categories" />
      <Card px={px} style={{ marginTop: px(10) }}>
        {categories.map((category, i) => {
          const current = category.key === reported && (category.key !== null || !loading);
          return <View key={category.title}>
            {i > 0 && <Rule px={px} />}
            <View accessible accessibilityLabel={category.title + (current ? ', current' : '')}
              style={{ paddingHorizontal: px(14), height: px(52), flexDirection: 'row', alignItems: 'center' }}>
              <Text style={typeStyle(px, 15, current ? semibold : regular, current ? ink : mute, { flex: 1 })}>{category.title}</Text>
              {current && <Text style={typeStyle(px, 10, medium, ink)}>CURRENT</Text>}
            </View>
          </View>;
        })}
      </Card>
      <Card px={px}>
        <Field px={px} label="Health reported" value={health.reported && snapshot?.fetchedAt ? displayDate(snapshot.fetchedAt) + ' JST' : null}
          caption={health.reported ? relativeTime(snapshot?.fetchedAt, now) : 'No current health report'} />
        <Rule px={px} />
        <Field px={px} label="Fault codes and service items" value="Not available" caption="Not read by this build" />
      </Card>
    </>}
    <Note px={px}>{feed
      ? (feed.demo ? 'Demo data: synthetic values for testing, not from the vehicle. ' : '') + 'Health comes only from ' + info.diagnostics + ' on a fresh report. Unknown is never shown as healthy.'
      : 'Live vehicle data unavailable'}</Note>
  </SubScreen>;
}

export function ConnectionScreen({ vehicle }: { vehicle: number }) {
  const px = usePx();
  const now = useNow();
  const data = useData();
  const nav = useNav();
  const info = VEHICLES[vehicle];
  const feed = useFeed(vehicle);
  if (!feed) {
    return <SubScreen title="Connection" caption={info.name}>
      <Card px={px} style={{ marginTop: px(24) }}>
        <Headline px={px} eyebrow="State" title={info.offlineTitle} caption={info.offlineCaption} />
        <Rule px={px} />
        <Text style={typeStyle(px, 12, regular, mute, { margin: px(14), marginBottom: px(18) })}>{info.adapterNote}</Text>
      </Card>
      <Card px={px}>
        <Field px={px} label="Data source" value="None" />
        <Rule px={px} />
        <Field px={px} label="Last successful update" value={null} caption="No vehicle data has been received" />
      </Card>
      <Note px={px}>Live vehicle data unavailable. Nostos does not show estimated or sample values for this vehicle.</Note>
    </SubScreen>;
  }

  const connection = connectionState(feed, now, vehicle);
  const snapshot = feed.snapshot;
  const busy = feed.phase === 'loading' || feed.phase === 'signingIn';
  const primary = connection.action === 'signIn' ? { title: 'Sign in', run: () => void data.signIn(), disabled: !data.canSignIn || busy }
    : connection.action === 'retrySetup' ? { title: 'Retry sign-in setup', run: data.retryDiscovery, disabled: false }
    : connection.action === 'refresh' ? { title: connection.kind === 'updateFailed' ? 'Retry update' : 'Refresh now', run: () => void data.refresh(), disabled: busy }
    : null;
  const signOut = () => {
    const run = () => { haptics.warning(); void data.signOut(); };
    if (Platform.OS === 'web') { run(); return; }
    Alert.alert('Sign out of Nostos?', 'Vehicle data is removed from this iPhone. The ' + info.sourceShort + ' connection on the collector is not changed.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: run },
    ]);
  };

  return <SubScreen title="Connection" caption={info.name + ' · ' + (feed.demo ? 'Demo data' : info.source)}>
    <Card px={px} style={{ marginTop: px(24) }}>
      <Headline px={px} eyebrow="State" title={connection.title} caption={connection.detail} />
    </Card>
    {primary && <ActionRow px={px} title={primary.title} onPress={primary.run} disabled={primary.disabled} chevron={false}
      detail={busy && connection.action !== 'signIn' ? 'Updating…' : undefined} />}
    <Card px={px}>
      <Field px={px} label="Last successful update" value={snapshot?.fetchedAt ? displayDate(snapshot.fetchedAt) + ' JST' : null}
        caption={snapshot?.fetchedAt ? 'Vehicle report collected ' + (relativeTime(snapshot.fetchedAt, now) ?? '') : 'No verified vehicle update available'} />
      <Rule px={px} />
      <Field px={px} label="Last checked on this iPhone" value={relativeTime(feed.lastSyncedAt, now)}
        caption={feed.lastSyncedAt ? null : 'Not checked since the app opened'} />
      <Rule px={px} />
      <Field px={px} label="Access" value="Read-only" caption="Nostos never locks, unlocks, starts, or locates the vehicle." />
    </Card>
    {vehicle === 0 && <>
      <SectionLabel px={px} value="Alerts" />
      <ActionRow px={px} title="Notifications" onPress={() => nav.push({ name: 'notifications' })} />
    </>}
    {feed.hasSession && <ActionRow px={px} title="Sign out" onPress={signOut} chevron={false} disabled={data.phase === 'signingIn'} />}
    {data.notificationFailed && <Text style={typeStyle(px, 12, regular, mute, { marginTop: px(12), marginHorizontal: px(8) })}>Notification delivery could not be scheduled.</Text>}
    <Note px={px}>{feed.demo ? 'Demo data: synthetic values for testing. Nothing here comes from the vehicle. ' : ''}{feed.hasSession ? 'Signing out forgets the Nostos session on this iPhone only. ' : ''}{info.sourceShort} credentials are never stored in the app.</Note>
  </SubScreen>;
}

export function NotificationsScreen() {
  const px = usePx();
  const data = useData();
  const [permission, setPermission] = useState<PermissionState | null>(null);
  const [prefs, setPrefs] = useState<AlertPrefs | null>(null);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setPermission(await permissionState());
    try { setPrefs(await loadAlertPrefs()); } catch { setMessage('Alert settings could not be read on this device.'); }
  }, []);
  useEffect(() => {
    void load();
    const listener = AppState.addEventListener('change', state => { if (state === 'active') void load(); });
    return () => listener.remove();
  }, [load]);

  const update = async (next: AlertPrefs) => {
    const previous = prefs;
    setPrefs(next);
    setMessage('');
    try {
      const ok = await saveAlertPrefs(next);
      setPermission(await permissionState());
      if (!ok) {
        setPrefs(previous);
        setMessage('Notifications are turned off for Nostos in iOS Settings.');
        haptics.warning();
        return;
      }
      if (next.enabled && data.snapshot) await notifyIfDue(data.snapshot);
    } catch {
      setPrefs(previous);
      setMessage('Unable to change alert settings or deliver notifications.');
    }
  };

  const copy = permission ? permissionCopy(permission) : null;
  return <SubScreen title="Notifications" caption="Range Rover inactivity alerts">
    <Card px={px} style={{ marginTop: px(24) }}>
      <Headline px={px} eyebrow="iOS permission" title={copy?.title ?? ''} caption={copy?.detail}
        loading={copy ? undefined : <Skeleton width={px(140)} height={px(20)} radius={px(6)} style={{ marginTop: px(5) }} />} />
    </Card>
    {permission === 'denied' && <ActionRow px={px} title="Open iOS Settings" onPress={() => void Linking.openSettings()} />}
    <SectionLabel px={px} value="Alerts" />
    <Card px={px} style={{ marginTop: px(10) }}>
      <ToggleRow px={px} title="Inactivity alerts" caption="When no confirmed drive is reported" value={prefs?.enabled ?? false}
        disabled={!prefs} onChange={enabled => prefs && void update({ ...prefs, enabled })} />
      <Rule px={px} />
      <ToggleRow px={px} title="After 7 days" caption="First reminder" value={prefs?.after7 ?? true}
        disabled={!prefs?.enabled} onChange={after7 => prefs && void update({ ...prefs, after7 })} />
      <Rule px={px} />
      <ToggleRow px={px} title="After 14 days" caption="Repeat reminder" value={prefs?.after14 ?? true}
        disabled={!prefs?.enabled} onChange={after14 => prefs && void update({ ...prefs, after14 })} />
    </Card>
    {!!message && <Text accessibilityLiveRegion="polite" style={typeStyle(px, 12, regular, mute, { marginTop: px(12), marginHorizontal: px(8) })}>{message}</Text>}
    {data.notificationFailed && <Text style={typeStyle(px, 12, regular, mute, { marginTop: px(12), marginHorizontal: px(8) })}>The last alert could not be scheduled.</Text>}
    <Note px={px}>Alerts are local. They are checked when Nostos updates while open, only for a verified last drive on a fresh report, once per drive and threshold. Tapping an alert opens the Range Rover (garage-monitor://vehicle/range-rover).</Note>
  </SubScreen>;
}

function ToggleRow({ px, title, caption, value, disabled, onChange }: { px: Px; title: string; caption: string; value: boolean; disabled?: boolean; onChange: (next: boolean) => void }) {
  return <View style={{ paddingHorizontal: px(14), height: px(68), flexDirection: 'row', alignItems: 'center' }}>
    <View style={{ flex: 1, opacity: disabled ? 0.55 : 1 }}>
      <Text style={typeStyle(px, 15, medium, ink)}>{title}</Text>
      <Text style={typeStyle(px, 12, regular, mute, { marginTop: px(3) })}>{caption}</Text>
    </View>
    <Toggle px={px} label={title} value={value} disabled={disabled} onChange={onChange} />
  </View>;
}

const adapters = [
  { title: 'Land Rover', state: 'Connected · Range Rover', note: 'JLR Data Hub, read-only' },
  { title: 'Ferrari', state: 'Not available', note: 'No data source in this build' },
  { title: 'BMW', state: 'Setup required', note: 'CarData access not set up' },
  { title: 'OBD / LTE device', state: 'Not available', note: 'Planned owner-installed adapter' },
];

/** + on the Garage. Honest list of sources; adding vehicles is not possible in this build. */
export function AddVehicleSheet({ onClose }: { onClose: () => void }) {
  const px = usePx();
  const insets = useSafeAreaInsets();
  return <View style={{ backgroundColor: page, borderTopLeftRadius: px(19), borderTopRightRadius: px(19), paddingHorizontal: px(16), paddingBottom: Math.max(insets.bottom, px(16)) + px(8) }}>
    <View style={{ alignSelf: 'center', width: px(36), height: px(5), borderRadius: px(3), backgroundColor: rule, marginTop: px(8) }} />
    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: px(18) }}>
      <Text accessibilityRole="header" style={typeStyle(px, 28, semibold, ink, { flex: 1, marginLeft: px(6) })}>Add vehicle</Text>
      <PressScale accessibilityRole="button" accessibilityLabel="Done" hitSlop={10} onPress={onClose} style={{ paddingHorizontal: px(8), paddingVertical: px(6) }}>
        <Text style={typeStyle(px, 15, medium, ink)}>Done</Text>
      </PressScale>
    </View>
    <Text style={typeStyle(px, 12, regular, mute, { marginTop: px(6), marginLeft: px(7) })}>Adding vehicles is unavailable in this build.</Text>
    <Card px={px} style={{ marginTop: px(18) }}>
      {adapters.map((adapter, i) => <View key={adapter.title}>
        {i > 0 && <Rule px={px} />}
        <View accessible style={{ paddingHorizontal: px(14), paddingVertical: px(14), flexDirection: 'row', alignItems: 'center', backgroundColor: white }}>
          <View style={{ flex: 1 }}>
            <Text style={typeStyle(px, 15, medium, ink)}>{adapter.title}</Text>
            <Text style={typeStyle(px, 12, regular, mute, { marginTop: px(3) })}>{adapter.note}</Text>
          </View>
          <Text style={typeStyle(px, 10, medium, mute)}>{adapter.state.toUpperCase()}</Text>
        </View>
      </View>)}
    </Card>
    <SectionLabel px={px} value="Image credits" />
    <Card px={px} style={{ marginTop: px(10) }}>
      {vehicleCredits.map((credit, i) => <View key={credit.file}>
        {i > 0 && <Rule px={px} />}
        <PressScale accessibilityRole="link" accessibilityLabel={credit.vehicle + ' photo by ' + credit.author + ', ' + credit.license}
          accessibilityHint="Opens the source page" onPress={() => void Linking.openURL(credit.source)}
          style={{ paddingHorizontal: px(14), paddingVertical: px(11), backgroundColor: white }}>
          <Text style={typeStyle(px, 12, medium, ink)}>{credit.vehicle}</Text>
          <Text style={typeStyle(px, 11, regular, mute, { marginTop: px(2) })}>{'Photo: ' + credit.author + ' · ' + credit.license + ' · Wikimedia Commons'}</Text>
          <Text style={typeStyle(px, 11, regular, mute, { marginTop: px(1) })}>{credit.changes}</Text>
        </PressScale>
      </View>)}
    </Card>
  </View>;
}
