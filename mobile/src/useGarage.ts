import { useCallback, useEffect, useRef, useState } from 'react';
import * as Auth from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { AppState } from 'react-native';
import { notifyIfDue } from './notifications';
import { parseSnapshot, type Snapshot } from './telemetry';

WebBrowser.maybeCompleteAuthSession();

const api = httpsUrl(process.env.EXPO_PUBLIC_GARAGE_API_URL);
const issuer = httpsUrl(process.env.EXPO_PUBLIC_GARAGE_ISSUER);
const clientId = process.env.EXPO_PUBLIC_GARAGE_CLIENT_ID ?? '';
const resource = process.env.EXPO_PUBLIC_GARAGE_RESOURCE;
const redirectUri = Auth.makeRedirectUri({ scheme: 'garage-monitor', path: 'auth' });

function httpsUrl(input: string | undefined): string | null {
  try {
    const value = new URL(input ?? '');
    return value.protocol === 'https:' && !value.username && !value.password && !value.search && !value.hash
      ? value.toString().replace(/\/$/, '') : null;
  } catch { return null; }
}

type Session = { token: string; expiresAt: number };
type Phase = 'unconfigured' | 'signedOut' | 'signingIn' | 'loading' | 'ready' | 'failed' | 'expired';

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
  const [phase, setPhase] = useState<Phase>(configured ? 'signedOut' : 'unconfigured');
  const [notificationFailed, setNotificationFailed] = useState(false);
  const session = useRef<Session | null>(null);
  const current = useRef<AbortController | null>(null);
  const signingIn = useRef(false);

  const expire = useCallback(() => {
    current.current?.abort();
    session.current = null;
    setSnapshot(null);
    setPhase('expired');
  }, []);

  const refresh = useCallback(async () => {
    const credentials = session.current;
    if (!api || !credentials || current.current) return;
    if (credentials.expiresAt <= Date.now()) { expire(); return; }
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
  }, [expire]);

  const signIn = useCallback(async () => {
    if (!configured || !discovery || !request?.codeVerifier || signingIn.current) return;
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
      if (!token.accessToken || !token.expiresIn || token.expiresIn <= 0) throw new Error('Invalid session');
      session.current = { token: token.accessToken, expiresAt: Date.now() + token.expiresIn * 1000 };
      await refresh();
    } catch { setPhase('failed'); }
    finally { signingIn.current = false; }
  }, [configured, discovery, request, promptAsync, refresh]);

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
