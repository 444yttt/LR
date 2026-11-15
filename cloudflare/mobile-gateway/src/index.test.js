import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SignJWT, generateKeyPair, exportJWK } from 'jose';
import worker, { snapshotStatus } from './index.js';

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
