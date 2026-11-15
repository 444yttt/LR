import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import * as Auth from 'expo-auth-session';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import { AppState } from 'react-native';
import {
  LIVE_REFRESH_TIMEOUT_MS, canRequest, initialLiveRefresh, liveRefreshReducer, refreshOutcome, retryAfterSeconds,
} from './liveRefresh.ts';
import { notifyIfDue } from './notifications';
import {
  AUTH_SCOPES, asPersistedSession, bootSession, clearSession, credentialsForRequest,
  loadSession, markSessionEstablished, phaseAfterRefreshFailure, refreshInMs, retryUnauthorized,
  saveSession, sessionFromToken, sessionWasEstablished,
  type PersistedSession, type SessionStore,
} from './session';
import { parseSnapshot, type Snapshot } from './telemetry';
import type { Phase } from './garageModel.ts';

WebBrowser.maybeCompleteAuthSession();

const api = httpsUrl(process.env.EXPO_PUBLIC_GARAGE_API_URL);
const issuer = httpsUrl(process.env.EXPO_PUBLIC_GARAGE_ISSUER);
const clientId = process.env.EXPO_PUBLIC_GARAGE_CLIENT_ID ?? '';
const resource = process.env.EXPO_PUBLIC_GARAGE_RESOURCE;
const redirectUri = Auth.makeRedirectUri({ scheme: 'garage-monitor', path: 'auth' });
const secureStore: SessionStore = {
  get: key => SecureStore.getItemAsync(key),
  set: (key, value) => SecureStore.setItemAsync(key, value),
  remove: key => SecureStore.deleteItemAsync(key),
};

function httpsUrl(input: string | undefined): string | null {
  try {
    const value = new URL(input ?? '');
    return value.protocol === 'https:' && !value.username && !value.password && !value.search && !value.hash
      ? value.toString().replace(/\/$/, '') : null;
  } catch { return null; }
}

type MemorySession = { token: string; expiresAt: number; refreshToken: string | null };

function remember(session: PersistedSession): MemorySession {
  return { token: session.accessToken, expiresAt: session.expiresAt, refreshToken: session.refreshToken };
}

export function useGarage() {
  const configured = Boolean(api && issuer && clientId);
  const [discovery, setDiscovery] = useState<Auth.DiscoveryDocument | null>(null);
  const [discoveryFailed, setDiscoveryFailed] = useState(false);
  const [discoveryAttempt, setDiscoveryAttempt] = useState(0);
  useEffect(() => {
    if (!issuer) return;
    let active = true;
    setDiscoveryFailed(false);
    Auth.fetchDiscoveryAsync(issuer).then(
      value => { if (active) setDiscovery(value); },
      () => { if (active) setDiscoveryFailed(true); },
    );
    return () => { active = false; };
  }, [discoveryAttempt]);
  const [request, , promptAsync] = Auth.useAuthRequest({
    clientId: clientId || 'unconfigured',
    redirectUri,
    scopes: [...AUTH_SCOPES],
    usePKCE: true,
    extraParams: resource ? { resource } : undefined,
  }, discovery);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [phase, setPhase] = useState<Phase>(configured ? 'loading' : 'unconfigured');
  const [notificationFailed, setNotificationFailed] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [refreshGeneration, setRefreshGeneration] = useState(0);
  const session = useRef<MemorySession | null>(null);
  const pendingRefresh = useRef<string | null>(null);
  const current = useRef<AbortController | null>(null);
  const signingIn = useRef(false);
  const renewing = useRef(false);
  const restored = useRef(!configured);
  const epoch = useRef(0);
  const [liveRefresh, dispatchLive] = useReducer(liveRefreshReducer, initialLiveRefresh);
  /** Mirrors `liveRefresh` for synchronous guards inside callbacks. */
  const liveRef = useRef(initialLiveRefresh);
  const live = useCallback((event: Parameters<typeof liveRefreshReducer>[1]) => {
    liveRef.current = liveRefreshReducer(liveRef.current, event);
    dispatchLive(event);
  }, []);
  const liveCurrent = useRef<AbortController | null>(null);
  /** Set when "Update now" had to renew the session first; the renewal then sends the POST instead of a GET. */
  const pendingLive = useRef(false);
  /** Set after a 401 already triggered one silent refresh in this cycle. */
  const authRetried = useRef(false);
  /** True once a stored session has successfully loaded vehicle data. */
  const established = useRef(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopRefreshTimer = () => {
    if (refreshTimer.current) {
      clearTimeout(refreshTimer.current);
      refreshTimer.current = null;
    }
  };

  const expire = useCallback(() => {
    current.current?.abort();
    liveCurrent.current?.abort();
    liveCurrent.current = null;
    pendingLive.current = false;
    authRetried.current = false;
    stopRefreshTimer();
    live({ type: 'reset' });
    session.current = null;
    pendingRefresh.current = null;
    setSnapshot(null);
    setLastSyncedAt(null);
    const nextPhase = phaseAfterRefreshFailure(established.current);
    established.current = false;
    setPhase(nextPhase);
    void clearSession(secureStore);
  }, [live]);

  const persist = useCallback(async (next: PersistedSession) => {
    session.current = remember(next);
    pendingRefresh.current = null;
    try { await saveSession(secureStore, next); } catch { /* this launch keeps the in-memory session */ }
  }, []);

  const armRefresh = useCallback((refreshToken: string) => {
    pendingRefresh.current = refreshToken;
    session.current = null;
    setPhase('loading');
    setRefreshGeneration(value => value + 1);
  }, []);

  const scheduleRenewal = useCallback((expiresAt: number, refreshToken: string | null) => {
    stopRefreshTimer();
    if (!refreshToken) return;
    const delay = refreshInMs(expiresAt, Date.now());
    if (delay == null) return;
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      const creds = session.current;
      if (creds?.refreshToken) armRefresh(creds.refreshToken);
    }, delay);
  }, [armRefresh]);

  const refresh = useCallback(async () => {
    const credentials = session.current;
    if (!api || !credentials || current.current || renewing.current) return;
    const decision = credentialsForRequest(asPersistedSession(credentials), Date.now());
    if (decision.type === 'refresh') { armRefresh(decision.refreshToken); return; }
    if (decision.type !== 'use') { expire(); return; }
    const controller = new AbortController();
    current.current = controller;
    setPhase('loading');
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 12000);
    try {
      const response = await fetch(api + '/v1/range-rover', {
        headers: { Authorization: 'Bearer ' + credentials.token, Accept: 'application/json' },
        signal: controller.signal, redirect: 'error',
      });
      if (current.current !== controller || controller.signal.aborted) return;
      if (response.status === 401) {
        const refreshToken = session.current?.refreshToken ?? pendingRefresh.current;
        if (retryUnauthorized(refreshToken, authRetried.current) === 'refresh' && refreshToken) {
          authRetried.current = true;
          armRefresh(refreshToken);
          return;
        }
        expire();
        return;
      }
      if (!response.ok) throw new Error('Refresh failed');
      const next = parseSnapshot(await response.json());
      if (current.current !== controller || controller.signal.aborted) return;
      setSnapshot(next);
      setLastSyncedAt(Date.now());
      setPhase('ready');
      authRetried.current = false;
      if (!established.current) {
        established.current = true;
        void markSessionEstablished(secureStore).catch(() => { /* next successful fetch retries */ });
      }
      notifyIfDue(next).then(() => setNotificationFailed(false), () => setNotificationFailed(true));
    } catch {
      if (current.current === controller && (timedOut || !controller.signal.aborted)) setPhase('failed');
    } finally {
      clearTimeout(timeout);
      if (current.current === controller) current.current = null;
    }
  }, [armRefresh, expire]);

  /**
   * "Update now": asks the gateway to re-read the vehicle (read-only, POST /v1/range-rover/refresh). Unlike `refresh`,
   * it never moves `phase` to loading or wipes values on failure; progress lives in `liveRefresh`. When the gateway is
   * known to be rate limited, it falls back to the plain GET so the latest stored report still arrives.
   */
  const requestLive = useCallback(async (resumed: boolean) => {
    const credentials = session.current;
    if (!api || !credentials || liveCurrent.current || current.current || renewing.current) return;
    if (!resumed && !canRequest(liveRef.current, Date.now())) {
      if (liveRef.current.state !== 'requesting') await refresh();
      return;
    }
    const decision = credentialsForRequest(asPersistedSession(credentials), Date.now());
    if (decision.type === 'refresh') {
      pendingLive.current = true;
      live({ type: 'start', now: Date.now() });
      armRefresh(decision.refreshToken);
      return;
    }
    if (decision.type !== 'use') { expire(); return; }
    const started = epoch.current;
    const controller = new AbortController();
    liveCurrent.current = controller;
    live({ type: 'start', now: Date.now() });
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, LIVE_REFRESH_TIMEOUT_MS);
    const stale = () => started !== epoch.current || liveCurrent.current !== controller || (controller.signal.aborted && !timedOut);
    let fallback = false;
    try {
      const response = await fetch(api + '/v1/range-rover/refresh', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + credentials.token, Accept: 'application/json' },
        signal: controller.signal, redirect: 'error',
      });
      if (stale()) return;
      const outcome = refreshOutcome(response.status);
      if (outcome === 'expired') {
        const refreshToken = session.current?.refreshToken ?? pendingRefresh.current;
        if (retryUnauthorized(refreshToken, authRetried.current) === 'refresh' && refreshToken) {
          authRetried.current = true;
          pendingLive.current = true;
          armRefresh(refreshToken);
          return;
        }
        expire();
        return;
      }
      if (outcome === 'rateLimited') {
        const body: unknown = await response.json().catch(() => null);
        if (stale()) return;
        live({ type: 'rateLimited', now: Date.now(), retryAfterSeconds: retryAfterSeconds(response.headers.get('Retry-After'), body, Date.now()) });
        fallback = true;
      } else {
        if (outcome !== 'success') throw new Error('Refresh failed');
        const next = parseSnapshot(await response.json());
        if (stale()) return;
        setSnapshot(next);
        setLastSyncedAt(Date.now());
        setPhase('ready');
        authRetried.current = false;
        if (!established.current) {
          established.current = true;
          void markSessionEstablished(secureStore).catch(() => { /* next successful fetch retries */ });
        }
        live({ type: 'success', now: Date.now() });
        notifyIfDue(next).then(() => setNotificationFailed(false), () => setNotificationFailed(true));
      }
    } catch {
      // Network error, timeout, 502/503 or an unreadable body: values and phase stay as they were.
      if (!stale()) {
        live({ type: 'failed', now: Date.now() });
        // After a session renewal the phase is 'loading'; the GET settles it with the stored report.
        fallback = resumed;
      }
    } finally {
      clearTimeout(timeout);
      if (liveCurrent.current === controller) liveCurrent.current = null;
    }
    // Rate limited: the vehicle was read recently, so show what the gateway already stored.
    if (fallback && started === epoch.current) await refresh();
  }, [armRefresh, expire, live, refresh]);
  const refreshNow = useCallback(() => requestLive(false), [requestLive]);

  const renew = useCallback(async (refreshToken: string) => {
    if (!discovery || renewing.current) return;
    renewing.current = true;
    const started = epoch.current;
    setPhase('loading');
    try {
      const token = await Auth.refreshAsync({
        clientId, refreshToken,
        extraParams: resource ? { resource } : undefined,
      }, discovery);
      if (started !== epoch.current) return;
      const next = sessionFromToken(token, Date.now(), refreshToken);
      if (!next) throw new Error('Invalid session');
      await persist(next);
      scheduleRenewal(next.expiresAt, next.refreshToken);
    } catch {
      if (started === epoch.current) expire();
      return;
    } finally {
      renewing.current = false;
    }
    if (started !== epoch.current) return;
    if (pendingLive.current) {
      pendingLive.current = false;
      await requestLive(true);
    } else await refresh();
  }, [discovery, persist, refresh, requestLive, expire, scheduleRenewal]);

  useEffect(() => {
    if (!configured) return;
    let active = true;
    Promise.all([loadSession(secureStore), sessionWasEstablished(secureStore)]).then(([stored, wasEstablished]) => {
      if (!active) return;
      restored.current = true;
      established.current = wasEstablished;
      const boot = bootSession(stored, Date.now());
      if (boot.type === 'use') {
        session.current = remember(boot.session);
        scheduleRenewal(boot.session.expiresAt, boot.session.refreshToken);
        void refresh();
      } else if (boot.type === 'refresh') {
        armRefresh(boot.refreshToken);
      } else if (boot.type === 'expired') {
        established.current = false;
        void clearSession(secureStore);
        setPhase(phaseAfterRefreshFailure(wasEstablished));
      } else setPhase('signedOut');
    }).catch(() => {
      if (!active) return;
      restored.current = true;
      setPhase('signedOut');
    });
    return () => { active = false; };
  }, [configured, refresh, armRefresh, scheduleRenewal]);

  useEffect(() => {
    const refreshToken = pendingRefresh.current;
    if (!restored.current || !discovery || !refreshToken || renewing.current) return;
    void renew(refreshToken);
  }, [discovery, refreshGeneration, renew]);

  useEffect(() => {
    if (!discoveryFailed || !pendingRefresh.current || session.current) return;
    setPhase('failed');
    if (pendingLive.current) {
      pendingLive.current = false;
      live({ type: 'failed', now: Date.now() });
    }
  }, [discoveryFailed, refreshGeneration, live]);

  const signIn = useCallback(async () => {
    if (!configured || !discovery || !request?.codeVerifier || signingIn.current || !restored.current) return;
    signingIn.current = true;
    setPhase('signingIn');
    try {
      const result = await promptAsync();
      if (result.type !== 'success' || !result.params.code) {
        setPhase(result.type === 'error' ? 'failed' : 'signedOut');
        return;
      }
      const started = epoch.current;
      const token = await Auth.exchangeCodeAsync({
        clientId, code: result.params.code, redirectUri,
        extraParams: { code_verifier: request.codeVerifier, ...(resource ? { resource } : {}) },
      }, discovery);
      const next = sessionFromToken(token, Date.now(), null);
      if (!next) throw new Error('Invalid session');
      if (started !== epoch.current) return;
      await persist(next);
      scheduleRenewal(next.expiresAt, next.refreshToken);
      await refresh();
    } catch { setPhase('failed'); }
    finally { signingIn.current = false; }
  }, [configured, discovery, request, promptAsync, refresh, persist, scheduleRenewal]);

  /** Forgets the Garage session on this device only. JLR access on the collector is untouched. */
  const signOut = useCallback(async () => {
    epoch.current += 1;
    current.current?.abort();
    current.current = null;
    liveCurrent.current?.abort();
    liveCurrent.current = null;
    pendingLive.current = false;
    authRetried.current = false;
    established.current = false;
    stopRefreshTimer();
    live({ type: 'reset' });
    session.current = null;
    pendingRefresh.current = null;
    setSnapshot(null);
    setLastSyncedAt(null);
    setPhase(configured ? 'signedOut' : 'unconfigured');
    try { await clearSession(secureStore); } catch { /* nothing else to clear */ }
  }, [configured, live]);

  useEffect(() => {
    const listener = AppState.addEventListener('change', value => { if (value === 'active') void refresh(); });
    return () => {
      listener.remove();
      current.current?.abort();
      liveCurrent.current?.abort();
      stopRefreshTimer();
    };
  }, [refresh]);

  return {
    snapshot, phase, refresh, refreshNow, liveRefresh, signIn, signOut, notificationFailed, discoveryFailed, lastSyncedAt,
    retryDiscovery: () => setDiscoveryAttempt(value => value + 1),
    hasSession: session.current !== null,
    canSignIn: Boolean(discovery && request),
  };
}

export type GarageData = ReturnType<typeof useGarage>;
