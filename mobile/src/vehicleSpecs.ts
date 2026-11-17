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
};

/** Specs per vehicle, keyed by the stable VehicleId (never by VEHICLES index, so a reorder cannot mix them up). */
export type SpecsMap = Partial<Record<VehicleId, VehicleSpecs>>;

export const SPECS_STORAGE_KEY = 'nostos.vehicleSpecs';
export const SPECS_VERSION = 1;

export const specLimits = { grade: 40, engine: 40, year: 12, option: 60, options: 30 } as const;

export const emptySpecs: VehicleSpecs = Object.freeze({ grade: '', engine: '', year: '', options: Object.freeze([]) as unknown as string[] });

const VEHICLE_IDS: readonly VehicleId[] = ['range-rover', 'ferrari-296', 'bmw-x7'];

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
  };
}

export const isEmptySpecs = (specs: VehicleSpecs) => !specs.grade && !specs.engine && !specs.year && !specs.options.length;

export function sameSpecs(a: VehicleSpecs, b: VehicleSpecs): boolean {
  return a.grade === b.grade && a.engine === b.engine && a.year === b.year
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

/** Existing model line, plus the model year when one was entered: "Model · Year". */
export const modelLine = (model: string, specs: VehicleSpecs) => {
  const year = specs.year.trim();
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
 * Detail title size: 31pt as designed while the name fits the 346pt line (x 22 to the right page inset); longer names
 * step down to as small as 22pt. Anything still longer is shrunk further by the Label (adjustsFontSizeToFit).
 */
export const titleWidth = 346;
export function titleSize(name: string, designSize = 31, minSize = 22): number {
  const width = textWidth(name, designSize);
  if (width <= titleWidth) return designSize;
  return Math.max(minSize, Math.floor(designSize * titleWidth / width));
}
