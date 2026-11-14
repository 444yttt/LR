import { createContext, useContext, useEffect, useState } from 'react';
import { Text, useWindowDimensions, type TextStyle } from 'react-native';

// Final / Light Floor tokens (see /figma SPEC.md). No other fills are used on screens.
export const page = '#F8F8F7';
export const ink = '#1B1D20';
export const mute = '#73777D';
export const rule = '#E3E5E6';
export const white = '#FFFFFF';
/** Skeleton base: between canvas and rule so loading bars read as placeholders, not content. */
export const skeleton = '#EFEFEE';
export const regular = 'Inter_400Regular';
export const medium = 'Inter_500Medium';
export const semibold = 'Inter_600SemiBold';
export const designWidth = 390;
// Inter typo ascender 1984 + descender 494, unitsPerEm 2048. Cap tops then sit ~0.241em below the line top.
export const interLine = (1984 + 494) / 2048;

export type Px = (value: number) => number;

export function usePx(): Px {
  const { width } = useWindowDimensions();
  const scale = width > 0 ? width / designWidth : 1;
  return (value) => value * scale;
}

export function place(px: Px, x: number, y: number, w?: number, h?: number, radius?: number) {
  return {
    position: 'absolute' as const,
    left: px(x),
    top: px(y),
    width: w === undefined ? undefined : px(w),
    height: h === undefined ? undefined : px(h),
    borderRadius: radius === undefined ? undefined : px(radius),
  };
}

export function typeStyle(px: Px, size: number, font: string, color: string, extra?: TextStyle): TextStyle {
  return { fontFamily: font, fontSize: px(size), lineHeight: px(size * interLine), color, letterSpacing: 0, ...extra };
}

export function At({ px, value, x, y, size, font = regular, color = ink, width }: { px: Px; value: string; x: number; y: number; size: number; font?: string; color?: string; width?: number }) {
  return <Text style={typeStyle(px, size, font, color, { position: 'absolute', left: px(x), top: px(y), width: width === undefined ? undefined : px(width) })}>{value}</Text>;
}

/** Wall clock that ticks so "updated X ago" stays current while a screen is open. */
const NowContext = createContext(Date.now());
export const useNow = () => useContext(NowContext);

export function NowProvider({ children, interval = 30_000 }: { children: React.ReactNode; interval?: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(id);
  }, [interval]);
  return <NowContext.Provider value={now}>{children}</NowContext.Provider>;
}
