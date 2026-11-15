// Swipe-down-to-close geometry for a hero (vehicle detail) screen. Pure worklets so tests can pin them.
//
// One presentation model: the detail is an overlay whose whole state is the entry's hero `progress` (1 presented,
// 0 parked on its Garage card). Open, back button, edge swipe and swipe-down all move that one value, so every path
// is the same flight. The swipe-down adds only a vertical "follow" translation of the detail layer, derived from
// progress, so the car stays under the finger; it reaches zero before the card handoff window and the car lands on
// its card exactly as it does for the back button.

export const swipeDown = {
  /** Finger travel (fraction of window height) that would scrub progress all the way from 1 to 0. */
  distance: 0.8,
  /** Fraction of `distance` followed 1:1 before the drag starts rubber-banding. */
  natural: 0.6,
  /** Fraction of `distance` the rubber band can never pass: progress stays above 1 − limit under the finger. */
  limit: 0.85,
  /** Release past this fraction of `distance` closes the screen. */
  commit: 0.22,
  /** A downward fling faster than this (pt/s) closes from any distance. */
  flingVelocity: 900,
  /** An upward flick faster than this (pt/s) keeps the screen, even past the distance threshold. */
  keepVelocity: 300,
  /** Vertical slop before the pan activates; horizontal travel beyond `failX` leaves the touch to the edge swipe. */
  activateY: 10,
  failX: 20,
  /** Follow translation fades out between these progress values: it is 0 before the card handoff window. */
  followLand: 0.06,
  followFull: 0.4,
} as const;

const clamp01 = (value: number) => {
  'worklet';
  return value < 0 ? 0 : value > 1 ? 1 : value;
};

/**
 * Finger travel → displayed travel. Linear up to `natural`, then an asymptotic band towards `limit` whose slope at
 * the join is 1 (no kink): 1 − 1/(x/room + 1) has derivative 1 at 0. Negative input is 0.
 */
export function rubberBand(drag: number, natural: number, limit: number): number {
  'worklet';
  if (drag <= 0) return 0;
  if (drag <= natural) return drag;
  const room = limit - natural;
  if (room <= 0) return natural;
  const x = drag - natural;
  return natural + room * (1 - 1 / (x / room + 1));
}

/** Window height → the drag metrics in points. */
export function dismissMetrics(height: number) {
  'worklet';
  const distance = height * swipeDown.distance;
  return { distance, natural: distance * swipeDown.natural, limit: distance * swipeDown.limit, commit: distance * swipeDown.commit };
}

/** Hero progress while dragged `band` points (after rubber-banding). */
export function dragProgress(band: number, distance: number): number {
  'worklet';
  return clamp01(1 - band / distance);
}

/** Release decision. `band` is the displayed (rubber-banded) drag, `velocityY` positive downward. */
export function shouldDismiss(band: number, velocityY: number, distance: number): boolean {
  'worklet';
  if (band <= 0) return false;
  if (velocityY < -swipeDown.keepVelocity) return false;
  return band >= distance * swipeDown.commit || velocityY > swipeDown.flingVelocity;
}

/**
 * Layer translation per unit of (1 − progress), in points. The car's own flight already moves it `travel` points
 * down at progress 0 (card below the detail stage, scroll included); the layer adds the rest so the car tracks the
 * finger. A card further away than `distance` needs no help (0); a deep link with no card follows fully.
 */
export function followPoints(travel: number, distance: number): number {
  'worklet';
  return clamp01(1 - travel / distance) * distance;
}

/**
 * Follow shape over progress: exactly (1 − p) where a drag can put it (p ≥ followFull), easing to 0 by `followLand`,
 * so the detail layer is back at rest before the hero and the card hand over (stage.handoffWindow ≤ 0.024).
 */
export function followShape(progress: number): number {
  'worklet';
  const p = clamp01(progress);
  const t = clamp01((p - swipeDown.followLand) / (swipeDown.followFull - swipeDown.followLand));
  return (1 - p) * t * t * (3 - 2 * t);
}

/** Close duration after release, from where progress is and how fast the finger was moving (ms). */
export function releaseDuration(progress: number, velocityY: number): number {
  'worklet';
  const base = 180 + 320 * clamp01(progress);
  const speed = 1 + Math.max(0, velocityY) / 4000;
  return Math.round(Math.min(500, Math.max(200, base / speed)));
}
