import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { dueThreshold, type Snapshot } from './telemetry';

const enabledKey = 'garage.inactivity.enabled';
const sentKey = 'garage.inactivity.sent';
let queue: Promise<void> = Promise.resolve();

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false,
  }),
});

export async function enableInactivityAlerts(): Promise<boolean> {
  const permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) return false;
  await SecureStore.setItemAsync(enabledKey, 'yes');
  return true;
}

export function notifyIfDue(snapshot: Snapshot): Promise<void> {
  const next = queue.then(async () => {
    const days = dueThreshold(snapshot, Date.now());
    if (!days || (await SecureStore.getItemAsync(enabledKey)) !== 'yes') return;
    if (!(await Notifications.getPermissionsAsync()).granted) return;
    const key = [snapshot.lastDriveAt, days].join('/');
    if ((await SecureStore.getItemAsync(sentKey)) === key) return;
    await Notifications.scheduleNotificationAsync({
      content: { title: 'Garage Monitor', body: `Range Rover: at least ${days} days since the last confirmed drive.` },
      trigger: null,
    });
    await SecureStore.setItemAsync(sentKey, key);
  });
  queue = next.catch(() => undefined);
  return next;
}
