export type Snapshot = {
  fetchedAt: string | null;
  lastDriveAt: string | null;
  lastDriveVerified: boolean;
  rangeKm: number | null;
  fuelPercent: number | null;
  health: 'good' | 'attention-required' | 'service-required' | null;
  status: 'fresh' | 'stale' | 'error' | 'pending' | 'reauthorize';
  trips: string[] | null;
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
    trips: Array.isArray(row.trips)
      ? [...new Set(row.trips.map(dateValue).filter((date): date is string => date !== null))].sort().reverse()
      : null,
  };
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
