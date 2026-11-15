import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTH_SCOPES, asPersistedSession, bootSession, clearSession, credentialsForRequest,
  expirySkewMs, loadSession, markSessionEstablished, phaseAfterRefreshFailure, refreshInMs,
  retryUnauthorized, saveSession, sessionFromToken, sessionWasEstablished,
  type PersistedSession, type SessionStore,
} from '../src/session.ts';

const now = Date.parse('2026-11-14T00:00:00Z');
const access = 'access-token';
const refresh = 'refresh-token';

function memoryStore(): SessionStore & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    async get(key) { return values.get(key) ?? null; },
    async set(key, value) { values.set(key, value); },
    async remove(key) { values.delete(key); },
  };
}

function session(expiresAt: number, refreshToken: string | null = refresh): PersistedSession {
  return { accessToken: access, expiresAt, refreshToken };
}

test('the sign-in request asks Access for a refresh token via offline_access', () => {
  assert.deepEqual([...AUTH_SCOPES], ['openid', 'email', 'offline_access']);
});

test('sessions round-trip through the store and a missing refresh token is removed', async () => {
  const store = memoryStore();
  await saveSession(store, session(now + 3600_000, refresh));
  assert.deepEqual(await loadSession(store), session(now + 3600_000, refresh));
  assert.deepEqual([...store.values.keys()].sort(), [
    'garage.session.access', 'garage.session.expiry', 'garage.session.refresh',
  ]);
  await saveSession(store, session(now + 3600_000, null));
  assert.equal((await loadSession(store))?.refreshToken, null);
  assert.equal(store.values.has('garage.session.refresh'), false);
  await markSessionEstablished(store);
  assert.equal(await sessionWasEstablished(store), true);
  await clearSession(store);
  assert.equal(await loadSession(store), null);
  assert.equal(await sessionWasEstablished(store), false);
  assert.equal(store.values.size, 0);
});

test('launch uses a live access token, refreshes an expired one, and expires when it cannot', () => {
  assert.deepEqual(bootSession(null, now), { type: 'signedOut' });
  assert.equal(bootSession(session(now + 120_000), now).type, 'use');
  assert.deepEqual(bootSession(session(now + 30_000), now), { type: 'refresh', refreshToken: refresh });
  assert.deepEqual(bootSession(session(now - 1, null), now), { type: 'expired' });
  assert.equal(bootSession({ accessToken: '', expiresAt: 0, refreshToken: refresh }, now).type, 'refresh');
});

test('a gateway request renews a token inside the expiry skew instead of sending it', () => {
  const live = session(now + expirySkewMs + 1);
  assert.equal(credentialsForRequest(live, now).type, 'use');
  assert.deepEqual(credentialsForRequest(session(now + expirySkewMs), now), { type: 'refresh', refreshToken: refresh });
  assert.deepEqual(credentialsForRequest(session(now + 10_000, null), now), { type: 'expired' });
  const memory = asPersistedSession({ token: 'access-token', expiresAt: now + 10_000, refreshToken: refresh });
  assert.deepEqual(credentialsForRequest(memory, now), { type: 'refresh', refreshToken: refresh });
});

test('a 401 tries one refresh when a refresh token remains, then gives up', () => {
  assert.equal(retryUnauthorized(refresh, false), 'refresh');
  assert.equal(retryUnauthorized(refresh, true), 'giveUp');
  assert.equal(retryUnauthorized(null, false), 'giveUp');
});

test('proactive refresh is scheduled one skew before expiry', () => {
  assert.equal(refreshInMs(now + 15 * 60_000, now), 14 * 60_000);
  assert.equal(refreshInMs(now + 30_000, now), 0);
  assert.equal(refreshInMs(Number.NaN, now), null);
});

test('token refresh keeps the previous refresh token and wording depends on whether the session was established', () => {
  const kept = sessionFromToken({ accessToken: 'next-access', expiresIn: 300 }, now, refresh);
  assert.deepEqual(kept, { accessToken: 'next-access', expiresAt: now + 300_000, refreshToken: refresh });
  const rotated = sessionFromToken({ accessToken: 'next-access', expiresIn: 300, refreshToken: 'rotated' }, now, refresh);
  assert.equal(rotated?.refreshToken, 'rotated');
  assert.equal(sessionFromToken({ accessToken: 'next-access' }, now, refresh), null);
  assert.equal(sessionFromToken({ expiresIn: 300, refreshToken: refresh }, now, null), null);
  assert.equal(phaseAfterRefreshFailure(true), 'expired');
  assert.equal(phaseAfterRefreshFailure(false), 'failed');
  assert.equal(JSON.stringify(kept).includes('id_token'), false);
});
