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
    status: 'pending', fetchedAt: null, lastDriveAt: null, lastDriveVerified: false,
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
