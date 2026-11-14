import { useEffect } from 'react';
import { Linking } from 'react-native';
import * as Notifications from 'expo-notifications';
import { routeFromUrl, stackFor } from './garageModel.ts';
import { useNav } from './ui/stack';

/**
 * Opens garage-monitor:// links from iOS and from tapped local notifications (content.data.url).
 * The OAuth redirect (garage-monitor://auth) is ignored here; expo-auth-session handles it.
 */
export function DeepLinks() {
  const nav = useNav();
  useEffect(() => {
    let active = true;
    const open = (url: unknown) => {
      const route = typeof url === 'string' ? routeFromUrl(url) : null;
      if (active && route) nav.reset(stackFor(route));
    };
    void Linking.getInitialURL().then(open, () => undefined);
    void Notifications.getLastNotificationResponseAsync().then(response => {
      if (response) open(response.notification.request.content.data?.url);
    }, () => undefined);
    const link = Linking.addEventListener('url', event => open(event.url));
    const tap = Notifications.addNotificationResponseReceivedListener(response => open(response.notification.request.content.data?.url));
    return () => { active = false; link.remove(); tap.remove(); };
  }, []);
  return null;
}
