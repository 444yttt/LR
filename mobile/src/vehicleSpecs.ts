// User-entered vehicle specs (grade / trim, engine, model year, options). Pure: no React Native imports, so parsing,
// normalising and the display-name rules run under `node --test`. Storage lives in ui/specs.tsx (AsyncStorage).
//
// Everything here is plain text the owner typed on this device. Nothing is defaulted, pre-filled, or inferred from
// telemetry or from the built-in VEHICLES table: an unset field is an empty string and adds nothing to any label.
import type { VehicleId, VehicleInfo } from './garageModel.ts';

export type VehicleSpecs = {
  grade: string;
  engine: string;
  year: string;
  options: string[];
  /**
   * Usable fuel tank capacity in litres, or for an electric vehicle the usable battery capacity in kWh (see
   * fuelLog.energyOf). Optional; null until the owner enters it. Never inferred from telemetry or the vehicle table.
   * Added after the first release of this document: v1 documents without it still load (it reads as null).
   */
  capacity: number | null;
};

/** Specs per vehicle, keyed by the stable VehicleId (never by VEHICLES index, so a reorder cannot mix them up). */
export type SpecsMap = Partial<Record<VehicleId, VehicleSpecs>>;

export const SPECS_STORAGE_KEY = 'nostos.vehicleSpecs';
// Still 1: `capacity` is an optional addition that older documents simply lack, and older builds drop unknown keys.
export const SPECS_VERSION = 1;

/** Field caps. Grade + engine are kept short enough that the composed detail title fits two lines (see titleLayout). */
export const specLimits = { grade: 30, engine: 24, year: 12, option: 60, options: 30, capacityMin: 1, capacityMax: 300 } as const;

export const emptySpecs: VehicleSpecs = Object.freeze({ grade: '', engine: '', year: '', options: Object.freeze([]) as unknown as string[], capacity: null });

/** A stored capacity: a finite number within limits, rounded to 0.1; anything else is null (not entered). */
export function cleanCapacity(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const rounded = Math.round(value * 10) / 10;
  return rounded >= specLimits.capacityMin && rounded <= specLimits.capacityMax ? rounded : null;
}

/**
 * Typed capacity text → number. '' is "not entered" (null); text that is not a number in range is 'invalid', so the
 * editor can say so instead of silently dropping it. Accepts a decimal comma.
 */
export function parseCapacityText(text: string): number | null | 'invalid' {
  const trimmed = text.trim().replace(',', '.');
  if (!trimmed) return null;
  if (!/^\d{1,4}(\.\d{0,2})?$/.test(trimmed)) return 'invalid';
  return cleanCapacity(Number(trimmed)) ?? 'invalid';
}

/** Capacity as editable text ('' when not entered). */
export const capacityText = (capacity: number | null) => capacity === null ? '' : String(capacity);

/** Every vehicle that can hold specs (the VEHICLES ids; test/vehicleSpecs.test.ts keeps them in step). */
export const VEHICLE_IDS: readonly VehicleId[] = ['range-rover', 'bmw-x7', 'audi-s-etron-gt', 'ferrari-296'];

/** Trims, collapses inner whitespace (incl. newlines) to one space, and caps the length. Non-strings become ''. */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max).trim();
}

/** A well-formed specs value from anything: unknown keys dropped, blank options removed, everything capped. */
export function normalizeSpecs(value: unknown): VehicleSpecs {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const options = Array.isArray(input.options)
    ? input.options.map(option => cleanText(option, specLimits.option)).filter(Boolean).slice(0, specLimits.options)
    : [];
  return {
    grade: cleanText(input.grade, specLimits.grade),
    engine: cleanText(input.engine, specLimits.engine),
    year: cleanText(input.year, specLimits.year),
    options,
    capacity: cleanCapacity(input.capacity),
  };
}

export const isEmptySpecs = (specs: VehicleSpecs) => !specs.grade && !specs.engine && !specs.year && !specs.options.length && specs.capacity === null;

export function sameSpecs(a: VehicleSpecs, b: VehicleSpecs): boolean {
  return a.grade === b.grade && a.engine === b.engine && a.year === b.year && a.capacity === b.capacity
    && a.options.length === b.options.length && a.options.every((option, i) => option === b.options[i]);
}

/**
 * Stored document → specs map. Missing, corrupt, wrong-version or wrong-shape storage is an empty map, never a throw.
 * Unknown vehicle ids are ignored; vehicles whose specs are all empty are left out.
 */
export function parseSpecs(raw: string | null | undefined): SpecsMap {
  if (!raw) return {};
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!doc || typeof doc !== 'object' || (doc as { version?: unknown }).version !== SPECS_VERSION) return {};
  const vehicles = (doc as { vehicles?: unknown }).vehicles;
  if (!vehicles || typeof vehicles !== 'object' || Array.isArray(vehicles)) return {};
  const map: SpecsMap = {};
  for (const id of VEHICLE_IDS) {
    const specs = normalizeSpecs((vehicles as Record<string, unknown>)[id]);
    if (!isEmptySpecs(specs)) map[id] = specs;
  }
  return map;
}

/** Specs map → the stored JSON document (versioned). Empty vehicles are omitted. */
export function serializeSpecs(map: SpecsMap): string {
  const vehicles: SpecsMap = {};
  for (const id of VEHICLE_IDS) {
    const specs = map[id] ? normalizeSpecs(map[id]) : null;
    if (specs && !isEmptySpecs(specs)) vehicles[id] = specs;
  }
  return JSON.stringify({ version: SPECS_VERSION, vehicles });
}

/** The map with one vehicle's specs replaced (normalised); empty specs remove the vehicle's entry. */
export function withSpecs(map: SpecsMap, id: VehicleId, specs: VehicleSpecs): SpecsMap {
  const next: SpecsMap = { ...map };
  const clean = normalizeSpecs(specs);
  if (isEmptySpecs(clean)) delete next[id];
  else next[id] = clean;
  return next;
}

export const specsFor = (map: SpecsMap, id: VehicleId): VehicleSpecs => map[id] ?? emptySpecs;

const join = (parts: string[]) => parts.map(part => part.trim()).filter(Boolean).join(' ');

/** Base name + whatever of grade and engine was entered: "Name Grade Engine", or just the base name. */
export const displayName = (base: string, specs: VehicleSpecs) => join([base, specs.grade, specs.engine]);

/**
 * Existing model line, plus a model year: the one the owner entered, else the one the vehicle's data source reports
 * (`reportedYear`, display only; never written into the specs). "Model · Year".
 */
export const modelLine = (model: string, specs: VehicleSpecs, reportedYear: number | null = null) => {
  const year = specs.year.trim() || (reportedYear !== null ? String(reportedYear) : '');
  return year ? model + ' · ' + year : model;
};

// Layout fitting. The Garage card and the detail title are fixed Figma canvases with absolutely placed single lines,
// so a composed name must fit one line. Widths are estimated from Inter SemiBold advance widths (em units, slightly
// generous) so the choice is deterministic and testable; on device the Label also caps at one line.
const narrow = new Set('iIjl.,:;!|\'’'.split(''));
const semiNarrow = new Set('frt()-/[]1 '.split(''));
const wide = new Set('MWmw@%'.split(''));
function charEm(char: string): number {
  if (char === ' ') return 0.27;
  if (narrow.has(char)) return 0.29;
  if (semiNarrow.has(char)) return 0.4;
  if (wide.has(char)) return 0.92;
  if (/[A-Z]/.test(char)) return 0.72;
  if (/[0-9]/.test(char)) return 0.64;
  if (/[a-z]/.test(char)) return 0.58;
  // CJK and other full-width text.
  return char.charCodeAt(0) > 0x2e80 ? 1.0 : 0.7;
}

/** Estimated single-line width (design pt) of `text` in Inter SemiBold at `size` pt. */
export function textWidth(text: string, size: number): number {
  let em = 0;
  for (const char of text) em += charEm(char);
  return em * size;
}

/**
 * Garage card title: the card name sits at x 15 (20pt) and must stay clear of the chevron at x 325, so the line has
 * ~300pt. Room for Dynamic Type's canvas cap (1.15) is kept. Too long → the base name; the detail shows the full name.
 */
export const cardNameWidth = 300;
export function cardName(info: Pick<VehicleInfo, 'name'>, specs: VehicleSpecs, fontScale = 1.15): string {
  const full = displayName(info.name, specs);
  return textWidth(full, 20 * fontScale) <= cardNameWidth ? full : info.name;
}

/**
 * Detail header layout (design pt). The Figma header: 31pt title at y 105, model line at y 145, status at y 170, hero
 * stage from y 208. A composed name that does not fit the 346pt line at 31pt steps down (to 22pt) on one line with
 * its baseline unchanged; longer names wrap to two lines (17–22pt) starting at y 101, and the model and status lines
 * move down below them, still above the hero stage. `fontScale` is the Dynamic Type scale (capped at the canvas cap).
 */
export const titleWidth = 346;
export const headerLimit = 208;
export type TitleLayout = { size: number; lines: 1 | 2; top: number; modelTop: number; statusTop: number };
const ascent = 1984 / 2048;
const lineRatio = (1984 + 494) / 2048;
export function titleLayout(name: string, fontScale = 1, cap = 1.15): TitleLayout {
  const scale = Math.min(cap, Math.max(1, fontScale));
  const em = textWidth(name, 1) * scale;
  const one = em > 0 ? Math.floor(titleWidth / em) : 31;
  if (one >= 31) return { size: 31, lines: 1, top: 105, modelTop: 145, statusTop: 170 };
  if (one >= 22) return { size: one, lines: 1, top: 105 + (31 - one) * ascent * scale, modelTop: 145, statusTop: 170 };
  // Two lines; 0.9 leaves room for words that wrap early.
  const size = Math.min(22, Math.max(17, Math.floor(2 * titleWidth * 0.9 / em)));
  const top = 101;
  const modelTop = Math.max(145, top + 2 * size * lineRatio * scale + 5);
  return { size, lines: 2, top, modelTop, statusTop: modelTop + 25 };
}
