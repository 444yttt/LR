export const AUTH_SCOPES = ['openid', 'email', 'offline_access'] as const;

export type PersistedSession = {
  accessToken: string;
  expiresAt: number;
  refreshToken: string | null;
};

export type SessionStore = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
};

const accessKey = 'garage.session.access';
const expiryKey = 'garage.session.expiry';
const refreshKey = 'garage.session.refresh';
const establishedKey = 'garage.session.established';
export const expirySkewMs = 60_000;

export async function saveSession(store: SessionStore, session: PersistedSession): Promise<void> {
  await store.set(accessKey, session.accessToken);
  await store.set(expiryKey, String(session.expiresAt));
  if (session.refreshToken) await store.set(refreshKey, session.refreshToken);
  else await store.remove(refreshKey);
}

export async function loadSession(store: SessionStore): Promise<PersistedSession | null> {
  const [accessToken, expiry, refreshToken] = await Promise.all([
    store.get(accessKey), store.get(expiryKey), store.get(refreshKey),
  ]);
  if (!accessToken && !refreshToken) return null;
  const expiresAt = Number(expiry);
  return {
    accessToken: accessToken ?? '',
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0,
    refreshToken: refreshToken || null,
  };
}

export async function sessionWasEstablished(store: SessionStore): Promise<boolean> {
  return (await store.get(establishedKey)) === '1';
}

export async function markSessionEstablished(store: SessionStore): Promise<void> {
  await store.set(establishedKey, '1');
}

export async function clearSession(store: SessionStore): Promise<void> {
  await store.remove(accessKey);
  await store.remove(expiryKey);
  await store.remove(refreshKey);
  await store.remove(establishedKey);
}

export type BootAction =
  | { type: 'signedOut' }
  | { type: 'use'; session: PersistedSession }
  | { type: 'refresh'; refreshToken: string }
  | { type: 'expired' };

export function bootSession(session: PersistedSession | null, now: number): BootAction {
  if (!session || (!session.accessToken && !session.refreshToken)) return { type: 'signedOut' };
  if (session.accessToken && session.expiresAt > now + expirySkewMs) return { type: 'use', session };
  if (session.refreshToken) return { type: 'refresh', refreshToken: session.refreshToken };
  return { type: 'expired' };
}

/** Same decision as launch, used before a gateway request so a nearly-expired token is renewed first. */
export function credentialsForRequest(session: PersistedSession, now: number): BootAction {
  return bootSession(session, now);
}

/**
 * After a 401, try one silent refresh when a refresh token is still on hand.
 * A second 401 after that refresh is treated as a dead session.
 */
export function retryUnauthorized(refreshToken: string | null, alreadyTried: boolean): 'refresh' | 'giveUp' {
  if (!alreadyTried && refreshToken) return 'refresh';
  return 'giveUp';
}

/** Delay until a proactive refresh, or `null` when `expiresAt` is not a finite time. */
export function refreshInMs(expiresAt: number, now: number): number | null {
  if (!Number.isFinite(expiresAt)) return null;
  return Math.max(0, expiresAt - expirySkewMs - now);
}

export function sessionFromToken(
  token: { accessToken?: string; expiresIn?: number; refreshToken?: string | null },
  now: number,
  previousRefresh: string | null,
): PersistedSession | null {
  if (!token.accessToken || !token.expiresIn || token.expiresIn <= 0) return null;
  return {
    accessToken: token.accessToken,
    expiresAt: now + token.expiresIn * 1000,
    refreshToken: token.refreshToken || previousRefresh,
  };
}

/** "Sign-in expired" only after a session that previously loaded vehicle data. First-time failures stay "Sign-in failed". */
export function phaseAfterRefreshFailure(established: boolean): 'expired' | 'failed' {
  return established ? 'expired' : 'failed';
}

export function asPersistedSession(session: { token: string; expiresAt: number; refreshToken: string | null }): PersistedSession {
  return { accessToken: session.token, expiresAt: session.expiresAt, refreshToken: session.refreshToken };
}
