import { useCallback, useEffect, useRef, useState } from 'react';
import * as Auth from 'expo-auth-session';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import { AppState } from 'react-native';
import { notifyIfDue } from './notifications';
import {
  bootSession, clearSession, loadSession, phaseAfterRefreshFailure, saveSession, sessionFromToken,
  type PersistedSession, type SessionStore,
} from './session';
import { parseSnapshot, type Snapshot } from './telemetry';

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
type Phase = 'unconfigured' | 'signedOut' | 'signingIn' | 'loading' | 'ready' | 'failed' | 'expired';

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
    scopes: ['openid'],
    usePKCE: true,
    extraParams: resource ? { resource } : undefined,
  }, discovery);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [phase, setPhase] = useState<Phase>(configured ? 'loading' : 'unconfigured');
  const [notificationFailed, setNotificationFailed] = useState(false);
  const [refreshGeneration, setRefreshGeneration] = useState(0);
  const session = useRef<MemorySession | null>(null);
  const pendingRefresh = useRef<string | null>(null);
  const current = useRef<AbortController | null>(null);
  const signingIn = useRef(false);
  const renewing = useRef(false);
  const restored = useRef(!configured);

  const expire = useCallback(() => {
    current.current?.abort();
    session.current = null;
    pendingRefresh.current = null;
    setSnapshot(null);
    setPhase(phaseAfterRefreshFailure());
    void clearSession(secureStore);
  }, []);

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

  const refresh = useCallback(async () => {
    const credentials = session.current;
    if (!api || !credentials || current.current || renewing.current) return;
    if (credentials.expiresAt <= Date.now()) {
      if (credentials.refreshToken) { armRefresh(credentials.refreshToken); return; }
      expire();
      return;
    }
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
      if (response.status === 401) { expire(); return; }
      if (!response.ok) throw new Error('Refresh failed');
      const next = parseSnapshot(await response.json());
      if (current.current !== controller || controller.signal.aborted) return;
      setSnapshot(next);
      setPhase('ready');
      notifyIfDue(next).then(() => setNotificationFailed(false), () => setNotificationFailed(true));
    } catch {
      if (current.current === controller && (timedOut || !controller.signal.aborted)) setPhase('failed');
    } finally {
      clearTimeout(timeout);
      if (current.current === controller) current.current = null;
    }
  }, [armRefresh, expire]);

  const renew = useCallback(async (refreshToken: string) => {
    if (!discovery || renewing.current) return;
    renewing.current = true;
    setPhase('loading');
    try {
      const token = await Auth.refreshAsync({
        clientId, refreshToken,
        extraParams: resource ? { resource } : undefined,
      }, discovery);
      const next = sessionFromToken(token, Date.now(), refreshToken);
      if (!next) throw new Error('Invalid session');
      await persist(next);
    } catch {
      expire();
      return;
    } finally {
      renewing.current = false;
    }
    await refresh();
  }, [discovery, persist, refresh, expire]);

  useEffect(() => {
    if (!configured) return;
    let active = true;
    loadSession(secureStore).then(stored => {
      if (!active) return;
      restored.current = true;
      const boot = bootSession(stored, Date.now());
      if (boot.type === 'use') {
        session.current = remember(boot.session);
        void refresh();
      } else if (boot.type === 'refresh') {
        armRefresh(boot.refreshToken);
      } else if (boot.type === 'expired') {
        void clearSession(secureStore);
        setPhase(phaseAfterRefreshFailure());
      } else setPhase('signedOut');
    }).catch(() => {
      if (!active) return;
      restored.current = true;
      setPhase('signedOut');
    });
    return () => { active = false; };
  }, [configured, refresh, armRefresh]);

  useEffect(() => {
    const refreshToken = pendingRefresh.current;
    if (!restored.current || !discovery || !refreshToken || renewing.current) return;
    void renew(refreshToken);
  }, [discovery, refreshGeneration, renew]);

  useEffect(() => {
    if (discoveryFailed && pendingRefresh.current && !session.current) setPhase('failed');
  }, [discoveryFailed, refreshGeneration]);

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
      const token = await Auth.exchangeCodeAsync({
        clientId, code: result.params.code, redirectUri,
        extraParams: { code_verifier: request.codeVerifier, ...(resource ? { resource } : {}) },
      }, discovery);
      const next = sessionFromToken(token, Date.now(), null);
      if (!next) throw new Error('Invalid session');
      await persist(next);
      await refresh();
    } catch { setPhase('failed'); }
    finally { signingIn.current = false; }
  }, [configured, discovery, request, promptAsync, refresh, persist]);

  useEffect(() => {
    const listener = AppState.addEventListener('change', value => { if (value === 'active') void refresh(); });
    return () => { listener.remove(); current.current?.abort(); };
  }, [refresh]);

  return {
    snapshot, phase, refresh, signIn, notificationFailed, discoveryFailed,
    retryDiscovery: () => setDiscoveryAttempt(value => value + 1),
    hasSession: session.current !== null,
    canSignIn: Boolean(discovery && request),
  };
}
