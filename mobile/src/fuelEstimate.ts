// Economy estimated from telemetry history (GET /v1/vehicles/:id/history): odometer delta ÷ energy used, where energy
// used = level drop (fuel % or state of charge) × the capacity the owner entered. Pure: runs under `node --test`.
//
// It needs both an owner-entered capacity and a history that spans a refuel; otherwise the result says which is
// missing and no number is produced. A level reading is coarse (whole percent, sensor noise), so short stretches are
// not used.
import type { Energy } from './fuelLog.ts';
import { dateValue } from './telemetry.ts';

export type HistoryPoint = { fetchedAt: string; fuelPercent: number | null; socPercent: number | null; odometerKm: number | null };

/**
 * A rise in level of at least this many percentage points between two readings is a refuel (or a charge). Smaller
 * rises are sensor wiggle (temperature, slope, parking angle) and stay inside the stretch.
 */
export const REFUEL_JUMP_PP = 8;
/** A stretch counts only when the level fell by at least this much… */
export const MIN_DROP_PP = 10;
/** …over at least this distance, so whole-percent rounding cannot dominate the result. */
export const MIN_DISTANCE_KM = 50;

/** `{ vehicleId, points: [...] }` → readings, oldest first. Malformed points are dropped; a malformed envelope throws. */
export function parseHistory(payload: unknown): HistoryPoint[] {
  const points = payload && typeof payload === 'object' ? (payload as { points?: unknown }).points : undefined;
  if (!Array.isArray(points)) throw new Error('Invalid history response');
  const num = (value: unknown, max: number) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max ? value : null;
  const out: HistoryPoint[] = [];
  for (const item of points) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const fetchedAt = dateValue(row.fetchedAt);
    if (!fetchedAt) continue;
    out.push({ fetchedAt, fuelPercent: num(row.fuelPercent, 100), socPercent: num(row.socPercent, 100), odometerKm: num(row.odometerKm, 2_000_000) });
  }
  return out.sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt));
}

export type Stretch = { from: string; to: string; distanceKm: number; dropPercent: number; used: number; economy: number };

export type Estimate =
  | { kind: 'ok'; latest: Stretch; average: number; stretches: Stretch[]; refuels: number; points: number }
  | { kind: 'empty'; reason: 'noCapacity' | 'notEnough'; points: number; refuels: number };

/**
 * Splits the readings at refuels (a rise ≥ REFUEL_JUMP_PP) and measures each stretch that starts right after a refuel,
 * from that reading to the last one before the next refuel (or the latest reading). The stretch's energy is its net
 * level drop × capacity. A stretch with an odometer that goes backwards, too small a drop or too short a distance is
 * left out. Without capacity, without a refuel in the history, or without a usable stretch, the result is empty.
 */
export function estimateFromHistory(history: readonly HistoryPoint[], capacity: number | null, energy: Energy): Estimate {
  const readings = [...history]
    .map(point => ({ at: point.fetchedAt, level: energy === 'electric' ? point.socPercent : point.fuelPercent, odometer: point.odometerKm }))
    .filter((r): r is { at: string; level: number; odometer: number } => r.level !== null && r.odometer !== null)
    .sort((a, b) => a.at.localeCompare(b.at));
  // Indices where a refuel had happened since the previous reading.
  const refuelAt: number[] = [];
  for (let i = 1; i < readings.length; i++) if (readings[i].level - readings[i - 1].level >= REFUEL_JUMP_PP) refuelAt.push(i);
  const base = { points: readings.length, refuels: refuelAt.length };
  if (capacity === null || !(capacity > 0)) return { kind: 'empty', reason: 'noCapacity', ...base };
  const stretches: Stretch[] = [];
  refuelAt.forEach((start, k) => {
    const end = (k + 1 < refuelAt.length ? refuelAt[k + 1] : readings.length) - 1;
    if (end <= start) return;
    const first = readings[start];
    const last = readings[end];
    // The odometer must never run backwards inside a stretch.
    for (let i = start + 1; i <= end; i++) if (readings[i].odometer < readings[i - 1].odometer) return;
    const distanceKm = last.odometer - first.odometer;
    const dropPercent = first.level - last.level;
    if (dropPercent < MIN_DROP_PP || distanceKm < MIN_DISTANCE_KM) return;
    const used = dropPercent / 100 * capacity;
    stretches.push({ from: first.at, to: last.at, distanceKm, dropPercent, used, economy: distanceKm / used });
  });
  if (!stretches.length) return { kind: 'empty', reason: 'notEnough', ...base };
  const km = stretches.reduce((sum, s) => sum + s.distanceKm, 0);
  const used = stretches.reduce((sum, s) => sum + s.used, 0);
  return { kind: 'ok', latest: stretches[stretches.length - 1], average: km / used, stretches, ...base };
}
