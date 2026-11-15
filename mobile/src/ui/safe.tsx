import { PixelRatio, type ScrollViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { bottomPadding, canvasHeight, topShift } from './safeArea';
import { usePx } from './theme';

/**
 * Safe-area values for a screen, from the root SafeAreaProvider. Every screen reads the same numbers, so the
 * Garage card and the vehicle detail stage share one coordinate shift and the hero flight between them cancels it out.
 */
export function useSafeFrame() {
  const insets = useSafeAreaInsets();
  const px = usePx();
  // Pixel-aligned so a shifted absolute layout rounds exactly like the unshifted one (see stage.drawnRect).
  const top = topShift(px, insets.top, PixelRatio.roundToNearestPixel);
  /** Props for every full-screen scroll view: no automatic insets, indicators kept clear of the status bar and home indicator. */
  const scroll: Pick<ScrollViewProps, 'contentInsetAdjustmentBehavior' | 'automaticallyAdjustsScrollIndicatorInsets' | 'scrollIndicatorInsets'> = {
    contentInsetAdjustmentBehavior: 'never',
    automaticallyAdjustsScrollIndicatorInsets: false,
    scrollIndicatorInsets: { top: insets.top, bottom: insets.bottom, left: 0, right: 0 },
  };
  return {
    insets,
    top,
    scroll,
    canvasHeight: (frameHeight: number, contentBottom: number) => canvasHeight(px, insets, frameHeight, contentBottom, PixelRatio.roundToNearestPixel),
    bottomPadding: (design: number) => bottomPadding(px, insets.bottom, design),
  };
}
