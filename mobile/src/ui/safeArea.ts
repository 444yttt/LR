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
  vehicle: { height: 920, contentBottom: 866 },
  subScreen: { minHeight: 920, titleTop: 105, back: 45, paddingBottom: 56 },
} as const;
