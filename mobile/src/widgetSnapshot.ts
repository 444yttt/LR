// The iOS home-screen widget's only data: a minimal snapshot the app writes to App Group shared UserDefaults.
// Pure (no React Native imports) so it runs under `node --test`. The bridge that writes it is src/widget.tsx; the
// reader is mobile/targets/widget/Snapshot.swift. Keep the field names and WIDGET_SCHEMA_VERSION in step with it.
//
// Privacy: the widget never makes network requests and never reads tokens, the keychain, or SecureStore. This payload
// is the whole contract. It carries display names (from VEHICLES, never the owner's specs or a VIN), one level
// percent, range, the last report time, and status flags. Nothing else from a Snapshot is copied: no VIN, location,
// trips or last-drive times, odometer, model year, health, tokens, issuer, or raw gateway payloads.
import { isFresh, type Snapshot } from './telemetry.ts';
import { VEHICLES, type Phase, type VehicleId } from './garageModel.ts';
import type { VehicleSnapshots } from './gatewayVehicles.ts';

/** App Group shared by the app (app.json ios.entitlements) and the widget (targets/widget/expo-target.config.js). */
export const WIDGET_APP_GROUP = 'group.studio.naus.garagemonitor';
/** UserDefaults key holding the JSON-encoded WidgetSnapshot (a string). Absent = signed out / nothing to show. */
export const WIDGET_SNAPSHOT_KEY = 'nostos.widget.snapshot';
export const WIDGET_SCHEMA_VERSION = 1;
/** AsyncStorage key for the vehicle the user last opened in the app; the widget's default vehicle. Not secret. */
export const WIDGET_SELECTION_KEY = 'nostos.widget.selectedVehicle';

/** `live`: a report is shown. `empty`: connected, but no report yet. `notConnected`: no data source (Ferrari 296). */
export type WidgetVehicleKind = 'live' | 'empty' | 'notConnected';

export type WidgetVehicle = {
  /** App vehicle id (VEHICLES), used for the deep link garage-monitor://vehicle/<id>. */
  id: VehicleId;
  /** VEHICLES display name, e.g. "Audi S e-tron GT". */
  name: string;
  kind: WidgetVehicleKind;
  /** Same rule as garageModel.metrics(): Battery for a report with a charge level and no fuel level, else Fuel. */
  levelLabel: 'Fuel' | 'Battery';
  /** Whole percent, or null when not reported. */
  levelPercent: number | null;
  /** Whole km (`rangeKm ?? electricRangeKm`), or null when not reported. */
  rangeKm: number | null;
  /** Report time (snapshot.fetchedAt) in ms since the epoch, or null. */
  updatedAt: number | null;
  /** The report is not fresh (older than 36 h, or the collector flagged it stale / error / reauthorize). */
  stale: boolean;
  /** The Nostos sign-in expired; no levels are carried. */
  authExpired: boolean;
};

export type WidgetSnapshot = {
  v: typeof WIDGET_SCHEMA_VERSION;
  /** Device clock when the app wrote this snapshot (ms). */
  writtenAt: number;
  session: 'active' | 'expired';
  /** The widget's default vehicle (see defaultWidgetVehicle). A widget configured for a vehicle overrides it. */
  selectedVehicleId: VehicleId;
  /** Every vehicle in Garage order, so a configured widget can switch without a new app write. */
  vehicles: WidgetVehicle[];
};

export type WidgetAction =
  | { type: 'write'; snapshot: WidgetSnapshot }
  /** Signed out or not configured: remove the shared snapshot so no level remains on the Home Screen. */
  | { type: 'clear' }
  /** Nothing new (launch restore before data arrives, a sign-in in progress): leave the widget as it is. */
  | { type: 'keep' };

export type WidgetInput = {
  phase: Phase;
  snapshots: VehicleSnapshots | null | undefined;
  /** The vehicle last opened in the app, if one is stored. */
  selectedVehicleId: string | null | undefined;
  now: number;
};

const vehicleIds = new Set<string>(VEHICLES.map(vehicle => vehicle.id));
export const isVehicleId = (value: unknown): value is VehicleId => typeof value === 'string' && vehicleIds.has(value);

const whole = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;

function widgetVehicle(id: VehicleId, snapshot: Snapshot | null, authExpired: boolean, now: number): WidgetVehicle {
  const info = VEHICLES.find(vehicle => vehicle.id === id)!;
  const base = { id, name: info.name, levelPercent: null, rangeKm: null, updatedAt: null, stale: false, authExpired };
  if (!info.connected) return { ...base, kind: 'notConnected', levelLabel: 'Fuel' };
  // A pending row has no report yet; an expired session carries no levels.
  if (!snapshot || authExpired || snapshot.status === 'pending') return { ...base, kind: 'empty', levelLabel: 'Fuel' };
  const battery = snapshot.fuelPercent === null && snapshot.socPercent !== null;
  const updatedAt = snapshot.fetchedAt ? Date.parse(snapshot.fetchedAt) : NaN;
  return {
    ...base,
    kind: 'live',
    levelLabel: battery ? 'Battery' : 'Fuel',
    levelPercent: whole(battery ? snapshot.socPercent : snapshot.fuelPercent),
    rangeKm: whole(snapshot.rangeKm ?? snapshot.electricRangeKm),
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : null,
    stale: !isFresh(snapshot, now),
  };
}

/** Stored choice if valid; otherwise the first connected vehicle with a report; otherwise the first vehicle. */
export function defaultWidgetVehicle(selected: string | null | undefined, snapshots: VehicleSnapshots | null | undefined): VehicleId {
  if (isVehicleId(selected)) return selected;
  const reported = VEHICLES.find(vehicle => vehicle.connected && snapshots?.[vehicle.id]);
  return (reported ?? VEHICLES[0]).id;
}

export function buildWidgetSnapshot(input: WidgetInput): WidgetSnapshot {
  const authExpired = input.phase === 'expired';
  const snapshots = authExpired ? null : input.snapshots;
  return {
    v: WIDGET_SCHEMA_VERSION,
    writtenAt: input.now,
    session: authExpired ? 'expired' : 'active',
    selectedVehicleId: defaultWidgetVehicle(input.selectedVehicleId, snapshots),
    vehicles: VEHICLES.map(vehicle => widgetVehicle(vehicle.id, snapshots?.[vehicle.id] ?? null, authExpired, input.now)),
  };
}

const hasReports = (snapshots: VehicleSnapshots | null | undefined) => Boolean(snapshots && Object.values(snapshots).some(Boolean));

/**
 * What the app should do with the shared snapshot for the current session state.
 * - ready (successful GET /v1/vehicles): write.
 * - failed / loading with earlier values still in place: write them (they keep their report time and stale flag).
 * - expired (sign-in died): write the indicator-only state, no levels.
 * - signedOut / unconfigured: clear.
 * - loading or failed with nothing loaded (launch restore, first sign-in), signingIn: keep what the widget has.
 */
export function widgetAction(input: WidgetInput): WidgetAction {
  switch (input.phase) {
    case 'signedOut':
    case 'unconfigured':
      return { type: 'clear' };
    case 'expired':
    case 'ready':
      return { type: 'write', snapshot: buildWidgetSnapshot(input) };
    case 'loading':
    case 'failed':
      return hasReports(input.snapshots) ? { type: 'write', snapshot: buildWidgetSnapshot(input) } : { type: 'keep' };
    case 'signingIn':
      return { type: 'keep' };
  }
}

export const serializeWidgetSnapshot = (snapshot: WidgetSnapshot) => JSON.stringify(snapshot);

/** Serialized content without the write time, to skip rewrites (and widget reloads) that would change nothing. */
export const widgetContentKey = (action: WidgetAction) =>
  action.type === 'write' ? JSON.stringify({ ...action.snapshot, writtenAt: 0 }) : action.type;

/** The subset of @bacons/apple-targets ExtensionStorage the writer uses (mocked in tests). */
export type WidgetStorage = {
  set(key: string, value: string): void;
  remove(key: string): void;
  reloadWidget(): void;
};

/** Applies an action to the shared storage and asks WidgetKit to reload. Returns whether anything was written. */
export function applyWidgetAction(storage: WidgetStorage, action: WidgetAction): boolean {
  if (action.type === 'keep') return false;
  if (action.type === 'clear') storage.remove(WIDGET_SNAPSHOT_KEY);
  else storage.set(WIDGET_SNAPSHOT_KEY, serializeWidgetSnapshot(action.snapshot));
  storage.reloadWidget();
  return true;
}
