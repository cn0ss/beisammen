import {
  ReduceMotion,
  withDelay,
  withTiming,
  type EntryExitAnimationFunction,
} from 'react-native-reanimated';

import { MotionDuration, motionEasing } from '@/lib/motion';

const ENTER_TIMING = {
  duration: MotionDuration.slow,
  easing: motionEasing,
  reduceMotion: ReduceMotion.System,
} as const;

const STAGGER_MS = 85;
const MAX_STAGGER_STEPS = 6;

/**
 * Depth entrance for onboarding sections: content arrives from below with a
 * slight perspective pitch, as if a card is being laid onto the table. Use
 * instead of enterSection on this screen so mode switches read as moving
 * through space rather than fading in place.
 */
export function enterDepth(index = 0): EntryExitAnimationFunction {
  const delayMs = Math.min(index, MAX_STAGGER_STEPS) * STAGGER_MS;

  return () => {
    'worklet';
    return {
      initialValues: {
        opacity: 0,
        transform: [
          { perspective: 1000 },
          { translateY: 34 },
          { rotateX: '-8deg' },
          { scale: 0.96 },
        ],
      },
      animations: {
        opacity: withDelay(delayMs, withTiming(1, ENTER_TIMING)),
        transform: [
          { perspective: 1000 },
          { translateY: withDelay(delayMs, withTiming(0, ENTER_TIMING)) },
          { rotateX: withDelay(delayMs, withTiming('0deg', ENTER_TIMING)) },
          { scale: withDelay(delayMs, withTiming(1, ENTER_TIMING)) },
        ],
      },
    };
  };
}
