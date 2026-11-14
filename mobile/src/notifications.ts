import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { alertThreshold, inactivityLink, parseAlertPrefs, serializeThresholds, type AlertPrefs, type PermissionState } from './garageModel.ts';
import { dueThreshold, type Snapshot } from './telemetry.ts';

const enabledKey = 'garage.inactivity.enabled';
const thresholdsKey = 'garage.inactivity.thresholds';
const sentKey = 'garage.inactivity.sent';
let queue: Promise<void> = Promise.resolve();

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false,
  }),
});

export async function permissionState(): Promise<PermissionState> {
  try {
    const permission = await Notifications.getPermissionsAsync();
    if (permission.granted) return 'granted';
    return permission.canAskAgain ? 'undetermined' : 'denied';
  } catch { return 'unknown'; }
}

export async function loadAlertPrefs(): Promise<AlertPrefs> {
  const [enabled, thresholds] = await Promise.all([SecureStore.getItemAsync(enabledKey), SecureStore.getItemAsync(thresholdsKey)]);
  return parseAlertPrefs(enabled, thresholds);
}

/** Saves toggles. Turning alerts on asks iOS for permission first and returns false when it is refused. */
export async function saveAlertPrefs(prefs: AlertPrefs): Promise<boolean> {
  if (prefs.enabled) {
    const permission = await Notifications.requestPermissionsAsync();
    if (!permission.granted) return false;
  }
  await SecureStore.setItemAsync(thresholdsKey, serializeThresholds(prefs));
  if (prefs.enabled) await SecureStore.setItemAsync(enabledKey, 'yes');
  else await SecureStore.deleteItemAsync(enabledKey);
  return true;
}

export async function enableInactivityAlerts(): Promise<boolean> {
  return saveAlertPrefs({ ...(await loadAlertPrefs()), enabled: true });
}

export function notifyIfDue(snapshot: Snapshot): Promise<void> {
  const next = queue.then(async () => {
    const days = alertThreshold(dueThreshold(snapshot, Date.now()), await loadAlertPrefs());
    if (!days) return;
    if (!(await Notifications.getPermissionsAsync()).granted) return;
    const key = [snapshot.lastDriveAt, days].join('/');
    if ((await SecureStore.getItemAsync(sentKey)) === key) return;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Nostos',
        body: `Range Rover: at least ${days} days since the last confirmed drive.`,
        data: { url: inactivityLink },
      },
      trigger: null,
    });
    await SecureStore.setItemAsync(sentKey, key);
  });
  queue = next.catch(() => undefined);
  return next;
}
