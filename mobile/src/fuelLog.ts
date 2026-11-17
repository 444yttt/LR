// Manual refuel / recharge log and the economy it supports (classic full-tank method). Pure: no React Native imports,
// so parsing, normalising and the computation run under `node --test`. Storage lives in ui/fuelLog.tsx (AsyncStorage).
//
// Everything here is what the owner typed on this device. Nothing is defaulted from telemetry, and no number is
// invented: with fewer than two full-tank entries there is no economy from the log.
import type { VehicleId, VehicleInfo } from './garageModel.ts';
import type { Snapshot } from './telemetry.ts';
import { VEHICLE_IDS } from './vehicleSpecs.ts';

/** What a vehicle runs on. Fuel: litres and km/L. Electric: kWh and km/kWh. */
export type Energy = 'fuel' | 'electric';

/**
 * Energy of a vehicle: electric when the vehicle table says so, or when its report has a charge level and no fuel
 * level (an EV); otherwise fuel.
 */
export function energyOf(info: Pick<VehicleInfo, 'energy'>, snapshot: Pick<Snapshot, 'fuelPercent' | 'socPercent'> | null): Energy {
  if (info.energy === 'electric') return 'electric';
  return snapshot && snapshot.fuelPercent === null && snapshot.socPercent !== null ? 'electric' : 'fuel';
}

export const amountUnit = (energy: Energy) => energy === 'electric' ? 'kWh' : 'L';

export type RefuelEntry = {
  /** Stable id for edits and list keys. */
  id: string;
  /** Calendar day the owner filled up, YYYY-MM-DD. */
  date: string;
  /** Litres (fuel) or kWh (electric) added. */
  amount: number;
  /** Odometer at the fill, km. */
  odometerKm: number;
  /** Optional total paid for this fill (¥). Null when not entered. */
  price: number | null;
  /** Filled to full. Only full fills close a segment; partial fills count toward the next full one. */
  full: boolean;
};

/** Log per vehicle, keyed by the stable VehicleId (never by VEHICLES index). Each list is in log order (see sortLog). */
export type FuelLogMap = Partial<Record<VehicleId, RefuelEntry[]>>;

export const FUEL_LOG_STORAGE_KEY = 'nostos.fuelLog';
export const FUEL_LOG_VERSION = 1;

export const logLimits = { entries: 500, amountMax: 500, odometerMax: 2_000_000, priceMax: 10_000_000, id: 40 } as const;

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar day as YYYY-MM-DD, else null. */
export function cleanDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = DAY.exec(value.trim());
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d && y >= 1990 ? value.trim() : null;
}

function cleanNumber(value: unknown, min: number, max: number, exclusiveMin = false): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (exclusiveMin ? value <= min : value < min) return null;
  return value <= max ? Math.round(value * 100) / 100 : null;
}

/** A well-formed entry from anything, or null when a required field is missing or out of range. */
export function normalizeEntry(value: unknown): RefuelEntry | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  const id = typeof input.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(input.id) ? input.id : null;
  const date = cleanDate(input.date);
  const amount = cleanNumber(input.amount, 0, logLimits.amountMax, true);
  const odometerKm = cleanNumber(input.odometerKm, 0, logLimits.odometerMax);
  if (!id || !date || amount === null || odometerKm === null) return null;
  const price = input.price === null || input.price === undefined ? null : cleanNumber(input.price, 0, logLimits.priceMax);
  return { id, date, amount, odometerKm, price, full: input.full !== false };
}

/** Log order: by day, then odometer (several fills on one day), then id. */
export function sortLog(entries: readonly RefuelEntry[]): RefuelEntry[] {
  return [...entries].sort((a, b) => a.date.localeCompare(b.date) || a.odometerKm - b.odometerKm || a.id.localeCompare(b.id));
}

function normalizeList(value: unknown): RefuelEntry[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: RefuelEntry[] = [];
  for (const item of value) {
    const entry = normalizeEntry(item);
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push(entry);
  }
  return sortLog(out).slice(-logLimits.entries);
}

/**
 * Stored document → log map. Missing, corrupt, wrong-version or wrong-shape storage is an empty log, never a throw.
 * Unknown vehicle ids and malformed entries are dropped; vehicles with no entries are left out.
 */
export function parseFuelLog(raw: string | null | undefined): FuelLogMap {
  if (!raw) return {};
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!doc || typeof doc !== 'object' || (doc as { version?: unknown }).version !== FUEL_LOG_VERSION) return {};
  const vehicles = (doc as { vehicles?: unknown }).vehicles;
  if (!vehicles || typeof vehicles !== 'object' || Array.isArray(vehicles)) return {};
  const map: FuelLogMap = {};
  for (const id of VEHICLE_IDS) {
    const list = normalizeList((vehicles as Record<string, unknown>)[id]);
    if (list.length) map[id] = list;
  }
  return map;
}

/** Log map → the stored JSON document (versioned). Empty vehicles are omitted. */
export function serializeFuelLog(map: FuelLogMap): string {
  const vehicles: FuelLogMap = {};
  for (const id of VEHICLE_IDS) {
    const list = normalizeList(map[id]);
    if (list.length) vehicles[id] = list;
  }
  return JSON.stringify({ version: FUEL_LOG_VERSION, vehicles });
}

export const logFor = (map: FuelLogMap, id: VehicleId): RefuelEntry[] => map[id] ?? [];

/** The map with one entry added, or replaced when its id already exists. Invalid entries leave the map unchanged. */
export function withEntry(map: FuelLogMap, id: VehicleId, entry: RefuelEntry): FuelLogMap {
  const clean = normalizeEntry(entry);
  if (!clean) return map;
  const list = logFor(map, id).filter(item => item.id !== clean.id);
  return { ...map, [id]: sortLog([...list, clean]).slice(-logLimits.entries) };
}

/** The map without one entry; a vehicle left with no entries is removed. */
export function withoutEntry(map: FuelLogMap, id: VehicleId, entryId: string): FuelLogMap {
  const next: FuelLogMap = { ...map };
  const list = logFor(map, id).filter(item => item.id !== entryId);
  if (list.length) next[id] = list;
  else delete next[id];
  return next;
}

/** One full-to-full stretch: distance driven and what it took to fill back up. */
export type Segment = {
  /** Entry id of the full fill that closes the segment. */
  endId: string;
  endDate: string;
  distanceKm: number;
  /** Litres or kWh: every fill after the opening full fill, up to and including the closing one. */
  amount: number;
  /** km per litre (fuel) or km per kWh (electric). */
  economy: number;
};

export type LogEconomy = {
  /** Most recent full-to-full segment. */
  latest: Segment;
  /** Distance-weighted average over every segment: total km ÷ total amount (not a mean of ratios). */
  average: number;
  segments: Segment[];
};

/**
 * Full-tank method. Between two consecutive full fills A and B, the car used exactly what it took to fill back to
 * full: the amounts of every fill after A up to and including B. Partial fills in between therefore count (their fuel
 * was burned before B topped up), and partial fills after the last full fill wait for the next full one. A segment
 * whose distance or amount is not positive (an odometer typed out of order) is skipped, never guessed.
 * Fewer than two full fills → null (no economy from the log).
 */
export function logEconomy(entries: readonly RefuelEntry[]): LogEconomy | null {
  const sorted = sortLog(entries);
  const segments: Segment[] = [];
  let open: RefuelEntry | null = null;
  let amount = 0;
  for (const entry of sorted) {
    if (!open) {
      if (entry.full) { open = entry; amount = 0; }
      continue;
    }
    amount += entry.amount;
    if (!entry.full) continue;
    const distanceKm = entry.odometerKm - open.odometerKm;
    if (distanceKm > 0 && amount > 0) {
      segments.push({ endId: entry.id, endDate: entry.date, distanceKm, amount: round(amount, 2), economy: distanceKm / amount });
    }
    open = entry;
    amount = 0;
  }
  if (!segments.length) return null;
  const km = segments.reduce((sum, s) => sum + s.distanceKm, 0);
  const used = segments.reduce((sum, s) => sum + s.amount, 0);
  return { latest: segments[segments.length - 1], average: km / used, segments };
}

const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places;

/** Which way to show economy: distance per unit (km/L, km/kWh; primary) or consumption per 100 km. */
export type EconomyUnit = 'perUnit' | 'per100';

export function unitLabel(energy: Energy, unit: EconomyUnit): string {
  if (energy === 'electric') return unit === 'perUnit' ? 'km/kWh' : 'kWh/100 km';
  return unit === 'perUnit' ? 'km/L' : 'L/100 km';
}

/** km per litre (or kWh) ↔ litres (or kWh) per 100 km. Non-positive or non-finite input is null. */
export function convertEconomy(kmPerUnit: number, unit: EconomyUnit): number | null {
  if (!Number.isFinite(kmPerUnit) || kmPerUnit <= 0) return null;
  return unit === 'perUnit' ? kmPerUnit : 100 / kmPerUnit;
}

/** "12.3 km/L" / "8.1 L/100 km"; null in → "—". One decimal, as on fuel receipts and trip computers. */
export function formatEconomy(kmPerUnit: number | null, energy: Energy, unit: EconomyUnit): string {
  const value = kmPerUnit === null ? null : convertEconomy(kmPerUnit, unit);
  return value === null ? '—' : value.toFixed(1) + ' ' + unitLabel(energy, unit);
}

export const UNIT_STORAGE_KEY = 'nostos.economyUnit';
export const parseUnit = (raw: string | null | undefined): EconomyUnit => raw === 'per100' ? 'per100' : 'perUnit';

/** Typed decimal text → number ('' → null; not a number → NaN). Accepts a decimal comma and thousands separators. */
export function parseDecimal(text: string): number | null {
  const trimmed = text.trim().replace(/[\s_]/g, '');
  if (!trimmed) return null;
  const normalized = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(trimmed) ? trimmed.replace(/,/g, '') : trimmed.replace(',', '.');
  return /^\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : NaN;
}

export type EntryDraft = { date: string; amount: string; odometer: string; price: string; full: boolean };
export type DraftErrors = Partial<Record<'date' | 'amount' | 'odometer' | 'price', string>>;

/**
 * Validates the entry form. Returns the entry, or per-field messages. `today` (YYYY-MM-DD, JST) rejects future days.
 */
export function entryFromDraft(draft: EntryDraft, id: string, energy: Energy, today: string):
  { entry: RefuelEntry; errors: null } | { entry: null; errors: DraftErrors } {
  const errors: DraftErrors = {};
  const date = cleanDate(draft.date);
  if (!date) errors.date = 'Enter a date as YYYY-MM-DD';
  else if (date > today) errors.date = 'The date is in the future';
  const amount = parseDecimal(draft.amount);
  if (amount === null) errors.amount = 'Required';
  else if (!(amount > 0 && amount <= logLimits.amountMax)) errors.amount = 'Enter ' + (energy === 'electric' ? 'kWh' : 'litres') + ' between 0 and ' + logLimits.amountMax;
  const odometer = parseDecimal(draft.odometer);
  if (odometer === null) errors.odometer = 'Required';
  else if (!(odometer >= 0 && odometer <= logLimits.odometerMax)) errors.odometer = 'Enter the odometer in km';
  const price = parseDecimal(draft.price);
  if (price !== null && !(price >= 0 && price <= logLimits.priceMax)) errors.price = 'Enter a number or leave it empty';
  if (Object.keys(errors).length) return { entry: null, errors };
  const entry = normalizeEntry({ id, date, amount, odometerKm: odometer, price, full: draft.full });
  return entry ? { entry, errors: null } : { entry: null, errors: { amount: 'Check the values' } };
}

export const draftOfEntry = (entry: RefuelEntry): EntryDraft => ({
  date: entry.date, amount: String(entry.amount), odometer: String(entry.odometerKm), price: entry.price === null ? '' : String(entry.price), full: entry.full,
});

/** Calendar day in JST (the app's display zone), YYYY-MM-DD. */
const jstDay = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Tokyo' });
export const todayJst = (now: number) => jstDay.format(new Date(now));

export const newEntryId = (now: number, random: () => number = Math.random) =>
  now.toString(36) + '-' + Math.floor(random() * 36 ** 6).toString(36).padStart(6, '0');

const grouped = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });
export const formatKm = (km: number) => grouped.format(km) + ' km';
export const formatAmount = (amount: number, energy: Energy) => amount.toFixed(amount < 100 ? 2 : 1).replace(/\.?0+$/, '') + ' ' + amountUnit(energy);
export const formatPrice = (price: number) => '¥' + new Intl.NumberFormat('en', { maximumFractionDigits: 0 }).format(price);
/** Price per litre / kWh derived from the entered total; null without a price. */
export const unitPrice = (entry: RefuelEntry) => entry.price === null || entry.amount <= 0 ? null : entry.price / entry.amount;
const dayLabel = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
export const formatDay = (date: string) => dayLabel.format(new Date(date + 'T00:00:00Z'));
