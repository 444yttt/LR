// GET /v1/vehicles (mobile gateway) → one Snapshot per app vehicle. Pure: runs under `node --test`.
// The gateway speaks API / D1 ids; the app has its own stable VehicleIds. The mapping is explicit and closed:
// unknown ids are ignored, and no id is ever guessed from a name.
import { parseSnapshot, type Snapshot } from './telemetry.ts';
import type { VehicleId } from './garageModel.ts';
import { parseHistory, type HistoryPoint } from './fuelEstimate.ts';

/** Gateway / D1 id → app id. */
export const API_TO_APP: Readonly<Record<string, VehicleId>> = Object.freeze({
  'range-l460': 'range-rover',
  'bmw-x7': 'bmw-x7',
  'audi-s-etron-gt': 'audi-s-etron-gt',
});

/** App id → gateway id, for the vehicles the gateway serves. */
export const APP_TO_API: Readonly<Partial<Record<VehicleId, string>>> = Object.freeze(
  Object.fromEntries(Object.entries(API_TO_APP).map(([api, app]) => [app, api])));

/** The app vehicle whose "Update now" asks the collector for a live JLR read (POST /v1/range-rover/refresh). */
export const JLR_VEHICLE: VehicleId = 'range-rover';

export type VehicleSnapshots = Readonly<Partial<Record<VehicleId, Snapshot>>>;

/**
 * `{ vehicles: [...] }` → snapshots by app id. Each entry goes through the same parseSnapshot as the Range Rover;
 * an entry with an unknown id or an unreadable shape is skipped, a malformed envelope throws.
 */
export function parseVehicleList(payload: unknown): VehicleSnapshots {
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { vehicles?: unknown }).vehicles)) {
    throw new Error('Invalid vehicles response');
  }
  const out: Partial<Record<VehicleId, Snapshot>> = {};
  for (const entry of (payload as { vehicles: unknown[] }).vehicles) {
    const apiId = entry && typeof entry === 'object' ? (entry as { id?: unknown }).id : undefined;
    const id = typeof apiId === 'string' && Object.hasOwn(API_TO_APP, apiId) ? API_TO_APP[apiId] : undefined;
    if (!id || out[id]) continue;
    try { out[id] = parseSnapshot(entry); } catch { /* one bad row does not hide the others */ }
  }
  return out;
}

/**
 * GET /v1/vehicles, or — when the gateway answers 404 because it predates that route — the Range Rover-only
 * GET /v1/range-rover. Any other status (401, 503, …) is returned as is for the caller's usual handling.
 * `read` turns the JSON body into snapshots by app id; in the legacy case only the Range Rover has one.
 */
export async function requestVehicles(get: (path: string) => Promise<Response>): Promise<{ response: Response; legacy: boolean }> {
  const response = await get('/v1/vehicles');
  if (response.status !== 404) return { response, legacy: false };
  return { response: await get('/v1/range-rover'), legacy: true };
}

export const readVehicles = (body: unknown, legacy: boolean): VehicleSnapshots =>
  legacy ? { [JLR_VEHICLE]: parseSnapshot(body) } : parseVehicleList(body);

/** Outcome of reading one vehicle's telemetry history (fuel-economy estimate). */
export type HistoryLoad =
  | { kind: 'ok'; points: HistoryPoint[] }
  /** The gateway predates GET /v1/vehicles/:id/history (404): it needs a deploy before history exists. */
  | { kind: 'notDeployed' }
  | { kind: 'unavailable' }
  | { kind: 'signedOut' }
  /** The vehicle has no gateway data source (Ferrari). */
  | { kind: 'noSource' };

/**
 * GET /v1/vehicles/:apiId/history → points, oldest first. Read-only; a failure is reported, never filled in.
 * `get` performs the authorised request (the caller owns the token and timeout).
 */
export async function requestHistory(get: (path: string) => Promise<Response>, id: VehicleId): Promise<HistoryLoad> {
  const apiId = APP_TO_API[id];
  if (!apiId) return { kind: 'noSource' };
  try {
    const response = await get('/v1/vehicles/' + encodeURIComponent(apiId) + '/history');
    if (response.status === 404) return { kind: 'notDeployed' };
    if (!response.ok) return { kind: 'unavailable' };
    return { kind: 'ok', points: parseHistory(await response.json()) };
  } catch {
    return { kind: 'unavailable' };
  }
}
