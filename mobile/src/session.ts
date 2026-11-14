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
const expirySkewMs = 60_000;

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

export async function clearSession(store: SessionStore): Promise<void> {
  await store.remove(accessKey);
  await store.remove(expiryKey);
  await store.remove(refreshKey);
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

export function phaseAfterRefreshFailure(): 'expired' {
  return 'expired';
}
