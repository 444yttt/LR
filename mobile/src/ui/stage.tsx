import { useEffect } from 'react';
import { Image, View } from 'react-native';
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import { SvgXml } from 'react-native-svg';
import { floorSvg, shadowSvg } from '../stageAssets';
import { ease, springs, useMotion } from './motion';
import { place, type Px } from './theme';

export const carImages = [
  require('../../assets/range-rover-l460.png'),
  require('../../assets/ferrari-296.png'),
  require('../../assets/bmw-m4.png'),
];

type Box = { x: number; y: number; w: number; h: number };

/** Makes gradient/filter ids unique per layer: the Figma exports reuse ids, which collide when several stages share a document. */
function scoped(xml: string, key: string): string {
  return xml.replace(/id="([^"]+)"/g, (_, id) => `id="${id}-${key}"`).replace(/url\(#([^)]+)\)/g, (_, id) => `url(#${id}-${key})`);
}
const floorXml = floorSvg.map((xml, mode) => scoped(xml, 'floor' + mode));
const shadowXml = shadowSvg.map((list, mode) => list.map((xml, index) => scoped(xml, `shadow${mode}${index}`)));

// Stage geometry from Final / Light Floor. Index 0 = Garage card stage (325×121), 1 = detail stage (356×204).
export const stageBox: Box[] = [{ x: 0, y: 0, w: 325, h: 121 }, { x: 17, y: 208, w: 356, h: 204 }];
/** Garage card stage origin inside a card at (16, cardY). */
export const cardStageOffset = { x: 18, y: 70 };
export const cardY = [156, 395, 634];
export const floors: Box[] = [
  { x: 16.5, y: 99.04, w: 292, h: 27 },
  { x: 9, y: 128.12, w: 338, h: 56 },
];
// Contact-shadow SVGs include the layer-blur padding (radius 4 on cards, 6 on detail).
const shadowRects = [
  [
    { x: 71.28, y: 109, w: 182.45, h: 6, blur: 4 },
    { x: 72.61, y: 109, w: 179.78, h: 6, blur: 4 },
    { x: 64.6, y: 109, w: 195.8, h: 6, blur: 4 },
  ],
  [
    { x: 52.96, y: 152, w: 250.09, h: 8, blur: 6 },
    { x: 50.73, y: 152, w: 254.54, h: 8, blur: 6 },
    { x: 42.72, y: 152, w: 270.56, h: 8, blur: 6 },
  ],
];
export const shadows: Box[][] = shadowRects.map(list => list.map(s => ({ x: s.x - s.blur, y: s.y - s.blur, w: s.w + s.blur * 2, h: s.h + s.blur * 2 })));
export const profiles: Box[][] = [
  [
    { x: 60, y: 30.02, w: 205, h: 82 },
    { x: 61.5, y: 53.57, w: 202, h: 58.4 },
    { x: 52.5, y: 40.16, w: 220, h: 71.8 },
  ],
  [
    { x: 37.5, y: 42.63, w: 281, h: 112.4 },
    { x: 35, y: 72.28, w: 286, h: 82.7 },
    { x: 26, y: 55.73, w: 304, h: 99.3 },
  ],
];

/** Static three-layer stage used on Garage cards: floor, contact shadow, vehicle (back to front). */
export function CardStage({ px, index }: { px: Px; index: number }) {
  const floor = floors[0], shadow = shadows[0][index], profile = profiles[0][index];
  return <View style={place(px, 0, 0, 325, 121)} accessible={false} pointerEvents="none">
    <View style={place(px, floor.x, floor.y, floor.w, floor.h)}><SvgXml xml={floorXml[0]} width="100%" height="100%" /></View>
    <View style={place(px, shadow.x, shadow.y, shadow.w, shadow.h)}><SvgXml xml={shadowXml[0][index]} width="100%" height="100%" /></View>
    <Image source={carImages[index]} resizeMode="contain" accessible={false} style={place(px, profile.x, profile.y, profile.w, profile.h)} />
  </View>;
}

/** Window point (in pt) where a Garage card's stage starts, so the hero knows where to fly from. */
export type Origin = { x: number; y: number };

export function cardStageOrigin(px: Px, index: number, garageScrollY: number): Origin {
  return { x: px(16 + cardStageOffset.x), y: px(cardY[index] + cardStageOffset.y) - garageScrollY };
}

/**
 * Transform that places a detail-stage layer (dest box, in stage space) over the matching card layer.
 * Returned values are center-based so the default transform origin works on iOS and web.
 */
function fromCard(px: Px, origin: Origin, source: Box, dest: Box) {
  const stage = stageBox[1];
  const sx = origin.x + px(source.x + source.w / 2);
  const sy = origin.y + px(source.y + source.h / 2);
  const dx = px(stage.x + dest.x + dest.w / 2);
  const dy = px(stage.y + dest.y + dest.h / 2);
  return { tx: sx - dx, ty: sy - dy, sx: source.w / dest.w, sy: source.h / dest.h };
}

/**
 * Detail stage whose floor, contact shadow, and car are separate animated layers.
 *
 * progress 0 → layers sit exactly over the Garage card; 1 → resting on the detail stage.
 * - Car: glides and scales along `progress` (uniform scale; the card and detail profiles share an aspect ratio).
 * - Floor: follows ~8% behind the car, stretching from the card ellipse to the deeper detail ellipse.
 * - Contact shadow: thins and fades while the car is "lifted", then grounds again on landing.
 * - Settle: once landed, a short spring dips the car ~1.5pt and widens the shadow, like suspension taking weight.
 * `scrollOffset` is the live detail scroll position; it only matters while progress < 1 (i.e. while flying back).
 */
export function HeroStage({ px, index, origin, progress, scrollOffset, landed }: {
  px: Px; index: number; origin: Origin | null; progress: SharedValue<number>; scrollOffset: SharedValue<number>; landed: boolean;
}) {
  const { reduced } = useMotion();
  const floor = floors[1], shadow = shadows[1][index], profile = profiles[1][index];
  const car = origin ? fromCard(px, origin, profiles[0][index], profile) : null;
  const ground = origin ? fromCard(px, origin, floors[0], floor) : null;
  const contact = origin ? fromCard(px, origin, shadows[0][index], shadow) : null;
  const settle = useSharedValue(0);
  const dip = px(1.6);
  // Without an origin (deep link), rise into place instead of flying from a card.
  const rise = px(18);

  useEffect(() => {
    if (!landed || reduced) return;
    settle.value = withSequence(withTiming(1, { duration: 150, easing: ease.out }), withSpring(0, springs.settle));
  }, [landed, reduced]);

  const carStyle = useAnimatedStyle(() => {
    const p = progress.value;
    const back = scrollOffset.value;
    if (!car) return { opacity: interpolate(p, [0, 0.6], [0, 1], 'clamp'), transform: [{ translateY: (1 - p) * rise + settle.value * dip }] };
    const s = interpolate(p, [0, 1], [car.sx, 1]);
    // A slight arc: the car rises a few points mid-flight before landing.
    const lift = Math.sin(Math.PI * Math.min(1, Math.max(0, p))) * -dip * 3;
    return {
      transform: [
        { translateX: car.tx * (1 - p) },
        { translateY: (car.ty + back) * (1 - p) + lift + settle.value * dip },
        { scale: s },
      ],
    };
  });

  const floorStyle = useAnimatedStyle(() => {
    const p = interpolate(progress.value, [0.08, 1], [0, 1], 'clamp');
    const back = scrollOffset.value;
    if (!ground) return { opacity: interpolate(progress.value, [0, 0.8], [0, 1], 'clamp') };
    return {
      transform: [
        { translateX: ground.tx * (1 - p) },
        { translateY: (ground.ty + back) * (1 - p) },
        { scaleX: interpolate(p, [0, 1], [ground.sx, 1]) },
        { scaleY: interpolate(p, [0, 1], [ground.sy, 1]) },
      ],
    };
  });

  const shadowStyle = useAnimatedStyle(() => {
    const p = progress.value;
    const back = scrollOffset.value;
    const grounded = interpolate(p, [0, 0.18, 0.78, 1], [1, 0.25, 0.25, 1], 'clamp');
    const squash = 1 + settle.value * 0.05;
    if (!contact) return { opacity: interpolate(p, [0.5, 1], [0, 1], 'clamp'), transform: [{ scaleX: squash }] };
    return {
      opacity: car ? grounded : 1,
      transform: [
        { translateX: contact.tx * (1 - p) },
        { translateY: (contact.ty + back) * (1 - p) },
        { scaleX: interpolate(p, [0, 1], [contact.sx, 1]) * interpolate(grounded, [0.25, 1], [0.82, 1]) * squash },
        { scaleY: interpolate(p, [0, 1], [contact.sy, 1]) },
      ],
    };
  });

  return <View style={place(px, stageBox[1].x, stageBox[1].y, stageBox[1].w, stageBox[1].h)} accessible={false} pointerEvents="none">
    <Animated.View style={[place(px, floor.x, floor.y, floor.w, floor.h), floorStyle]}>
      <SvgXml xml={floorXml[1]} width="100%" height="100%" />
    </Animated.View>
    <Animated.View style={[place(px, shadow.x, shadow.y, shadow.w, shadow.h), shadowStyle]}>
      <SvgXml xml={shadowXml[1][index]} width="100%" height="100%" />
    </Animated.View>
    <Animated.Image source={carImages[index]} resizeMode="contain" accessible={false} style={[place(px, profile.x, profile.y, profile.w, profile.h), carStyle]} />
  </View>;
}
