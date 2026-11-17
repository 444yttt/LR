// On-device storage for the manual refuel log and the economy unit preference. Not secret data, so it lives in
// AsyncStorage (one versioned JSON document, see fuelLog.ts), not in the secure store next to session tokens. Read and
// write failures leave the app usable: a failed read is an empty log, a failed write keeps the in-memory value.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { VEHICLES } from '../garageModel.ts';
import {
  FUEL_LOG_STORAGE_KEY, UNIT_STORAGE_KEY, logFor, parseFuelLog, parseUnit, serializeFuelLog, withEntry, withoutEntry,
  type EconomyUnit, type FuelLogMap, type RefuelEntry,
} from '../fuelLog.ts';

type FuelLogStore = {
  map: FuelLogMap;
  unit: EconomyUnit;
  /** Resolves once storage has been read (or failed to read). */
  ready: Promise<void>;
  current(): FuelLogMap;
  save(vehicle: number, entry: RefuelEntry): Promise<void>;
  remove(vehicle: number, entryId: string): Promise<void>;
  setUnit(unit: EconomyUnit): void;
};

const fallback: FuelLogStore = {
  map: {}, unit: 'perUnit', ready: Promise.resolve(), current: () => ({}), save: async () => undefined, remove: async () => undefined, setUnit: () => undefined,
};
const FuelLogContext = createContext<FuelLogStore>(fallback);

export function FuelLogProvider({ children }: { children: ReactNode }) {
  const [map, setMap] = useState<FuelLogMap>({});
  const [unit, setUnitState] = useState<EconomyUnit>('perUnit');
  const current = useRef(map);
  // A save before the first read finishes must not be overwritten by the read.
  const edited = useRef(false);
  const unitEdited = useRef(false);
  const alive = useRef(true);
  const [ready] = useState(() => Promise.all([
    AsyncStorage.getItem(FUEL_LOG_STORAGE_KEY).then(raw => parseFuelLog(raw)).catch(() => ({})),
    AsyncStorage.getItem(UNIT_STORAGE_KEY).then(raw => parseUnit(raw)).catch(() => 'perUnit' as const),
  ]).then(([stored, storedUnit]) => {
    if (!alive.current) return;
    if (!unitEdited.current && storedUnit !== 'perUnit') setUnitState(storedUnit);
    if (edited.current || !Object.keys(stored).length) return;
    current.current = stored;
    setMap(stored);
  }));
  useEffect(() => () => { alive.current = false; }, []);

  const write = useCallback(async (next: FuelLogMap) => {
    edited.current = true;
    current.current = next;
    setMap(next);
    try {
      await AsyncStorage.setItem(FUEL_LOG_STORAGE_KEY, serializeFuelLog(next));
    } catch {
      // Kept in memory for this session.
    }
  }, []);
  const save = useCallback(async (vehicle: number, entry: RefuelEntry) => {
    const info = VEHICLES[vehicle];
    if (info) await write(withEntry(current.current, info.id, entry));
  }, [write]);
  const remove = useCallback(async (vehicle: number, entryId: string) => {
    const info = VEHICLES[vehicle];
    if (info) await write(withoutEntry(current.current, info.id, entryId));
  }, [write]);
  const setUnit = useCallback((next: EconomyUnit) => {
    unitEdited.current = true;
    setUnitState(next);
    void AsyncStorage.setItem(UNIT_STORAGE_KEY, next).catch(() => undefined);
  }, []);

  const value = useMemo<FuelLogStore>(() => ({ map, unit, ready, current: () => current.current, save, remove, setUnit }),
    [map, unit, ready, save, remove, setUnit]);
  return <FuelLogContext.Provider value={value}>{children}</FuelLogContext.Provider>;
}

export const useFuelLogStore = () => useContext(FuelLogContext);

/** Stored log for one vehicle (by VEHICLES index), in log order; empty until entered. */
export function useFuelLog(vehicle: number): RefuelEntry[] {
  const { map } = useContext(FuelLogContext);
  const info = VEHICLES[vehicle];
  return info ? logFor(map, info.id) : [];
}
