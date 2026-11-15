// Swipe-down dismiss geometry and the fixed nav slots. Pure functions only.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dismissMetrics, dragProgress, followPoints, followShape, releaseDuration, rubberBand, shouldDismiss, swipeDown,
} from '../src/ui/dismiss.ts';
import { navSlots } from '../src/ui/safeArea.ts';

const m = dismissMetrics(874); // iPhone 16 Pro window height
const near = (actual: number, expected: number, eps = 1e-6) => assert.ok(Math.abs(actual - expected) < eps, `${actual} ≉ ${expected}`);

test('rubber band: 1:1 up to the natural travel, then resists smoothly and never reaches the limit', () => {
  assert.equal(rubberBand(-20, m.natural, m.limit), 0);
  assert.equal(rubberBand(0, m.natural, m.limit), 0);
  assert.equal(rubberBand(120, m.natural, m.limit), 120);
  assert.equal(rubberBand(m.natural, m.natural, m.limit), m.natural);
  // Slope 1 at the join (no kink), < 1 after it, monotonic, bounded.
  near((rubberBand(m.natural + 0.01, m.natural, m.limit) - m.natural) / 0.01, 1, 1e-3);
  let previous = m.natural;
  for (let d = m.natural + 50; d < m.natural + 5000; d += 50) {
    const band = rubberBand(d, m.natural, m.limit);
    assert.ok(band > previous && band < m.limit);
    assert.ok(band - previous < 50);
    previous = band;
  }
});

test('drag → progress: full presentation at rest, never below the rubber-band floor under the finger', () => {
  assert.equal(dragProgress(0, m.distance), 1);
  near(dragProgress(m.distance / 2, m.distance), 0.5);
  const floor = dragProgress(rubberBand(1e6, m.natural, m.limit), m.distance);
  assert.ok(floor > 1 - swipeDown.limit - 1e-6 && floor < 0.2);
  // Natural travel ends where the follow translation starts fading (followFull): the car tracks the finger exactly there.
  near(dragProgress(m.natural, m.distance), swipeDown.followFull);
});

test('release: distance or fling closes, short slow pulls and up-flicks spring back', () => {
  assert.equal(shouldDismiss(0, 5000, m.distance), false, 'no pull, no close');
  assert.equal(shouldDismiss(m.commit - 1, 0, m.distance), false);
  assert.equal(shouldDismiss(m.commit, 0, m.distance), true);
  assert.equal(shouldDismiss(30, swipeDown.flingVelocity + 1, m.distance), true, 'short fling');
  assert.equal(shouldDismiss(30, swipeDown.flingVelocity - 1, m.distance), false);
  assert.equal(shouldDismiss(m.commit * 2, -swipeDown.keepVelocity - 1, m.distance), false, 'flicked back up');
  assert.ok(m.commit > 120 && m.commit < 200, 'threshold is a deliberate pull, not a twitch');
});

test('follow: the car stays under the finger while dragging, and the layer is at rest before the card handoff', () => {
  // Car flight offset (travel·(1−p)) + layer follow == finger travel, for any card distance < distance.
  for (const travel of [0, 18, 239, 478]) {
    const follow = followPoints(travel, m.distance);
    for (const band of [10, 100, 300, m.natural]) {
      const p = dragProgress(band, m.distance);
      near(travel * (1 - p) + follow * followShape(p), band, 1e-6);
    }
  }
  assert.equal(followPoints(m.distance * 2, m.distance), 0, 'card further than the drag: no extra translation');
  assert.equal(followPoints(-50, m.distance), m.distance, 'card above (Garage scrolled): clamp, full follow');
  // stage.handoffWindow ends at 0.024: zero translation from followLand down.
  for (const p of [0, 0.012, 0.024, swipeDown.followLand]) assert.equal(followShape(p), 0);
  assert.equal(followShape(1), 0);
  // Rises from 0 at followLand, peaks just under followFull no higher than 10% over the drag value there, then is exactly
  // (1 − p): the layer keeps the throw's direction, then eases into the card without a kink.
  let peak = 0;
  for (let p = 0; p <= 1; p += 0.001) peak = Math.max(peak, followShape(p));
  assert.ok(peak <= (1 - swipeDown.followFull) * 1.1);
  const slope = (a: number, b: number) => (followShape(b) - followShape(a)) / (b - a);
  near(slope(swipeDown.followFull - 1e-4, swipeDown.followFull), slope(swipeDown.followFull, swipeDown.followFull + 1e-4), 1e-2);
});

test('release duration: bounded, shorter from deeper drags and faster flings', () => {
  for (const p of [0, 0.3, 0.7, 1]) for (const v of [-500, 0, 900, 4000]) {
    const d = releaseDuration(p, v);
    assert.ok(d >= 200 && d <= 500);
  }
  assert.ok(releaseDuration(0.4, 0) < releaseDuration(0.9, 0));
  assert.ok(releaseDuration(0.9, 3000) < releaseDuration(0.9, 0));
});

test('nav slots: back is the Figma back-button frame, trailing actions share its row on the page inset', () => {
  assert.deepEqual(navSlots.leading, { x: 14, y: 45, w: 50, h: 50 });
  assert.equal(navSlots.trailing.y, navSlots.leading.y);
  assert.equal(navSlots.trailing.h, navSlots.leading.h);
  assert.equal(navSlots.trailing.right, 16);
});
