import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SignJWT, generateKeyPair, exportJWK } from 'jose';
import worker, { VEHICLE_IDS, snapshotStatus } from './index.js';

const now = Date.parse('2026-11-12T00:00:00Z');
const snapshot = { fetched_at: '2026-11-11T12:00:00Z', data_status: 'fresh' };

test('classifies collection states without inferring telemetry', () => {
  assert.equal(snapshotStatus(null, null, now), 'pending');
  assert.equal(snapshotStatus(snapshot, null, now), 'fresh');
  assert.equal(snapshotStatus(snapshot, null, now + 48 * 3600000), 'stale');
  assert.equal(snapshotStatus(snapshot, { status: 'error', error_code: 'api_http_500' }, now), 'error');
  assert.equal(snapshotStatus(snapshot, { status: 'error', error_code: 'api_http_403:journeys:www-use_dpop_nonce:scopes-openid' }, now), 'error');
  assert.equal(snapshotStatus(null, { status: 'error', error_code: 'token_http_400_invalid_grant' }, now), 'reauthorize');
  assert.equal(snapshotStatus(null, { status: 'error', error_code: 'api_http_401:journeys:scopes-absent' }, now), 'reauthorize');
});

test('rejects unauthorized, expired and other-owner access before querying D1', async t => {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const key = await exportJWK(publicKey);
  key.kid = 'unit-key';
  t.mock.method(globalThis, 'fetch', async () => Response.json({ keys: [key] }));
  const issuer = 'https://issuer.example';
  let reads = 0;
  const DB = { prepare(sql) {
    reads++;
    return {
      first: async () => sql.includes('FROM vehicles') ? { enabled: 1 } : null,
      all: async () => ({ results: [] }),
    };
  } };
  const env = { DB, GARAGE_ISSUER: issuer, GARAGE_JWKS_URL: issuer + '/keys', GARAGE_AUDIENCE: 'garage-test-api', GARAGE_OWNER_SUB: 'owner', GARAGE_OWNER_EMAIL: 'Owner@Example.com' };
  const sign = (sub, expiry, audience = env.GARAGE_AUDIENCE, email = 'owner@example.com') => new SignJWT(email ? { email } : {})
    .setProtectedHeader({ alg: 'ES256', kid: key.kid }).setIssuer(issuer).setSubject(sub)
    .setAudience(audience).setExpirationTime(expiry).sign(privateKey);
  const send = token => worker.fetch(new Request('https://garage.example/v1/range-rover', {
    headers: token ? { Authorization: 'Bearer ' + token } : {},
  }), env);
  const epoch = Math.floor(Date.now() / 1000);
  for (const token of [null, await sign('someone-else', epoch + 60), await sign('owner', epoch - 60), await sign('owner', epoch + 60, 'wrong-api'),
    await sign('owner', epoch + 60, undefined, 'someone@example.com'), await sign('owner', epoch + 60, undefined, null)]) {
    assert.equal((await send(token)).status, 401);
  }
  assert.equal(reads, 0);
  const result = await send(await sign('owner', epoch + 60));
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await result.json(), {
    status: 'pending', fetchedAt: null, lastDriveAt: null, lastDriveVerified: false, lastDriveTrust: 'withheld',
    rangeKm: null, fuelPercent: null, health: null, trips: null,
  });
  // Without a pinned sub, the email claim alone still restricts access to the owner.
  delete env.GARAGE_OWNER_SUB;
  assert.equal((await send(await sign('first-login-sub', epoch + 60))).status, 200);
  assert.equal((await send(await sign('first-login-sub', epoch + 60, undefined, 'someone@example.com'))).status, 401);
  delete env.GARAGE_OWNER_EMAIL;
  assert.equal((await send(await sign('first-login-sub', epoch + 60))).status, 503);
});

test('falls back to the Access userinfo endpoint for tokens it cannot verify locally', async t => {
  const issuer = 'https://team.example/cdn-cgi/access/sso/oidc/client';
  const seen = [];
  let identity = { sub: 'abc', email: 'owner@example.com' };
  t.mock.method(globalThis, 'fetch', async url => {
    seen.push(String(url));
    if (String(url) === issuer + '/userinfo') return identity ? Response.json(identity) : new Response('', { status: 401 });
    return Response.json({ keys: [] });
  });
  const DB = { prepare: sql => ({ first: async () => sql.includes('FROM vehicles') ? { enabled: 1 } : null, all: async () => ({ results: [] }) }) };
  const env = { DB, GARAGE_ISSUER: issuer, GARAGE_JWKS_URL: issuer + '/jwks', GARAGE_AUDIENCE: 'client', GARAGE_OWNER_EMAIL: 'owner@example.com' };
  const send = () => worker.fetch(new Request('https://garage.example/v1/range-rover', { headers: { Authorization: 'Bearer opaque-token' } }), env);
  const logs = t.mock.method(console, 'log', () => {});
  assert.equal((await send()).status, 200);
  assert.ok(seen.includes(issuer + '/userinfo'));
  identity = { sub: 'abc', email: 'someone@example.com' };
  assert.equal((await send()).status, 401);
  identity = null;
  assert.equal((await send()).status, 401);
  env.GARAGE_OWNER_SUB = 'other';
  identity = { sub: 'abc', email: 'owner@example.com' };
  assert.equal((await send()).status, 401);
  for (const call of logs.mock.calls) {
    const line = call.arguments.join(' ');
    assert.ok(!line.includes('opaque-token') && !line.includes('@example.com'), 'logs carry no token or email');
  }
});

test('shows unverified journey ends only when GARAGE_TRUST_UNVERIFIED_DRIVES is true', async t => {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const key = await exportJWK(publicKey);
  key.kid = 'trust-key';
  const issuer = 'https://trust.example';
  t.mock.method(globalThis, 'fetch', async () => Response.json({ keys: [key] }));
  const end = '2026-11-14T03:00:00.000Z';
  const DB = { prepare: sql => ({
    first: async () => sql.includes('FROM vehicles') ? { enabled: 1 }
      : sql.includes('FROM snapshots') ? { fetched_at: '2026-11-15T00:10:00Z', data_status: 'fresh', last_drive_at: end, last_drive_verified: 0 } : null,
    all: async () => ({ results: [{ ended_at: end }] }),
  }) };
  const env = { DB, GARAGE_ISSUER: issuer, GARAGE_JWKS_URL: issuer + '/jwks', GARAGE_AUDIENCE: 'aud', GARAGE_OWNER_EMAIL: 'owner@example.com' };
  const token = await new SignJWT({ email: 'owner@example.com' }).setProtectedHeader({ alg: 'ES256', kid: key.kid })
    .setIssuer(issuer).setSubject('s').setAudience('aud').setExpirationTime(Math.floor(Date.now() / 1000) + 60).sign(privateKey);
  const read = async () => (await worker.fetch(new Request('https://garage.example/v1/range-rover', { headers: { Authorization: 'Bearer ' + token } }), env)).json();
  let body = await read();
  assert.equal(body.lastDriveAt, null);
  assert.equal(body.trips, null);
  assert.equal(body.lastDriveVerified, false);
  assert.equal(body.lastDriveTrust, 'withheld');
  env.GARAGE_TRUST_UNVERIFIED_DRIVES = 'true';
  body = await read();
  assert.equal(body.lastDriveAt, end);
  assert.deepEqual(body.trips, [end]);
  assert.equal(body.lastDriveVerified, true);
  assert.equal(body.lastDriveTrust, 'owner-approved-unverified');
});

test('POST /refresh: owner only, maps collector results to 200 / 429 / 502', async t => {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const key = await exportJWK(publicKey);
  key.kid = 'refresh-key';
  const issuer = 'https://refresh.example';
  t.mock.method(globalThis, 'fetch', async () => Response.json({ keys: [key] }));
  let calls = 0;
  let next = { status: 'complete' };
  const DB = { prepare: sql => ({
    first: async () => sql.includes('FROM vehicles') ? { enabled: 1 } : null,
    all: async () => ({ results: [] }),
  }) };
  const env = { DB, COLLECTOR: { refresh: async () => { calls++; return next; } },
    GARAGE_ISSUER: issuer, GARAGE_JWKS_URL: issuer + '/jwks', GARAGE_AUDIENCE: 'aud', GARAGE_OWNER_EMAIL: 'owner@example.com' };
  const sign = email => new SignJWT({ email }).setProtectedHeader({ alg: 'ES256', kid: key.kid })
    .setIssuer(issuer).setSubject('s').setAudience('aud').setExpirationTime(Math.floor(Date.now() / 1000) + 60).sign(privateKey);
  const post = token => worker.fetch(new Request('https://garage.example/v1/range-rover/refresh', {
    method: 'POST', headers: token ? { Authorization: 'Bearer ' + token } : {} }), env);
  t.mock.method(console, 'log', () => {});
  assert.equal((await post(null)).status, 401);
  assert.equal((await post(await sign('someone@example.com'))).status, 401);
  assert.equal(calls, 0);
  const owner = await sign('owner@example.com');
  const ok = await post(owner);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).status, 'pending');
  next = { status: 'rate_limited', retryAfterSeconds: 123.4 };
  const limited = await post(owner);
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('Retry-After'), '124');
  assert.deepEqual(await limited.json(), { error: 'rate_limited', retryAfterSeconds: 124 });
  next = { status: 'error' };
  assert.equal((await post(owner)).status, 502);
  env.COLLECTOR = { refresh: async () => { throw new Error('rpc down'); } };
  assert.equal((await post(owner)).status, 502);
  const getAsPost = await worker.fetch(new Request('https://garage.example/v1/range-rover', { method: 'POST' }), env);
  assert.equal(getAsPost.status, 404);
});

async function ownerSetup(t, kid) {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const key = await exportJWK(publicKey);
  key.kid = kid;
  const issuer = 'https://' + kid + '.example';
  t.mock.method(globalThis, 'fetch', async () => Response.json({ keys: [key] }));
  const sign = (email = 'owner@example.com') => new SignJWT({ email }).setProtectedHeader({ alg: 'ES256', kid })
    .setIssuer(issuer).setSubject('s').setAudience('aud').setExpirationTime(Math.floor(Date.now() / 1000) + 60).sign(privateKey);
  const env = { GARAGE_ISSUER: issuer, GARAGE_JWKS_URL: issuer + '/jwks', GARAGE_AUDIENCE: 'aud', GARAGE_OWNER_EMAIL: 'owner@example.com' };
  return { env, sign };
}

/** D1 stub with a JLR row (synthetic values) that records every statement, so tests can assert reads only. */
function jlrDb({ enabled = 1, snapshot = { fetched_at: new Date(Date.now() - 3600000).toISOString(), data_status: 'fresh', range_km: 500, fuel_percent: 60, odometer_km: 12345, health_status: 'good', last_drive_at: null, last_drive_verified: 0 } } = {}) {
  const statements = [];
  return { statements, prepare(sql) {
    statements.push(sql);
    return {
      first: async () => sql.includes('LEFT JOIN snapshots') ? (enabled === null ? null : { id: 'range-l460', make: 'Land Rover', model: 'Range Rover', model_year: null, display_name: 'Range Rover', enabled, ...snapshot })
        : sql.includes('FROM vehicles') ? { enabled } : sql.includes('FROM snapshots') ? snapshot : null,
      all: async () => ({ results: [] }),
      run: async () => { throw new Error('gateway must not write'); },
    };
  } };
}

test('GET /v1/vehicles: owner only; JLR row plus local X7 / S e-tron GT in the camelCase shape, no collector call', async t => {
  const { env, sign } = await ownerSetup(t, 'list-key');
  let collector = 0;
  const DB = jlrDb();
  Object.assign(env, { DB, COLLECTOR: { refresh: async () => { collector++; return { status: 'complete' }; } }, GARAGE_TRUST_UNVERIFIED_DRIVES: 'true' });
  t.mock.method(console, 'log', () => {});
  const get = token => worker.fetch(new Request('https://garage.example/v1/vehicles', { headers: token ? { Authorization: 'Bearer ' + token } : {} }), env);
  assert.equal((await get(null)).status, 401);
  assert.equal((await get(await sign('someone@example.com'))).status, 401);
  assert.equal(DB.statements.length, 0);
  const res = await get(await sign());
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  const body = await res.json();
  assert.ok(Number.isFinite(Date.parse(body.generatedAt)));
  assert.deepEqual(body.vehicles.map(v => v.id), ['range-l460', 'bmw-x7', 'audi-s-etron-gt']);
  assert.deepEqual(VEHICLE_IDS, ['range-l460', 'bmw-x7', 'audi-s-etron-gt']);
  const [rover, x7, etron] = body.vehicles;
  const keys = ['id', 'make', 'model', 'modelYear', 'displayName', 'source', 'connection', 'status', 'fetchedAt', 'lastDriveAt',
    'lastDriveVerified', 'lastDriveTrust', 'rangeKm', 'fuelPercent', 'health', 'trips', 'electricRangeKm', 'socPercent', 'odometerKm'];
  for (const vehicle of body.vehicles) assert.deepEqual(Object.keys(vehicle), keys, vehicle.id);
  assert.equal(rover.source, 'jlr');
  assert.equal(rover.status, 'fresh');
  assert.equal(rover.rangeKm, 500);
  assert.equal(rover.odometerKm, 12345);
  // #19's synthetic fixture values, mapped field for field.
  assert.deepEqual({ ...x7, fetchedAt: null, lastDriveAt: null, trips: null }, {
    id: 'bmw-x7', make: 'BMW', model: 'X7', modelYear: 2026, displayName: 'BMW X7', source: 'local', connection: 'connected',
    status: 'fresh', fetchedAt: null, lastDriveAt: null, lastDriveVerified: true, lastDriveTrust: 'owner-approved-unverified',
    rangeKm: 645, fuelPercent: 73, health: 'good', trips: null, electricRangeKm: null, socPercent: null, odometerKm: 318,
  });
  assert.deepEqual({ ...etron, fetchedAt: null, lastDriveAt: null, trips: null }, {
    id: 'audi-s-etron-gt', make: 'Audi', model: 'S e-tron GT', modelYear: 2026, displayName: 'Audi S e-tron GT', source: 'local', connection: 'connected',
    status: 'fresh', fetchedAt: null, lastDriveAt: null, lastDriveVerified: true, lastDriveTrust: 'owner-approved-unverified',
    rangeKm: 329, fuelPercent: null, health: 'good', trips: null, electricRangeKm: 329, socPercent: 68, odometerKm: 4820,
  });
  for (const vehicle of [x7, etron]) assert.deepEqual(vehicle.trips, [vehicle.lastDriveAt]);
  assert.ok(Date.now() - Date.parse(etron.fetchedAt) < 36 * 3600000);
  // Read-only: SELECTs only, never a collector refresh, never a write.
  assert.equal(collector, 0);
  assert.ok(DB.statements.every(sql => /^\s*SELECT/i.test(sql)));
  assert.ok(DB.statements.every(sql => !/bmw-x7|audi-s-etron-gt/.test(sql)), 'local ids are never queried in D1');
});

test('GET /v1/vehicles: local rows keep last_drive_verified=0 semantics without the trust flag; JLR row disabled or D1 down', async t => {
  const { env, sign } = await ownerSetup(t, 'list-trust');
  Object.assign(env, { DB: jlrDb() });
  const token = await sign();
  const get = () => worker.fetch(new Request('https://garage.example/v1/vehicles', { headers: { Authorization: 'Bearer ' + token } }), env);
  let body = await (await get()).json();
  for (const vehicle of body.vehicles.slice(1)) {
    assert.equal(vehicle.lastDriveVerified, false);
    assert.equal(vehicle.lastDriveTrust, 'withheld');
    assert.equal(vehicle.lastDriveAt, null);
    assert.equal(vehicle.trips, null);
  }
  env.DB = jlrDb({ enabled: 0 });
  body = await (await get()).json();
  assert.deepEqual(body.vehicles.map(v => v.id), ['bmw-x7', 'audi-s-etron-gt']);
  env.DB = { prepare: () => ({ first: async () => { throw new Error('d1 down'); }, all: async () => { throw new Error('d1 down'); } }) };
  assert.equal((await get()).status, 503);
});

test('no collector call for local ids: there is no local refresh route, and the JLR refresh is unchanged', async t => {
  const { env, sign } = await ownerSetup(t, 'local-refresh');
  let collector = 0;
  Object.assign(env, { DB: jlrDb(), COLLECTOR: { refresh: async () => { collector++; return { status: 'complete' }; } } });
  const token = await sign();
  for (const id of ['bmw-x7', 'audi-s-etron-gt']) {
    for (const path of ['/v1/vehicles/' + id + '/refresh', '/v1/' + id + '/refresh', '/v1/vehicles/' + id]) {
      for (const method of ['GET', 'POST']) {
        const res = await worker.fetch(new Request('https://garage.example' + path, { method, headers: { Authorization: 'Bearer ' + token } }), env);
        assert.equal(res.status, 404, method + ' ' + path);
      }
    }
  }
  assert.equal((await worker.fetch(new Request('https://garage.example/v1/vehicles', { method: 'POST', headers: { Authorization: 'Bearer ' + token } }), env)).status, 404);
  assert.equal(collector, 0);
  const rover = await worker.fetch(new Request('https://garage.example/v1/range-rover/refresh', { method: 'POST', headers: { Authorization: 'Bearer ' + token } }), env);
  assert.equal(rover.status, 200);
  assert.equal(collector, 1);
  // The Range Rover payload keeps its exact pre-/v1/vehicles keys.
  assert.deepEqual(Object.keys(await rover.json()), ['status', 'fetchedAt', 'lastDriveAt', 'lastDriveVerified', 'lastDriveTrust', 'rangeKm', 'fuelPercent', 'health', 'trips']);
});

test('logs from the vehicles route carry no token or email', async t => {
  const { env, sign } = await ownerSetup(t, 'list-logs');
  Object.assign(env, { DB: jlrDb() });
  const logs = t.mock.method(console, 'log', () => {});
  const bad = await sign('intruder@example.com');
  await worker.fetch(new Request('https://garage.example/v1/vehicles', { headers: { Authorization: 'Bearer ' + bad } }), env);
  for (const call of logs.mock.calls) {
    const line = call.arguments.join(' ');
    assert.ok(!line.includes(bad) && !line.includes('@example.com'));
  }
});

test('GET /v1/vehicles/:id/history: owner only, read-only, oldest first, time / level / odometer only', async t => {
  const { env, sign } = await ownerSetup(t, 'history-key');
  const statements = [];
  // Synthetic readings (newest first, as D1 returns them for ORDER BY fetched_at DESC).
  const rows = [
    { fetched_at: '2026-11-03T00:00:00.000Z', fuel_percent: 80, soc_percent: null, odometer_km: 12645, range_km: 600, vin: 'x' },
    { fetched_at: '2026-11-01T00:00:00.000Z', fuel_percent: 30, soc_percent: null, odometer_km: 12345 },
  ];
  let fail = false;
  env.DB = { prepare(sql) {
    statements.push(sql);
    return { all: async () => { if (fail) throw new Error('no such table'); return { results: rows }; }, first: async () => null,
      run: async () => { throw new Error('gateway must not write'); } };
  } };
  t.mock.method(console, 'log', () => {});
  const get = (id, token) => worker.fetch(new Request('https://garage.example/v1/vehicles/' + id + '/history', { headers: token ? { Authorization: 'Bearer ' + token } : {} }), env);
  assert.equal((await get('range-l460', null)).status, 401);
  assert.equal((await get('range-l460', await sign('someone@example.com'))).status, 401);
  assert.equal(statements.length, 0);
  const token = await sign();
  const res = await get('range-l460', token);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  const body = await res.json();
  assert.deepEqual(body, { vehicleId: 'range-l460', points: [
    { fetchedAt: '2026-11-01T00:00:00.000Z', fuelPercent: 30, socPercent: null, odometerKm: 12345 },
    { fetchedAt: '2026-11-03T00:00:00.000Z', fuelPercent: 80, socPercent: null, odometerKm: 12645 },
  ] });
  assert.equal(statements.length, 1);
  assert.match(statements[0], /^SELECT fetched_at,fuel_percent,soc_percent,odometer_km FROM snapshot_history/);
  assert.match(statements[0], /LIMIT 400$/);
  // Local fixture vehicles have no history: empty, and D1 is not queried.
  for (const id of ['bmw-x7', 'audi-s-etron-gt']) assert.deepEqual(await (await get(id, token)).json(), { vehicleId: id, points: [] });
  assert.equal(statements.length, 1);
  // Unknown ids, other methods and malformed paths are 404.
  for (const id of ['ferrari-296', 'range-rover', '..', 'RANGE-L460']) assert.equal((await get(id, token)).status, 404, id);
  assert.equal((await worker.fetch(new Request('https://garage.example/v1/vehicles/range-l460/history', { method: 'POST', headers: { Authorization: 'Bearer ' + token } }), env)).status, 404);
  // Table missing (migration not applied yet) or D1 down: 503, never invented points.
  fail = true;
  assert.equal((await get('range-l460', token)).status, 503);
});
