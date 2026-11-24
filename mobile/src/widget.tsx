// Keeps the iOS widget's shared snapshot in step with the live Garage session (see widgetSnapshot.ts for the contract).
// Rendered only by the production entry (App.tsx `Live`); demo builds never write to the widget.
import { useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ExtensionStorage } from '@bacons/apple-targets';
import { VEHICLES, type VehicleId } from './garageModel.ts';
import { useData } from './ui/parts';
import { useNav } from './ui/stack';
import {
  WIDGET_APP_GROUP, WIDGET_SELECTION_KEY, applyWidgetAction, isVehicleId, widgetAction, widgetContentKey, type WidgetStorage,
} from './widgetSnapshot.ts';

const shared = new ExtensionStorage(WIDGET_APP_GROUP);

/** App Group UserDefaults through @bacons/apple-targets. Strings only; the widget decodes the JSON itself. */
export const widgetStorage: WidgetStorage = {
  set: (key, value) => shared.set(key, value),
  remove: key => shared.remove(key),
  reloadWidget: () => ExtensionStorage.reloadWidget(),
};

/** The vehicle on the bottom of the navigation stack (the one the user opened), if any. */
function openedVehicle(routes: readonly { route: { name: string; vehicle?: number } }[]): VehicleId | null {
  for (const { route } of routes) {
    if (typeof route.vehicle === 'number') return VEHICLES[route.vehicle]?.id ?? null;
  }
  return null;
}

/**
 * Writes the widget snapshot after every change of session phase or vehicle reports (successful refresh, failed
 * refresh over earlier values, launch restore, expiry) and clears it on sign-out. The last opened vehicle becomes the
 * widget's default and is remembered in AsyncStorage. Render inside the Garage's navigation stack.
 */
export function WidgetSync({ storage = widgetStorage }: { storage?: WidgetStorage }) {
  const data = useData();
  const nav = useNav();
  /** undefined until the stored choice has been read, so the first write already uses it. */
  const [selected, setSelected] = useState<VehicleId | null | undefined>(undefined);
  const written = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    const settle = (value: VehicleId | null) => { if (active) setSelected(current => current === undefined ? value : current); };
    AsyncStorage.getItem(WIDGET_SELECTION_KEY).then(value => settle(isVehicleId(value) ? value : null), () => settle(null));
    return () => { active = false; };
  }, []);

  const opened = openedVehicle(nav.entries);
  useEffect(() => {
    if (!opened) return;
    setSelected(opened);
    void AsyncStorage.setItem(WIDGET_SELECTION_KEY, opened).catch(() => undefined);
  }, [opened]);

  useEffect(() => {
    if (selected === undefined) return;
    const action = widgetAction({ phase: data.phase, snapshots: data.snapshots, selectedVehicleId: selected, now: Date.now() });
    const key = widgetContentKey(action);
    if (action.type === 'keep' || key === written.current) return;
    try {
      applyWidgetAction(storage, action);
      written.current = key;
    } catch { /* the widget keeps its previous snapshot; the next change retries */ }
  }, [data.phase, data.snapshots, selected, storage]);

  return null;
}
