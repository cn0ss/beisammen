import { memo, type ReactNode } from 'react';
import {
  Pressable,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

const AnimatedPressableBase = Animated.createAnimatedComponent(Pressable);

/** Snappy, non-bouncy press spring shared by every tappable surface. */
const PRESS_SPRING = {
  damping: 22,
  stiffness: 380,
  mass: 0.7,
} as const;

interface AnimatedPressableProps extends Omit<PressableProps, 'style' | 'children'> {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Scale while pressed; keep between 0.96 and 0.99. */
  pressedScale?: number;
  /** Opacity while pressed; set to 1 to disable the dim. */
  pressedOpacity?: number;
}

/**
 * Pressable with UI-thread spring feedback (scale + subtle dim). Use for
 * every custom tappable surface instead of hand-rolled pressed styles.
 */
export const AnimatedPressable = memo(function AnimatedPressable({
  children,
  style,
  pressedScale = 0.97,
  pressedOpacity = 0.9,
  onPressIn,
  onPressOut,
  disabled,
  ...rest
}: AnimatedPressableProps) {
  const pressed = useSharedValue(0);
  const isDisabled = disabled === true;

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: 1 - pressed.value * (1 - pressedScale) },
    ],
    opacity: isDisabled ? 0.6 : 1 - pressed.value * (1 - pressedOpacity),
  }));

  return (
    <AnimatedPressableBase
      {...rest}
      disabled={disabled}
      onPressIn={(event: GestureResponderEvent) => {
        pressed.value = withSpring(1, PRESS_SPRING);
        onPressIn?.(event);
      }}
      onPressOut={(event: GestureResponderEvent) => {
        pressed.value = withSpring(0, PRESS_SPRING);
        onPressOut?.(event);
      }}
      style={[style, animatedStyle]}
    >
      {children}
    </AnimatedPressableBase>
  );
});
