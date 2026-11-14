import { PixelRatio, Platform, View } from 'react-native';
import Animated, { interpolate, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { SvgXml } from 'react-native-svg';
import { floorSvg, shadowSvg } from '../stageAssets';
import { place, type Px } from './theme';
import {
  carAspect, cardStageOffset, cardY, floors, profiles, shadows, stageBox, type Box,
} from '../vehicleGeometry.ts';

export { cardStageOffset, cardY } from '../vehicleGeometry.ts';

/** Side profiles, car facing left, tightly cropped to the car (tyre contact line = bottom edge). See assets/vehicles/ATTRIBUTION.md. */
export const carImages = [
  require('../../assets/vehicles/range-rover-l460.png'),
  require('../../assets/vehicles/ferrari-296.png'),
  require('../../assets/vehicles/bmw-x7.png'),
];

/** Makes gradient/filter ids unique per layer: the Figma exports reuse ids, which collide when several stages share a document. */
function scoped(xml: string, key: string): string {
  return xml.replace(/id="([^"]+)"/g, (_, id) => `id="${id}-${key}"`).replace(/url\(#([^)]+)\)/g, (_, id) => `url(#${id}-${key})`);
}
const floorXml = floorSvg.map((xml, mode) => scoped(xml, 'floor' + mode));
const shadowXml = shadowSvg.map((list, mode) => list.map((xml, index) => scoped(xml, `shadow${mode}${index}`)));

/**
 * Card ↔ hero handoff window, in hero progress. The hero and the card's own stage are drawn by different views
 * (and, on iOS, from differently sized decoded bitmaps), so instead of a hard swap they hand over in the last
 * sliver of the flight, where the hero already sits within a fraction of a point of the card:
 * - the card car fades in *under* the still-opaque hero (progress `cardIn` → `fade`), which changes nothing visible;
 * - the hero then fades out over the opaque card car (progress `fade` → 0);
 * - the translucent floor and contact shadow cross-fade (1 − h / h), so their density never doubles.
 * At progress 0 only the card is drawn; at ≥ `cardIn` only the hero.
 */
export const handoffWindow = { fade: 0.012, cardIn: 0.024 };

/** Hero visibility h for a progress value (0 parked on the card … 1 from `handoffWindow.fade` up). */
export function heroVisibility(progress: number): number {
  'worklet';
  const h = progress / handoffWindow.fade;
  return h <= 0 ? 0 : h >= 1 ? 1 : h;
}

/** Card-stage layer opacities while a hero flown from this card is above it. */
export function useCardHandoff(progress: SharedValue<number>, active: boolean) {
  const car = useAnimatedStyle(() => {
    if (!active) return { opacity: 1 };
    const c = (handoffWindow.cardIn - progress.value) / (handoffWindow.cardIn - handoffWindow.fade);
    return { opacity: c <= 0 ? 0 : c >= 1 ? 1 : c };
  });
  const ground = useAnimatedStyle(() => ({ opacity: active ? 1 - heroVisibility(progress.value) : 1 }));
  return { car, ground };
}

/** Static three-layer stage used on Garage cards: floor, contact shadow, vehicle (back to front). */
export function CardStage({ px, index, handoff }: { px: Px; index: number; handoff?: { car: object; ground: object } }) {
  const floor = floors[0], shadow = shadows[0][index], profile = profiles[0][index];
  return <View style={place(px, 0, 0, 325, 121)} accessible={false} pointerEvents="none">
    <Animated.View style={[place(px, floor.x, floor.y, floor.w, floor.h), handoff?.ground]}><SvgXml xml={floorXml[0]} width="100%" height="100%" /></Animated.View>
    <Animated.View style={[place(px, shadow.x, shadow.y, shadow.w, shadow.h), handoff?.ground]}><SvgXml xml={shadowXml[0][index]} width="100%" height="100%" /></Animated.View>
    <Animated.Image source={carImages[index]} resizeMode="contain" accessible={false} style={[place(px, profile.x, profile.y, profile.w, profile.h), handoff?.car]} />
  </View>;
}

/**
 * Where a Garage card's stage sits, in Garage content coordinates (unscrolled), plus the Garage's live scroll offset.
 * The hero reads `scroll` on the UI thread, so a return flight lands where the card is now, not where it was at tap time.
 */
export type Origin = { x: number; y: number; scroll: SharedValue<number> };

export function cardStageOrigin(px: Px, index: number, garageScroll: SharedValue<number>): Origin {
  return { x: px(16) + px(cardStageOffset.x), y: px(cardY[index]) + px(cardStageOffset.y), scroll: garageScroll };
}

// Native Yoga rounds layout to the device pixel grid; react-native-web keeps fractional CSS layout.
const snap = Platform.OS === 'web' ? (value: number) => value : (value: number) => PixelRatio.roundToNearestPixel(value);
/**
 * The rect the renderer actually draws for an absolutely placed view: Yoga rounds each view's absolute edges
 * to the device pixel grid, so a transform must target those rounded edges, not the raw design values.
 */
export function drawnRect(left: number, top: number, width: number, height: number): Box {
  const x = snap(left), y = snap(top);
  return { x, y, w: snap(left + width) - x, h: snap(top + height) - y };
}
/** Size of a `resizeMode="contain"` image inside a frame. */
function fitted(frame: Box, aspect: number) {
  const w = Math.min(frame.w, frame.h * aspect);
  return { w, h: w / aspect };
}

/**
 * Center-based transform that places a detail-stage layer (`dest`, stage space) over the matching card layer
 * (`source`, card-stage space) when both screens are unscrolled. Scroll offsets are added live in the worklets.
 * `aspect` = uniform scale for a contain-fitted image; otherwise the SVG layer stretches on each axis.
 */
export function handoff(px: Px, origin: { x: number; y: number }, source: Box, dest: Box, aspect?: number) {
  const from = drawnRect(origin.x + px(source.x), origin.y + px(source.y), px(source.w), px(source.h));
  const to = drawnRect(px(stageBox[1].x) + px(dest.x), px(stageBox[1].y) + px(dest.y), px(dest.w), px(dest.h));
  const tx = from.x + from.w / 2 - (to.x + to.w / 2);
  const ty = from.y + from.h / 2 - (to.y + to.h / 2);
  if (aspect !== undefined) {
    const s = fitted(from, aspect).w / fitted(to, aspect).w;
    return { tx, ty, sx: s, sy: s };
  }
  return { tx, ty, sx: from.w / to.w, sy: from.h / to.h };
}

const mix = (from: number, to: number, t: number) => {
  'worklet';
  return from + (to - from) * t;
};
const clamp01 = (value: number) => {
  'worklet';
  return value < 0 ? 0 : value > 1 ? 1 : value;
};
/** Exactly the resting transform: no residual scale or sub-pixel offset once a layer has landed. */
const rest = [{ translateX: 0 }, { translateY: 0 }, { scaleX: 1 }, { scaleY: 1 }];

/**
 * Detail stage whose floor, contact shadow, and car are separate animated layers, all driven by one UI-thread value.
 *
 * progress 0 → layers sit pixel-for-pixel over the Garage card's layers; 1 → resting on the detail stage.
 * - Car: glides and scales along `progress` on a slight arc; the arc and the hero easing both reach zero velocity at 1,
 *   so the car comes to rest on the last animation frame with no separate settle animation.
 * - Floor: follows ~8% behind the car, stretching from the card ellipse to the deeper detail ellipse.
 * - Contact shadow: thins and fades while the car is lifted, then grounds again on landing.
 * - Handoff: the card's own stage and the hero both read the same UI-thread progress and hand over inside
 *   `handoffWindow` (see useCardHandoff), so nothing waits for React and no frame shows both or neither.
 * `scrollOffset` is the live detail scroll position; it only matters while progress < 1 (i.e. while flying back).
 */
export function HeroStage({ px, index, origin, progress, scrollOffset, onReady }: {
  px: Px; index: number; origin: Origin | null; progress: SharedValue<number>; scrollOffset: SharedValue<number>; onReady?: () => void;
}) {
  const floor = floors[1], shadow = shadows[1][index], profile = profiles[1][index];
  const car = origin ? handoff(px, origin, profiles[0][index], profile, carAspect[index]) : null;
  const ground = origin ? handoff(px, origin, floors[0], floor) : null;
  const contact = origin ? handoff(px, origin, shadows[0][index], shadow) : null;
  const garageScroll = origin?.scroll;
  const arc = px(4.8);
  // Without an origin (deep link), rise into place instead of flying from a card.
  const rise = px(18);

  // Parked on the card (progress 0) the hero is hidden; it hands over to the card's stage in the last frames (see handoffWindow).
  const stageStyle = useAnimatedStyle(() => ({ opacity: car ? heroVisibility(progress.value) : 1 }));

  const carStyle = useAnimatedStyle(() => {
    const p = clamp01(progress.value);
    if (!car) return { opacity: clamp01(p / 0.6), transform: [{ translateX: 0 }, { translateY: (1 - p) * rise }, { scaleX: 1 }, { scaleY: 1 }] };
    if (p >= 1) return { transform: rest };
    const shift = (garageScroll ? -garageScroll.value : 0) + scrollOffset.value;
    const s = mix(car.sx, 1, p);
    return {
      transform: [
        { translateX: car.tx * (1 - p) },
        // A slight arc: the car rises a few points mid-flight before landing.
        { translateY: (car.ty + shift) * (1 - p) - Math.sin(Math.PI * p) * arc },
        { scaleX: s },
        { scaleY: s },
      ],
    };
  });

  const floorStyle = useAnimatedStyle(() => {
    const raw = clamp01(progress.value);
    if (!ground) return { opacity: clamp01(raw / 0.8) };
    const p = clamp01((raw - 0.08) / 0.92);
    if (raw >= 1) return { transform: rest };
    const shift = (garageScroll ? -garageScroll.value : 0) + scrollOffset.value;
    return {
      transform: [
        { translateX: ground.tx * (1 - p) },
        { translateY: (ground.ty + shift) * (1 - p) },
        { scaleX: mix(ground.sx, 1, p) },
        { scaleY: mix(ground.sy, 1, p) },
      ],
    };
  });

  const shadowStyle = useAnimatedStyle(() => {
    const p = clamp01(progress.value);
    if (!contact) return { opacity: clamp01((p - 0.5) / 0.5) };
    if (p >= 1) return { opacity: 1, transform: rest };
    const grounded = interpolate(p, [0, 0.18, 0.78, 1], [1, 0.25, 0.25, 1], 'clamp');
    const shift = (garageScroll ? -garageScroll.value : 0) + scrollOffset.value;
    return {
      opacity: grounded,
      transform: [
        { translateX: contact.tx * (1 - p) },
        { translateY: (contact.ty + shift) * (1 - p) },
        { scaleX: mix(contact.sx, 1, p) * interpolate(grounded, [0.25, 1], [0.82, 1]) },
        { scaleY: mix(contact.sy, 1, p) },
      ],
    };
  });

  return <Animated.View style={[place(px, stageBox[1].x, stageBox[1].y, stageBox[1].w, stageBox[1].h), stageStyle]} accessible={false} pointerEvents="none">
    <Animated.View style={[place(px, floor.x, floor.y, floor.w, floor.h), floorStyle]}>
      <SvgXml xml={floorXml[1]} width="100%" height="100%" />
    </Animated.View>
    <Animated.View style={[place(px, shadow.x, shadow.y, shadow.w, shadow.h), shadowStyle]}>
      <SvgXml xml={shadowXml[1][index]} width="100%" height="100%" />
    </Animated.View>
    <Animated.Image source={carImages[index]} resizeMode="contain" accessible={false} onLoad={onReady}
      style={[place(px, profile.x, profile.y, profile.w, profile.h), carStyle]} />
  </Animated.View>;
}
