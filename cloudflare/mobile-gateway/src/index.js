import { createRemoteJWKSet, jwtVerify } from 'jose';
// The one fixture table for the local BMW X7 / Audi S e-tron GT rows (PR #19). Bundled from the collector's source;
// never written to D1 and never passed to the collector.
import { LOCAL_VEHICLE_IDS, combineVehicleRows } from '../../src/local-vehicles.js';

const maxAgeMs = 36 * 3600000;
const keys = new Map();

function response(body, status = 200, extra = {}) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra } });
}

function jwksFor(url) {
  const uri = new URL(url);
  if (uri.protocol !== 'https:' || uri.username || uri.password) throw new Error('Invalid JWKS URL');
  if (!keys.has(uri.href)) keys.set(uri.href, createRemoteJWKSet(uri));
  return keys.get(uri.href);
}

export function isOwnerEmail(claim, owner) {
  if (typeof claim !== 'string' || typeof owner !== 'string' || !owner.trim()) return false;
  return claim.trim().toLowerCase() === owner.trim().toLowerCase();
}

/** Shape of an unverified token, for logs: claim names and yes/no checks only, never values. */
export function describeToken(token, env) {
  const parts = token.split('.');
  const out = { parts: parts.length };
  if (parts.length !== 3) return out;
  try {
    const decode = part => JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    const header = decode(parts[0]);
    const payload = decode(parts[1]);
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    return {
      ...out,
      alg: typeof header.alg === 'string' ? header.alg : null,
      claims: Object.keys(payload).sort(),
      issMatches: payload.iss === env.GARAGE_ISSUER,
      issIsTeamDomain: typeof payload.iss === 'string' && payload.iss === new URL(env.GARAGE_ISSUER).origin,
      audMatches: aud.includes(env.GARAGE_AUDIENCE),
      hasEmail: typeof payload.email === 'string',
    };
  } catch { return { ...out, decodable: false }; }
}

/**
 * Owner check. Fast path: verify the JWT locally against the Access app's issuer/JWKS/audience and
 * the email claim. Fallback: ask the Access app's own userinfo endpoint, which validates the token
 * for this client and returns the signed-in identity, then require the owner email there.
 */
export async function verifyOwner(token, env) {
  const diagnostics = {};
  try {
    const { payload } = await jwtVerify(token, jwksFor(env.GARAGE_JWKS_URL), {
      issuer: env.GARAGE_ISSUER,
      audience: env.GARAGE_AUDIENCE,
      ...(env.GARAGE_OWNER_SUB ? { subject: env.GARAGE_OWNER_SUB } : {}),
      algorithms: ['RS256', 'ES256'],
      requiredClaims: ['exp', 'sub', 'aud', 'iss'],
    });
    if (isOwnerEmail(payload.email, env.GARAGE_OWNER_EMAIL)) return { ok: true, via: 'jwt' };
    diagnostics.jwt = typeof payload.email === 'string' ? 'email_mismatch' : 'email_missing';
  } catch (error) {
    diagnostics.jwt = [error?.code ?? 'error', error?.claim].filter(Boolean).join(':');
    if (error?.code === 'ERR_JWT_EXPIRED') return { ok: false, diagnostics };
  }
  diagnostics.token = describeToken(token, env);
  try {
    const userinfo = await fetch(env.GARAGE_ISSUER + '/userinfo', {
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }, redirect: 'manual',
    });
    diagnostics.userinfo = userinfo.status;
    if (userinfo.status === 200) {
      const identity = await userinfo.json();
      const emailOk = isOwnerEmail(identity?.email, env.GARAGE_OWNER_EMAIL);
      const subOk = !env.GARAGE_OWNER_SUB || identity?.sub === env.GARAGE_OWNER_SUB;
      if (emailOk && subOk) return { ok: true, via: 'userinfo' };
      diagnostics.userinfoEmail = typeof identity?.email === 'string' ? (emailOk ? 'match' : 'mismatch') : 'missing';
      diagnostics.userinfoSub = subOk;
    }
  } catch { diagnostics.userinfo = 'fetch_error'; }
  return { ok: false, diagnostics };
}

export function snapshotStatus(snapshot, run, now) {
  if (run?.status === 'error') {
    if (/^(?:token_http_\d+_(?:invalid_grant|invalid_token|invalid_client)|api_http_401)(?:[:_]|$)/.test(run.error_code ?? '')) {
      return 'reauthorize';
    }
    return 'error';
  }
  if (snapshot?.data_status === 'error') return 'error';
  const fetchedAt = Date.parse(snapshot?.fetched_at ?? '');
  if (!Number.isFinite(fetchedAt)) return 'pending';
  if (snapshot.data_status !== 'fresh' || fetchedAt > now || now - fetchedAt > maxAgeMs) return 'stale';
  return 'fresh';
}

/** D1 id of the JLR vehicle. The app calls it `range-rover`; the ids in `/v1/vehicles` are the API / D1 ids. */
export const JLR_VEHICLE_ID = 'range-l460';
/** Every id `/v1/vehicles` can return, in Garage order. */
export const VEHICLE_IDS = Object.freeze([JLR_VEHICLE_ID, ...LOCAL_VEHICLE_IDS]);

const numberOrNull = value => typeof value === 'number' && Number.isFinite(value) ? value : null;

/**
 * One vehicle in the gateway's camelCase shape: the `/v1/range-rover` fields plus id, names, model year, EV values,
 * and the row's connection state / source. The same mapping serves the JLR row and the local rows.
 * `trips` are journey end times (JLR: `vehicle_trip_ends`; local rows report only their last drive).
 */
export function vehicleView(row, { run = null, trips = null, trustUnverified = false, now = Date.now() } = {}) {
  // GARAGE_TRUST_UNVERIFIED_DRIVES=true: the owner chose (2026-11-15) to see journey end times
  // before the one-time Remote-app cross-check. lastDriveTrust tells clients which rule applied.
  const ownerVerified = row?.last_drive_verified === 1;
  const verified = ownerVerified || (trustUnverified && Boolean(row?.last_drive_at));
  return {
    status: snapshotStatus(row, run, now),
    fetchedAt: row?.fetched_at ?? null,
    lastDriveAt: verified ? row.last_drive_at : null,
    lastDriveVerified: verified,
    lastDriveTrust: ownerVerified ? 'verified' : verified ? 'owner-approved-unverified' : 'withheld',
    rangeKm: row?.range_km ?? null,
    fuelPercent: row?.fuel_percent ?? null,
    health: row?.health_status ?? null,
    trips: verified ? trips ?? [] : null,
  };
}

/** `/v1/vehicles` entry: identity + vehicleView + EV fields. */
function listEntry(row, options) {
  return {
    id: row.id,
    make: row.make ?? null,
    model: row.model ?? null,
    modelYear: numberOrNull(row.model_year),
    displayName: row.display_name ?? null,
    source: row.source === 'local' ? 'local' : 'jlr',
    connection: row.connection_status === 'connected' ? 'connected' : 'disconnected',
    ...vehicleView(row, options),
    electricRangeKm: row.electric_range_km ?? null,
    socPercent: row.soc_percent ?? null,
  };
}

async function jlrSnapshot(env) {
  const [snapshot, run, trips] = await Promise.all([
    env.DB.prepare("SELECT fetched_at,last_drive_at,last_drive_verified,range_km,fuel_percent,health_status,data_status FROM snapshots WHERE vehicle_id='range-l460'").first(),
    env.DB.prepare("SELECT status,error_code FROM ingestion_runs WHERE vehicle_id='range-l460' AND status IN ('complete','error') ORDER BY finished_at DESC LIMIT 1").first(),
    env.DB.prepare("SELECT ended_at FROM vehicle_trip_ends WHERE vehicle_id='range-l460' ORDER BY ended_at DESC LIMIT 50").all(),
  ]);
  return { snapshot, run, trips: trips.results.map(trip => trip.ended_at) };
}

/**
 * GET /v1/vehicles: the Range Rover from D1 plus the local X7 / S e-tron GT rows, through #19's combineVehicleRows
 * (a D1 row with a local id would take precedence). Read-only: no collector call, no D1 write.
 */
async function vehicleList(env, now) {
  const trustUnverified = env.GARAGE_TRUST_UNVERIFIED_DRIVES === 'true';
  const rover = await env.DB.prepare(`SELECT v.id,v.make,v.model,v.model_year,v.display_name,v.enabled,
    s.fetched_at,s.last_drive_at,s.last_drive_verified,s.range_km,s.electric_range_km,s.fuel_percent,s.soc_percent,
    s.health_status,s.data_status FROM vehicles v LEFT JOIN snapshots s ON s.vehicle_id=v.id WHERE v.id='range-l460'`).first();
  const jlr = rover?.enabled === 1 ? await jlrSnapshot(env) : null;
  const rows = combineVehicleRows(rover?.enabled === 1 ? [{ ...rover, source: 'jlr' }] : [], now);
  const vehicles = rows.filter(row => VEHICLE_IDS.includes(row.id)).map(row => row.id === JLR_VEHICLE_ID
    ? listEntry(row, { run: jlr.run, trips: jlr.trips, trustUnverified, now })
    : listEntry(row, { trips: row.last_drive_at ? [row.last_drive_at] : [], trustUnverified, now }));
  return { vehicles, generatedAt: new Date(now).toISOString() };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const read = request.method === 'GET' && url.pathname === '/v1/range-rover';
    const refresh = request.method === 'POST' && url.pathname === '/v1/range-rover/refresh';
    const list = request.method === 'GET' && url.pathname === '/v1/vehicles';
    if (!read && !refresh && !list) return response({ error: 'not_found' }, 404);
    if (!env.GARAGE_ISSUER || !env.GARAGE_JWKS_URL || !env.GARAGE_AUDIENCE || !env.GARAGE_OWNER_EMAIL || !env.DB) {
      return response({ error: 'unavailable' }, 503);
    }
    const token = request.headers.get('Authorization')?.match(/^Bearer ([^\s]+)$/i)?.[1];
    if (!token) return response({ error: 'unauthorized' }, 401);
    const auth = await verifyOwner(token, env);
    if (!auth.ok) {
      console.log(JSON.stringify({ event: 'auth_denied', ...auth.diagnostics }));
      return response({ error: 'unauthorized' }, 401);
    }
    if (list) {
      try { return response(await vehicleList(env, Date.now())); } catch { return response({ error: 'unavailable' }, 503); }
    }
    if (refresh) {
      // Owner-triggered, read-only vehicle read through the collector's RPC entrypoint. The collector
      // enforces the 5-minute gap atomically in D1, shared with the daily cron. JLR only: the local
      // X7 / S e-tron GT rows have no refresh route; the app re-reads GET /v1/vehicles for them.
      if (!env.COLLECTOR) return response({ error: 'unavailable' }, 503);
      let result;
      try { result = await env.COLLECTOR.refresh(); } catch { result = { status: 'error' }; }
      if (result?.status === 'rate_limited') {
        const retry = Math.max(1, Math.min(300, Math.ceil(Number(result.retryAfterSeconds) || 300)));
        return response({ error: 'rate_limited', retryAfterSeconds: retry }, 429, { 'Retry-After': String(retry) });
      }
      if (result?.status === 'disabled') return response({ error: 'unavailable' }, 503);
      if (result?.status !== 'complete') return response({ error: 'refresh_failed' }, 502);
    }
    try {
      const vehicle = await env.DB.prepare("SELECT enabled FROM vehicles WHERE id='range-l460'").first();
      if (vehicle?.enabled !== 1) return response({ error: 'unavailable' }, 503);
      const { snapshot, run, trips } = await jlrSnapshot(env);
      return response(vehicleView(snapshot, { run, trips, trustUnverified: env.GARAGE_TRUST_UNVERIFIED_DRIVES === 'true' }));
    } catch { return response({ error: 'unavailable' }, 503); }
  },
};
