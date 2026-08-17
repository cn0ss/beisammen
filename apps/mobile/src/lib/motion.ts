import { Easing } from 'react-native';
import {
  Easing as ReanimatedEasing,
  FadeIn,
  FadeInDown,
  FadeOut,
  LinearTransition,
} from 'react-native-reanimated';

/**
 * Shared motion language ("Warm Editorial" — calm, decisive, never bouncy):
 * one ease-out curve, three durations, capped stagger. All animations run on
 * the UI thread via Reanimated and respect the system reduce-motion setting.
 */
export const MotionDuration = {
  fast: 180,
  base: 300,
  slow: 420,
} as const;

/** Ease-out curve for entrances — fast start, soft landing. */
export const motionEasing = ReanimatedEasing.bezier(0.22, 1, 0.36, 1);

/** RN-core easing twin for the few places still on the Animated API. */
export const legacyMotionEasing = Easing.bezier(0.22, 1, 0.36, 1);

const SECTION_STAGGER_MS = 70;
const LIST_STAGGER_MS = 40;
const MAX_STAGGER_STEPS = 8;

/** Whole-screen or overlay fade. */
export function enterScreen() {
  return FadeIn.duration(MotionDuration.base).easing(motionEasing);
}

/** Page sections: fade + rise with a capped stagger by section index. */
export function enterSection(index = 0) {
  return FadeInDown.duration(MotionDuration.slow)
    .delay(Math.min(index, MAX_STAGGER_STEPS) * SECTION_STAGGER_MS)
    .easing(motionEasing);
}

/** List rows: quicker, tighter stagger; index is capped so long lists never lag. */
export function enterListItem(index = 0) {
  return FadeInDown.duration(MotionDuration.base)
    .delay(Math.min(index, MAX_STAGGER_STEPS) * LIST_STAGGER_MS)
    .easing(motionEasing);
}

/** Default exit for dismissable UI (toasts, banners, inline notices). */
export function exitFade() {
  return FadeOut.duration(MotionDuration.fast);
}

/** Smooth size/position settling when siblings appear or disappear. */
export const settleLayout = LinearTransition.duration(MotionDuration.base);
