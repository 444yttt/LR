// Safe-area geometry, pure so tests can pin it. The screens are laid out in Figma frame coordinates (390 wide,
// scaled by `px`), and the Figma frames draw no status bar or home indicator: their safe area is implied by padding.

/**
 * Top safe edge implied by the Figma frames, in design points: the highest tappable thing on any frame is the detail
 * back button's hit frame at y=45 (Garage title y=58, + at y=59). Screens shift their content down by however much the
 * device's top inset reaches below this line, so nothing tappable or readable sits under the status bar or Dynamic
 * Island. Devices whose inset is already above it (iPhone SE: 20) keep the Figma layout unchanged.
 */
export const designSafeTop = 45;
/** Minimum clear space (design pt) between the last content and the top of the home indicator inset. */
export const bottomBreathing = 16;

type Scale = (value: number) => number;

/** Content shift below the status bar / Dynamic Island, in points. `round` snaps it to the device pixel grid. */
export function topShift(px: Scale, insetTop: number, round: (value: number) => number = value => value): number {
  return round(Math.max(0, insetTop - px(designSafeTop)));
}

/**
 * Extra scroll height for a fixed Figma canvas whose last content sits `designGap` (design pt) above the frame's
 * bottom edge: zero unless the home indicator inset plus breathing room needs more than the design already leaves.
 */
export function bottomExtra(px: Scale, insetBottom: number, designGap: number): number {
  return Math.max(0, insetBottom + px(bottomBreathing) - px(designGap));
}

/** Bottom padding for flowing scroll content: the design padding, or enough to clear the home indicator. */
export function bottomPadding(px: Scale, insetBottom: number, design: number): number {
  return Math.max(px(design), insetBottom + px(bottomBreathing));
}

/** Height of a fixed Figma canvas inside a scroll view, shifted below the top inset and clear of the home indicator. */
export function canvasHeight(px: Scale, insets: { top: number; bottom: number }, frameHeight: number, contentBottom: number, round?: (value: number) => number): number {
  return px(frameHeight) + topShift(px, insets.top, round) + bottomExtra(px, insets.bottom, frameHeight - contentBottom);
}

/**
 * Dynamic Type caps (maxFontSizeMultiplier). The Garage and vehicle detail are fixed Figma canvases with absolutely
 * placed text; beyond ~15% larger, lines would run into the line below. Flowing screens (sub-screens, the sheet) grow
 * with their text, so they allow much larger sizes.
 */
export const fontScaleCap = { canvas: 1.15, flow: 1.6 } as const;

/** Canvas frames (design pt): frame height and bottom of the last content block. */
export const canvases = {
  garage: { height: 940, contentBottom: 859 },
  /** Vehicle detail without an options list (see vehicleLayout). */
  vehicle: { height: 997, contentBottom: 943 },
  subScreen: { minHeight: 920, titleTop: 105, back: 45, paddingBottom: 56 },
} as const;

/**
 * Lower blocks of the vehicle detail canvas (design pt). Above y 747 the Figma frame is unchanged (header, hero stage
 * 208–412, metrics, status). Below it: the drives / connection row, the "Vehicle specs" row, an optional options card
 * (only when the owner entered options; one 26pt line each, room for the canvas Dynamic Type cap), then the footer.
 * The frame grows with the options card and keeps the original 54pt below the footer's text.
 */
export const vehicleRows = { action: 747, specs: 824, rowHeight: 65, gap: 18, optionsTop: 44, optionLine: 26, optionsBottom: 14, footerGap: 26, footerText: 28, tail: 54 } as const;
export function vehicleLayout(optionCount: number) {
  const r = vehicleRows;
  const optionsY = r.specs + r.rowHeight + r.gap;
  const optionsHeight = optionCount > 0 ? r.optionsTop + optionCount * r.optionLine + r.optionsBottom : 0;
  const footer = optionCount > 0 ? optionsY + optionsHeight + r.footerGap : r.specs + r.rowHeight + r.footerGap;
  const contentBottom = footer + r.footerText;
  return { action: r.action, specs: r.specs, options: optionCount > 0 ? { y: optionsY, height: optionsHeight } : null, footer, contentBottom, height: contentBottom + r.tail };
}

/**
 * Fixed navigation slots (design pt, before the safe-area top shift). Every pushed screen renders its back button in
 * `leading` and its recurring trailing action (e.g. "Update now") in `trailing`, through parts.NavBar, outside the
 * scroll view: the same action sits on the same spot on every screen and never scrolls away.
 * `leading` is the Figma back-button hit frame; `trailing` is right-aligned to the 16pt page inset, centred on the
 * same row.
 */
export const navSlots = {
  leading: { x: 14, y: 45, w: 50, h: 50 },
  trailing: { right: 16, y: 45, h: 50 },
} as const;
