// Vehicle stage geometry (Final / Light Floor), in design points. Pure TS so tests can check it against the PNGs.

/** Pixel size of each vehicle PNG (asserted against the files in test/vehicleAssets.test.ts). */
export const carPixels: readonly (readonly [number, number])[] = [[1760, 675], [1779, 542], [1759, 649]];
/** Intrinsic width / height of each vehicle PNG. */
export const carAspect = carPixels.map(([w, h]) => w / h);
/** Car width on the detail stage (pt). The card stage draws every car at `cardScale` of it. */
export const detailWidth = [296, 286, 296];
export const cardScale = 0.72;

export type Box = { x: number; y: number; w: number; h: number };

// Stage geometry from Final / Light Floor. Index 0 = Garage card stage (325×121), 1 = detail stage (356×204).
export const stageBox: Box[] = [{ x: 0, y: 0, w: 325, h: 121 }, { x: 17, y: 208, w: 356, h: 204 }];
/** Garage card stage origin inside a card at (16, cardY). */
export const cardStageOffset = { x: 18, y: 70 };
export const cardY = [156, 395, 634];
export const floors: Box[] = [
  { x: 16.5, y: 99.04, w: 292, h: 27 },
  { x: 9, y: 128.12, w: 338, h: 56 },
];
const round2 = (value: number) => Math.round(value * 100) / 100;
/**
 * Car boxes per stage: centred on the stage (card 162.5, detail 178), tyres standing on the contact line
 * (card y 112, detail y 155), width from `detailWidth`, height from the PNG aspect so `contain` fills the box exactly.
 */
const stageCar = [{ cx: 162.5, ground: 112, scale: cardScale }, { cx: 178, ground: 155, scale: 1 }];
export const profiles: Box[][] = stageCar.map(({ cx, ground, scale }) => detailWidth.map((width, i) => {
  const w = round2(width * scale), h = round2(w / carAspect[i]);
  return { x: round2(cx - w / 2), y: round2(ground - h), w, h };
}));
// Contact shadow: the Figma ellipse spans the middle 89% of the car (5.5% inset each side) just above the contact
// line. The SVGs include the layer-blur padding (radius 4 on cards, 6 on detail).
const shadowBand = [{ y: 109, h: 6, blur: 4 }, { y: 152, h: 8, blur: 6 }];
export const shadows: Box[][] = profiles.map((list, mode) => list.map(car => {
  const { y, h, blur } = shadowBand[mode];
  const x = car.x + car.w * 0.055, w = car.w * 0.89;
  return { x: round2(x - blur), y: y - blur, w: round2(w + blur * 2), h: h + blur * 2 };
}));
