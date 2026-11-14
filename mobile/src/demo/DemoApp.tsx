// DEMO / PREVIEW ENTRY POINT. Loaded only when EXPO_PUBLIC_DEMO_DATA=1 (see App.tsx).
// Shows all three vehicles with synthetic fixtures; a pill at the bottom of the screen marks the mode and cycles states.
import { useMemo, useState } from 'react';
import { Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GarageApp } from '../GarageApp';
import type { Data } from '../ui/parts';
import { PressScale } from '../ui/motion';
import { ink, medium, typeStyle, usePx, white } from '../ui/theme';
import { DEMO_SCENARIOS, demoFeeds, demoScenarioLabel, type DemoScenario } from './fixtures';

const noop = async () => undefined;

/** Range Rover feed doubles as the top-level Data so screens that read it (Notifications) stay consistent. */
export function demoData(scenario: DemoScenario, now: number): Data {
  const feeds = demoFeeds(scenario, now);
  const rover = feeds[0];
  return {
    phase: rover.phase, snapshot: rover.snapshot, hasSession: rover.hasSession, discoveryFailed: false, lastSyncedAt: rover.lastSyncedAt,
    notificationFailed: false, canSignIn: false,
    refresh: noop, signIn: noop, signOut: noop, retryDiscovery: () => undefined,
    demo: feeds,
  };
}

export function DemoApp({ initial = 'live', children, badge = true }: { initial?: DemoScenario; children?: React.ReactNode; badge?: boolean }) {
  const [scenario, setScenario] = useState<DemoScenario>(initial);
  const data = useMemo(() => demoData(scenario, Date.now()), [scenario]);
  const next = () => setScenario(DEMO_SCENARIOS[(DEMO_SCENARIOS.indexOf(scenario) + 1) % DEMO_SCENARIOS.length]);
  return <GarageApp data={data}>
    {children}
    {badge && <Badge label={'DEMO DATA · ' + demoScenarioLabel[scenario].toUpperCase()} onPress={next} />}
  </GarageApp>;
}

function Badge({ label, onPress }: { label: string; onPress: () => void }) {
  const px = usePx();
  const insets = useSafeAreaInsets();
  return <PressScale accessibilityRole="button" accessibilityLabel={label} accessibilityHint="Switches to the next demo state" onPress={onPress}
    style={{ position: 'absolute', alignSelf: 'center', bottom: Math.max(insets.bottom, px(12)) + px(4), paddingHorizontal: px(12), paddingVertical: px(7),
      borderRadius: px(14), backgroundColor: ink }}>
    <Text style={typeStyle(px, 10, medium, white)}>{label}</Text>
  </PressScale>;
}
