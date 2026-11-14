// DEMO / TEST FIXTURES — synthetic values only. Not real vehicle, trip, account, VIN, or location data.
// Used by tests and by the explicit demo/preview entry point (EXPO_PUBLIC_DEMO_DATA=1 exactly, see App.tsx). Production
// builds never import the demo entry point, so Ferrari 296 and BMW X7 stay "not connected" with no values there.
import { parseSnapshot, type Snapshot } from '../telemetry.ts';
import { VEHICLES, type Feed } from '../garageModel.ts';

export const DEMO_MARKER = 'nostos-demo-fixture';

/** Every state a vehicle screen can be in, so all three cars can be checked screen by screen. */
export const DEMO_SCENARIOS = ['live', 'loading', 'notFetched', 'updateFailed', 'authExpired', 'empty'] as const;
export type DemoScenario = typeof DEMO_SCENARIOS[number];

export const demoScenarioLabel: Record<DemoScenario, string> = {
  live: 'Live', loading: 'Loading', notFetched: 'Not fetched', updateFailed: 'Update failed', authExpired: 'Auth expired', empty: 'Empty',
};

type Profile = { rangeKm: number; fuelPercent: number; health: Snapshot['health']; drives: { hoursAgo: number; minutes: number; km: number; lPer100: number }[] };

/** Per-car synthetic values (index = VEHICLES index). Rounded, plausible, and obviously not telemetry. */
const profiles: Profile[] = [
  { rangeKm: 612, fuelPercent: 74, health: 'good', drives: [
    { hoursAgo: 26, minutes: 47, km: 31.6, lPer100: 10.4 }, { hoursAgo: 29, minutes: 22, km: 12.0, lPer100: 11.2 },
    { hoursAgo: 50, minutes: 35, km: 24.5, lPer100: 9.8 }, { hoursAgo: 74, minutes: 64, km: 58.0, lPer100: 9.1 },
  ] },
  { rangeKm: 388, fuelPercent: 58, health: 'good', drives: [
    { hoursAgo: 52, minutes: 41, km: 46.0, lPer100: 12.9 }, { hoursAgo: 148, minutes: 73, km: 88.5, lPer100: 11.6 },
  ] },
  { rangeKm: 655, fuelPercent: 81, health: 'attention-required', drives: [
    { hoursAgo: 5, minutes: 18, km: 9.5, lPer100: 11.9 }, { hoursAgo: 30, minutes: 55, km: 40.2, lPer100: 10.7 },
    { hoursAgo: 98, minutes: 26, km: 15.3, lPer100: 12.4 },
  ] },
];

const iso = (now: number, minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();

function snapshotFor(vehicle: number, now: number, kind: 'fresh' | 'stale' | 'empty'): Snapshot {
  const p = profiles[vehicle];
  if (kind === 'empty') {
    // Signed in and a fresh report arrived, but it carries no range, fuel, or health values and no recent drives
    // (the last verified drive is 45 days old and outside the reported history).
    return parseSnapshot({ status: 'fresh', fetchedAt: iso(now, 6), lastDriveVerified: true, lastDriveAt: iso(now, 45 * 24 * 60), trips: [] });
  }
  const drives = p.drives.map(d => ({
    endedAt: iso(now, d.hoursAgo * 60), startedAt: iso(now, d.hoursAgo * 60 + d.minutes), distanceKm: d.km, efficiencyLPer100Km: d.lPer100,
  }));
  return parseSnapshot({
    status: kind === 'stale' ? 'stale' : 'fresh',
    fetchedAt: iso(now, kind === 'stale' ? 40 * 60 : 4 + vehicle * 3),
    lastDriveVerified: true, lastDriveAt: drives[0].endedAt,
    rangeKm: p.rangeKm, fuelPercent: p.fuelPercent, health: p.health, trips: drives,
  });
}

/** Synthetic feed for one vehicle in one scenario. Always flagged `demo: true`. */
export function demoFeed(vehicle: number, scenario: DemoScenario, now: number): Feed {
  const base = { demo: true, discoveryFailed: false };
  switch (scenario) {
    case 'live': return { ...base, phase: 'ready', snapshot: snapshotFor(vehicle, now, 'fresh'), hasSession: true, lastSyncedAt: now - 60_000 };
    case 'loading': return { ...base, phase: 'loading', snapshot: null, hasSession: true, lastSyncedAt: null };
    case 'notFetched': return { ...base, phase: 'ready', snapshot: null, hasSession: true, lastSyncedAt: null };
    case 'updateFailed': return { ...base, phase: 'failed', snapshot: snapshotFor(vehicle, now, 'stale'), hasSession: true, lastSyncedAt: now - 3 * 3600_000 };
    case 'authExpired': return { ...base, phase: 'expired', snapshot: null, hasSession: false, lastSyncedAt: null };
    case 'empty': return { ...base, phase: 'ready', snapshot: snapshotFor(vehicle, now, 'empty'), hasSession: true, lastSyncedAt: now - 60_000 };
  }
}

/** Feeds for all three vehicles in one scenario. */
export function demoFeeds(scenario: DemoScenario, now: number): Feed[] {
  return VEHICLES.map((_, i) => demoFeed(i, scenario, now));
}

export function parseScenario(value: string | null | undefined): DemoScenario {
  return (DEMO_SCENARIOS as readonly string[]).includes(value ?? '') ? value as DemoScenario : 'live';
}
