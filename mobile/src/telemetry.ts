export type Snapshot = {
  fetchedAt: string | null;
  lastDriveAt: string | null;
  lastDriveVerified: boolean;
  rangeKm: number | null;
  fuelPercent: number | null;
  health: 'good' | 'attention-required' | 'service-required' | null;
  status: 'fresh' | 'stale' | 'error' | 'pending' | 'reauthorize';
  trips: Drive[] | null;
};

/**
 * One verified drive. The gateway currently reports only the trip end time
 * (`trips: string[]`); the other fields are parsed when a richer object is sent
 * and otherwise stay null so the UI shows them as not reported.
 */
export type Drive = {
  endedAt: string;
  startedAt: string | null;
  distanceKm: number | null;
  /** Average fuel consumption in L/100 km, when the source reports it. */
  efficiencyLPer100Km: number | null;
};

export const DAY_MS = 86_400_000;
export const MAX_SNAPSHOT_AGE = 36 * 60 * 60 * 1000;

export function dateValue(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function numberIn(value: unknown, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max ? value : null;
}

export function parseSnapshot(payload: unknown): Snapshot {
  if (!payload || typeof payload !== 'object') throw new Error('Invalid response');
  const row = payload as Record<string, unknown>;
  const status = row.status;
  if (status !== 'fresh' && status !== 'stale' && status !== 'error' && status !== 'pending' && status !== 'reauthorize') {
    throw new Error('Invalid snapshot status');
  }
  const fetchedAt = dateValue(row.fetchedAt);
  const lastDriveAt = dateValue(row.lastDriveAt);
  const health = row.health;
  return {
    fetchedAt, lastDriveAt, status,
    lastDriveVerified: row.lastDriveVerified === true && lastDriveAt !== null,
    rangeKm: numberIn(row.rangeKm, 2000),
    fuelPercent: numberIn(row.fuelPercent, 100),
    health: health === 'good' || health === 'attention-required' || health === 'service-required' ? health : null,
    trips: Array.isArray(row.trips) ? parseDrives(row.trips) : null,
  };
}

function parseDrive(value: unknown): Drive | null {
  if (typeof value === 'string') {
    const endedAt = dateValue(value);
    return endedAt ? { endedAt, startedAt: null, distanceKm: null, efficiencyLPer100Km: null } : null;
  }
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const endedAt = dateValue(item.endedAt);
  if (!endedAt) return null;
  const started = dateValue(item.startedAt);
  const startedAt = started && Date.parse(started) < Date.parse(endedAt)
    && Date.parse(endedAt) - Date.parse(started) <= DAY_MS ? started : null;
  return {
    endedAt, startedAt,
    distanceKm: numberIn(item.distanceKm, 2000),
    efficiencyLPer100Km: numberIn(item.efficiencyLPer100Km, 60),
  };
}

/** Normalizes drives newest first, one entry per end time. */
export function parseDrives(values: unknown[]): Drive[] {
  const byEnd = new Map<string, Drive>();
  for (const value of values) {
    const drive = parseDrive(value);
    if (drive && !byEnd.has(drive.endedAt)) byEnd.set(drive.endedAt, drive);
  }
  return [...byEnd.values()].sort((a, b) => b.endedAt.localeCompare(a.endedAt));
}

export function isFresh(snapshot: Snapshot, now: number): boolean {
  const time = snapshot.fetchedAt ? Date.parse(snapshot.fetchedAt) : NaN;
  return snapshot.status === 'fresh' && now >= time && now - time <= MAX_SNAPSHOT_AGE;
}

export function idleDays(snapshot: Snapshot | null, now: number): number | null {
  if (!snapshot?.lastDriveVerified || !snapshot.lastDriveAt || !isFresh(snapshot, now)) return null;
  const age = now - Date.parse(snapshot.lastDriveAt);
  return age >= 0 ? Math.floor(age / DAY_MS) : null;
}

export function dueThreshold(snapshot: Snapshot | null, now: number): 7 | 14 | null {
  const days = idleDays(snapshot, now);
  if (days === null || days < 7) return null;
  return days >= 14 ? 14 : 7;
}
