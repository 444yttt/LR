// On-device storage for user-entered vehicle specs. Not secret data, so it lives in AsyncStorage (one versioned JSON
// document, see vehicleSpecs.ts), not in the secure store next to session tokens. Read and write failures leave the
// app usable: a failed read is empty specs, a failed write keeps the in-memory value for this session.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { VEHICLES } from '../garageModel.ts';
import { SPECS_STORAGE_KEY, emptySpecs, parseSpecs, serializeSpecs, specsFor, withSpecs, type SpecsMap, type VehicleSpecs } from '../vehicleSpecs.ts';

type SpecsStore = {
  map: SpecsMap;
  /** Resolves once storage has been read (or failed to read). */
  ready: Promise<void>;
  /** Latest map, including a read that finished after this render. */
  current(): SpecsMap;
  save(vehicle: number, specs: VehicleSpecs): Promise<void>;
};

const fallback: SpecsStore = { map: {}, ready: Promise.resolve(), current: () => ({}), save: async () => undefined };
const SpecsContext = createContext<SpecsStore>(fallback);

export function SpecsProvider({ children }: { children: ReactNode }) {
  const [map, setMap] = useState<SpecsMap>({});
  const current = useRef(map);
  // A save before the first read finishes must not be overwritten by the read.
  const edited = useRef(false);
  const alive = useRef(true);
  const [ready] = useState(() => AsyncStorage.getItem(SPECS_STORAGE_KEY)
    .then(raw => parseSpecs(raw))
    .catch(() => ({}))
    .then(stored => {
      // Nothing stored (the usual first launch) changes nothing, so it causes no render.
      if (!alive.current || edited.current || !Object.keys(stored).length) return;
      current.current = stored;
      setMap(stored);
    }));
  useEffect(() => () => { alive.current = false; }, []);

  const save = useCallback(async (vehicle: number, specs: VehicleSpecs) => {
    const info = VEHICLES[vehicle];
    if (!info) return;
    edited.current = true;
    const next = withSpecs(current.current, info.id, specs);
    current.current = next;
    setMap(next);
    try {
      await AsyncStorage.setItem(SPECS_STORAGE_KEY, serializeSpecs(next));
    } catch {
      // Kept in memory for this session; nothing sensitive to report.
    }
  }, []);

  const value = useMemo<SpecsStore>(() => ({ map, ready, current: () => current.current, save }), [map, ready, save]);
  return <SpecsContext.Provider value={value}>{children}</SpecsContext.Provider>;
}

export const useSpecsStore = () => useContext(SpecsContext);

/** Stored specs for one vehicle (by VEHICLES index); empty until entered. */
export function useSpecs(vehicle: number): VehicleSpecs {
  const { map } = useContext(SpecsContext);
  const info = VEHICLES[vehicle];
  return info ? specsFor(map, info.id) : emptySpecs;
}
