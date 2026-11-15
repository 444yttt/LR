import { createRemoteJWKSet, jwtVerify } from 'jose';

const maxAgeMs = 36 * 3600000;
const keys = new Map();

function response(body, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.pathname !== '/v1/range-rover') return response({ error: 'not_found' }, 404);
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
    try {
      const vehicle = await env.DB.prepare("SELECT enabled FROM vehicles WHERE id='range-l460'").first();
      if (vehicle?.enabled !== 1) return response({ error: 'unavailable' }, 503);
      const [snapshot, run, trips] = await Promise.all([
        env.DB.prepare("SELECT fetched_at,last_drive_at,last_drive_verified,range_km,fuel_percent,health_status,data_status FROM snapshots WHERE vehicle_id='range-l460'").first(),
        env.DB.prepare("SELECT status,error_code FROM ingestion_runs WHERE vehicle_id='range-l460' AND status IN ('complete','error') ORDER BY finished_at DESC LIMIT 1").first(),
        env.DB.prepare("SELECT ended_at FROM vehicle_trip_ends WHERE vehicle_id='range-l460' ORDER BY ended_at DESC LIMIT 50").all(),
      ]);
      // GARAGE_TRUST_UNVERIFIED_DRIVES=true: the owner chose (2026-11-15) to see journey end times
      // before the one-time Remote-app cross-check. lastDriveTrust tells clients which rule applied.
      const ownerVerified = snapshot?.last_drive_verified === 1;
      const trustUnverified = env.GARAGE_TRUST_UNVERIFIED_DRIVES === 'true';
      const verified = ownerVerified || (trustUnverified && Boolean(snapshot?.last_drive_at));
      return response({
        status: snapshotStatus(snapshot, run, Date.now()),
        fetchedAt: snapshot?.fetched_at ?? null,
        lastDriveAt: verified ? snapshot.last_drive_at : null,
        lastDriveVerified: verified,
        lastDriveTrust: ownerVerified ? 'verified' : verified ? 'owner-approved-unverified' : 'withheld',
        rangeKm: snapshot?.range_km ?? null,
        fuelPercent: snapshot?.fuel_percent ?? null,
        health: snapshot?.health_status ?? null,
        trips: verified ? trips.results.map(trip => trip.ended_at) : null,
      });
    } catch { return response({ error: 'unavailable' }, 503); }
  },
};
