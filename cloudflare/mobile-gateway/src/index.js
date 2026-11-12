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

export function snapshotStatus(snapshot, run, now) {
  if (run?.status === 'error') {
    if (/^(?:token_http_\d+_(?:invalid_grant|invalid_token|invalid_client)|api_http_401)$/.test(run.error_code ?? '')) {
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
    if (!env.GARAGE_ISSUER || !env.GARAGE_JWKS_URL || !env.GARAGE_AUDIENCE || !env.GARAGE_OWNER_SUB || !env.DB) {
      return response({ error: 'unavailable' }, 503);
    }
    const token = request.headers.get('Authorization')?.match(/^Bearer ([^\s]+)$/i)?.[1];
    if (!token) return response({ error: 'unauthorized' }, 401);
    try {
      await jwtVerify(token, jwksFor(env.GARAGE_JWKS_URL), {
        issuer: env.GARAGE_ISSUER,
        audience: env.GARAGE_AUDIENCE,
        subject: env.GARAGE_OWNER_SUB,
        algorithms: ['RS256', 'ES256'],
        requiredClaims: ['exp', 'sub', 'aud', 'iss'],
      });
    } catch { return response({ error: 'unauthorized' }, 401); }
    try {
      const vehicle = await env.DB.prepare("SELECT enabled FROM vehicles WHERE id='range-l460'").first();
      if (vehicle?.enabled !== 1) return response({ error: 'unavailable' }, 503);
      const [snapshot, run, trips] = await Promise.all([
        env.DB.prepare("SELECT fetched_at,last_drive_at,last_drive_verified,range_km,fuel_percent,health_status,data_status FROM snapshots WHERE vehicle_id='range-l460'").first(),
        env.DB.prepare("SELECT status,error_code FROM ingestion_runs WHERE vehicle_id='range-l460' AND status IN ('complete','error') ORDER BY finished_at DESC LIMIT 1").first(),
        env.DB.prepare("SELECT ended_at FROM vehicle_trip_ends WHERE vehicle_id='range-l460' ORDER BY ended_at DESC LIMIT 50").all(),
      ]);
      const verified = snapshot?.last_drive_verified === 1;
      return response({
        status: snapshotStatus(snapshot, run, Date.now()),
        fetchedAt: snapshot?.fetched_at ?? null,
        lastDriveAt: verified ? snapshot.last_drive_at : null,
        lastDriveVerified: verified,
        rangeKm: snapshot?.range_km ?? null,
        fuelPercent: snapshot?.fuel_percent ?? null,
        health: snapshot?.health_status ?? null,
        trips: verified ? trips.results.map(trip => trip.ended_at) : null,
      });
    } catch { return response({ error: 'unavailable' }, 503); }
  },
};
