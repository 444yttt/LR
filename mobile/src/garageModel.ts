// Pure presentation state for the Garage. No React Native imports so the logic runs under `node --test`.
import { DAY_MS, idleDays, isFresh, type Drive, type Snapshot } from './telemetry.ts';

export type Phase = 'unconfigured' | 'signedOut' | 'signingIn' | 'loading' | 'ready' | 'failed' | 'expired';

export type GarageInput = {
  phase: Phase;
  snapshot: Snapshot | null;
  hasSession: boolean;
  discoveryFailed: boolean;
  /** Device clock time of the last successful gateway response. */
  lastSyncedAt: number | null;
};

export type VehicleId = 'range-rover' | 'ferrari-296' | 'bmw-m4';

export type VehicleInfo = {
  id: VehicleId;
  name: string;
  model: string;
  connected: boolean;
  /** Card / detail status line when no live adapter exists. */
  offlineStatus: string;
  offlineTitle: string;
  offlineCaption: string;
  /** Honest description of where the adapter stands. */
  adapterNote: string;
};

export const VEHICLES: readonly VehicleInfo[] = [
  {
    id: 'range-rover', name: 'Range Rover', model: 'L460', connected: true,
    offlineStatus: 'Sync unverified', offlineTitle: 'Not checked', offlineCaption: 'Health data not yet verified',
    adapterNote: 'Read-only through JLR Data Hub owner authorization and the Nostos gateway.',
  },
  {
    id: 'ferrari-296', name: 'Ferrari 296', model: 'Ferrari', connected: false,
    offlineStatus: 'Not connected', offlineTitle: 'Not connected', offlineCaption: 'Vehicle data source not connected',
    adapterNote: 'No Ferrari data source is available in this build. MyFerrari connectivity and an optional owner-installed OBD device are still being investigated.',
  },
  {
    id: 'bmw-m4', name: 'BMW M4', model: 'BMW', connected: false,
    offlineStatus: 'Setup required', offlineTitle: 'Setup required', offlineCaption: 'Vehicle data setup is incomplete',
    adapterNote: 'BMW CarData access has not been set up. Market entitlement and data scopes must be confirmed before this vehicle can connect.',
  },
];

export type ConnectionKind =
  | 'unconfigured' | 'setupUnavailable' | 'signedOut' | 'signingIn' | 'signInFailed'
  | 'authExpired' | 'connecting' | 'refreshing' | 'notFetched' | 'updateFailed'
  | 'jlrReauthorize' | 'sourceError' | 'pending' | 'stale' | 'fresh';

export type ConnectionAction = 'signIn' | 'retrySetup' | 'refresh' | null;

export type Connection = {
  kind: ConnectionKind;
  /** Short line used on the card and under the detail title (rendered uppercase). */
  status: string;
  /** Connection screen headline. */
  title: string;
  detail: string;
  action: ConnectionAction;
  /** True while the app is waiting for its first data and should show skeletons. */
  loading: boolean;
};

const minute = 60_000;

/** "just now", "4 min ago", "3 h ago", "yesterday", "5 days ago"; null for unknown or far-future times. */
export function relativeTime(then: number | string | null | undefined, now: number): string | null {
  const time = typeof then === 'string' ? Date.parse(then) : then ?? NaN;
  if (!Number.isFinite(time)) return null;
  const age = now - time;
  if (age < -5 * minute) return null;
  if (age < 45_000) return 'just now';
  if (age < 60 * minute) return Math.max(1, Math.round(age / minute)) + ' min ago';
  if (age < DAY_MS) return Math.floor(age / (60 * minute)) + ' h ago';
  const days = Math.floor(age / DAY_MS);
  return days === 1 ? 'yesterday' : days + ' days ago';
}

export function connectionState(input: GarageInput, now: number): Connection {
  const { phase, snapshot, hasSession, discoveryFailed } = input;
  const synced = relativeTime(input.lastSyncedAt, now);
  const make = (kind: ConnectionKind, status: string, title: string, detail: string, action: ConnectionAction = null): Connection =>
    ({ kind, status, title, detail, action, loading: false });

  if (phase === 'unconfigured') {
    return make('unconfigured', 'Sync unverified', 'Not configured',
      'Vehicle sign-in is not configured for this build. No vehicle data is requested.');
  }
  if (phase === 'expired') {
    return make('authExpired', 'Sign-in expired', 'Sign-in expired',
      'Your Nostos sign-in is no longer valid. Sign in again to restore access. Previous vehicle values were cleared.', 'signIn');
  }
  if (phase === 'signingIn') return make('signingIn', 'Signing in', 'Signing in', 'Finish signing in in the browser window.');
  if (!hasSession && discoveryFailed && phase !== 'loading') {
    return make('setupUnavailable', 'Sign-in unavailable', 'Sign-in unavailable',
      'The sign-in service could not be reached. Check the connection and try again.', 'retrySetup');
  }
  if (phase === 'failed' && !hasSession) {
    return make('signInFailed', 'Sign-in failed', 'Sign-in failed', 'Sign-in did not complete. No vehicle data was requested.', 'signIn');
  }
  if (phase === 'signedOut') {
    return make('signedOut', 'Sign-in required', 'Not signed in', 'Sign in to read the Range Rover status through the Nostos gateway.', 'signIn');
  }
  if (phase === 'loading') {
    if (!snapshot) return { ...make('connecting', 'Updating', 'Updating', 'Requesting the latest vehicle report.'), loading: true };
    return make('refreshing', 'Updating', 'Updating', 'Requesting the latest vehicle report. Previous values stay visible until it arrives.');
  }
  if (phase === 'failed') {
    return make('updateFailed', 'Update failed', 'Update failed',
      snapshot
        ? 'The latest update could not be retrieved' + (synced ? '. Values shown are from the last successful update, ' + synced + '.' : '.')
        : 'The vehicle report could not be retrieved. No vehicle values are available yet.',
      'refresh');
  }
  if (!snapshot) {
    return make('notFetched', 'Not updated yet', 'Not updated yet', 'Signed in. No vehicle report has been retrieved on this device yet.', 'refresh');
  }
  if (snapshot.status === 'reauthorize') {
    return make('jlrReauthorize', 'JLR authorization expired', 'JLR authorization expired',
      'The JLR account authorization used by the collector has expired. Reconnect the JLR account on the collector before vehicle data can update.', 'refresh');
  }
  if (snapshot.status === 'error') {
    return make('sourceError', 'JLR update failed', 'JLR update failed',
      'The collector could not read the vehicle from JLR on its latest run. Values are from the last good report.', 'refresh');
  }
  if (snapshot.status === 'pending') {
    return make('pending', 'Waiting for vehicle data', 'Waiting for vehicle data', 'Signed in. The collector has not stored a vehicle report yet.', 'refresh');
  }
  if (isFresh(snapshot, now)) {
    const ago = relativeTime(snapshot.fetchedAt, now);
    return make('fresh', ago ? 'Updated ' + ago : 'Last update available', 'Connected',
      'Vehicle data is current. Nostos reads JLR data only and never sends commands.', 'refresh');
  }
  return make('stale', 'Last update is stale', 'Last update is stale',
    'The latest vehicle report is older than 36 hours. Values may not reflect the vehicle now.', 'refresh');
}

const jst = 'Asia/Tokyo';
const timeFormat = new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: jst });
const dateTimeFormat = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: jst });
const dayFormat = new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric', timeZone: jst });
const longDayFormat = new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: jst });
const dayKeyFormat = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: jst });

export const displayDate = (date: string) => dateTimeFormat.format(new Date(date));
export const displayTime = (date: string) => timeFormat.format(new Date(date));
export const displayLongDay = (date: string) => longDayFormat.format(new Date(date));

function dayKey(time: number): string {
  return dayKeyFormat.format(new Date(time));
}

export function lastUpdateLine(snapshot: Snapshot | null, now: number): string {
  if (!snapshot?.fetchedAt) return 'No verified vehicle update available';
  const ago = relativeTime(snapshot.fetchedAt, now);
  return 'Last successful update · ' + displayDate(snapshot.fetchedAt) + ' JST' + (ago ? ' · ' + ago : '');
}

export type DriveSection = { key: string; title: string; drives: Drive[] };

/** Groups newest-first drives into JST calendar days labelled Today / Yesterday / weekday. */
export function driveSections(drives: Drive[], now: number): DriveSection[] {
  const today = dayKey(now);
  const yesterday = dayKey(now - DAY_MS);
  const sections: DriveSection[] = [];
  for (const drive of drives) {
    const key = dayKey(Date.parse(drive.endedAt));
    let section = sections[sections.length - 1];
    if (!section || section.key !== key) {
      section = { key, title: key === today ? 'Today' : key === yesterday ? 'Yesterday' : dayFormat.format(new Date(drive.endedAt)), drives: [] };
      sections.push(section);
    }
    section.drives.push(drive);
  }
  return sections;
}

export type DrivesView =
  | { kind: 'signedOut' | 'loading' | 'unverified' | 'empty'; message: string }
  | { kind: 'list'; sections: DriveSection[] };

export function drivesView(input: GarageInput, now: number): DrivesView {
  const { snapshot } = input;
  const connection = connectionState(input, now);
  if (connection.loading) return { kind: 'loading', message: 'Loading drives' };
  if (!snapshot) {
    return { kind: 'signedOut', message: connection.kind === 'unconfigured'
      ? 'Drive history needs a configured vehicle connection.'
      : 'Drive history appears after a successful vehicle update.' };
  }
  if (!snapshot.lastDriveVerified || !snapshot.trips) {
    return { kind: 'unverified', message: 'Drive times are shown only after the source confirms the last drive. None are verified yet.' };
  }
  if (!snapshot.trips.length) return { kind: 'empty', message: 'No recent drives reported.' };
  return { kind: 'list', sections: driveSections(snapshot.trips, now) };
}

export function formatDuration(drive: Drive): string | null {
  if (!drive.startedAt) return null;
  const minutes = Math.round((Date.parse(drive.endedAt) - Date.parse(drive.startedAt)) / minute);
  if (!(minutes >= 0)) return null;
  if (minutes < 60) return minutes + ' min';
  return Math.floor(minutes / 60) + ' h ' + String(minutes % 60).padStart(2, '0') + ' min';
}

export const formatDistance = (drive: Drive) => drive.distanceKm === null ? null : drive.distanceKm.toFixed(drive.distanceKm < 100 ? 1 : 0) + ' km';
export const formatEfficiency = (drive: Drive) => drive.efficiencyLPer100Km === null ? null : drive.efficiencyLPer100Km.toFixed(1) + ' L/100 km';

export type HealthView = { title: string; caption: string; detail: string; reported: boolean };

export function healthView(vehicle: number, snapshot: Snapshot | null, now: number): HealthView {
  const info = VEHICLES[vehicle];
  if (!info.connected) return { title: info.offlineTitle, caption: info.offlineCaption, detail: info.adapterNote, reported: false };
  const fresh = snapshot !== null && isFresh(snapshot, now);
  const health = fresh ? snapshot.health : null;
  if (health === 'good') {
    return { title: 'No reported issues', caption: 'Reported by JLR diagnostics', reported: true,
      detail: 'The latest JLR diagnostics report has no attention or service items. This does not replace an inspection.' };
  }
  if (health === 'attention-required') {
    return { title: 'Attention required', caption: 'Reported by JLR diagnostics', reported: true,
      detail: 'JLR diagnostics report an item that needs attention. Check the vehicle display or the Land Rover Remote app for details.' };
  }
  if (health === 'service-required') {
    return { title: 'Service required', caption: 'Reported by JLR diagnostics', reported: true,
      detail: 'JLR diagnostics report that service is required. Contact a Land Rover retailer.' };
  }
  return { title: 'Not checked', caption: 'Health data not yet verified', reported: false,
    detail: snapshot && !fresh && snapshot.health
      ? 'The last health report is too old to rely on. A fresh vehicle update is needed.'
      : 'No health category has been reported for this vehicle. Unknown is not treated as healthy.' };
}

export type Metrics = { rangeKm: number | null; fuelPercent: number | null; lastDrive: string | null; idleDays: number | null };

export function metrics(vehicle: number, snapshot: Snapshot | null, now: number): Metrics {
  if (vehicle !== 0 || !snapshot) return { rangeKm: null, fuelPercent: null, lastDrive: null, idleDays: null };
  return {
    rangeKm: snapshot.rangeKm,
    fuelPercent: snapshot.fuelPercent,
    lastDrive: snapshot.lastDriveVerified && snapshot.lastDriveAt ? displayDate(snapshot.lastDriveAt) : null,
    idleDays: idleDays(snapshot, now),
  };
}

export type Route =
  | { name: 'garage' }
  | { name: 'vehicle'; vehicle: number }
  | { name: 'drives' }
  | { name: 'drive'; endedAt: string }
  | { name: 'status'; vehicle: number }
  | { name: 'connection'; vehicle: number }
  | { name: 'notifications' };

/** Screens to push above the Garage for a deep link, e.g. drives → [Range Rover, Recent drives]. */
export function stackFor(route: Route): Route[] {
  switch (route.name) {
    case 'garage': return [];
    case 'vehicle': return [route];
    case 'drives': return [{ name: 'vehicle', vehicle: 0 }, route];
    case 'drive': return [{ name: 'vehicle', vehicle: 0 }, { name: 'drives' }, route];
    case 'status':
    case 'connection': return [{ name: 'vehicle', vehicle: route.vehicle }, route];
    case 'notifications': return [{ name: 'vehicle', vehicle: 0 }, { name: 'connection', vehicle: 0 }, route];
  }
}

export const scheme = 'garage-monitor';

/**
 * garage-monitor:// deep links. `garage-monitor://auth` is the OAuth redirect and is never a screen.
 * Supported: /, /vehicle/<id>, /vehicle/<id>/status, /vehicle/<id>/connection, /drives, /notifications.
 */
export function routeFromUrl(url: string | null | undefined): Route | null {
  if (!url) return null;
  const match = /^garage-monitor:(?:\/\/)?([^?#]*)/i.exec(url.trim());
  if (!match) return null;
  const parts = match[1].split('/').filter(Boolean).map(part => part.toLowerCase());
  if (!parts.length) return { name: 'garage' };
  if (parts[0] === 'auth') return null;
  if (parts[0] === 'drives' && parts.length === 1) return { name: 'drives' };
  if (parts[0] === 'notifications' && parts.length === 1) return { name: 'notifications' };
  if (parts[0] === 'vehicle' && parts.length >= 2 && parts.length <= 3) {
    const vehicle = VEHICLES.findIndex(item => item.id === parts[1]);
    if (vehicle < 0) return null;
    if (parts.length === 2) return { name: 'vehicle', vehicle };
    if (parts[2] === 'status') return { name: 'status', vehicle };
    if (parts[2] === 'connection') return { name: 'connection', vehicle };
  }
  return null;
}

export const inactivityLink = scheme + '://vehicle/range-rover';

export type AlertPrefs = { enabled: boolean; after7: boolean; after14: boolean };
export const defaultAlertPrefs: AlertPrefs = { enabled: false, after7: true, after14: true };

/** Which inactivity alert, if any, to deliver for a due threshold under the user's toggles. */
export function alertThreshold(due: 7 | 14 | null, prefs: AlertPrefs): 7 | 14 | null {
  if (!due || !prefs.enabled) return null;
  if (due === 14 && prefs.after14) return 14;
  return prefs.after7 ? 7 : null;
}

export function parseAlertPrefs(enabled: string | null, thresholds: string | null): AlertPrefs {
  const set = thresholds === null ? null : new Set(thresholds.split(','));
  return { enabled: enabled === 'yes', after7: set ? set.has('7') : true, after14: set ? set.has('14') : true };
}

export const serializeThresholds = (prefs: AlertPrefs) => [prefs.after7 ? '7' : '', prefs.after14 ? '14' : ''].filter(Boolean).join(',');

export type PermissionState = 'granted' | 'denied' | 'undetermined' | 'unknown';

export function permissionCopy(state: PermissionState): { title: string; detail: string } {
  switch (state) {
    case 'granted': return { title: 'Allowed', detail: 'iOS allows Nostos to show notifications on this iPhone.' };
    case 'denied': return { title: 'Turned off in iOS Settings', detail: 'Allow notifications for Nostos in iOS Settings to receive alerts.' };
    case 'undetermined': return { title: 'Not requested yet', detail: 'iOS will ask for permission when you turn on an alert.' };
    default: return { title: 'Unknown', detail: 'Notification permission could not be read on this device.' };
  }
}
