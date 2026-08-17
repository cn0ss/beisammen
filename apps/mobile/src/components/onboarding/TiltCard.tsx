import Ionicons from '@expo/vector-icons/Ionicons';
import { Canvas, LinearGradient, RoundedRect, vec } from '@shopify/react-native-skia';
import { memo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { Fonts, FontSize, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';

/** Maximum tilt toward the touch point, in degrees — felt, not seen. */
const MAX_TILT_DEG = 4;
const SHEEN_DURATION_MS = 700;

const TILT_SPRING = {
  damping: 16,
  stiffness: 260,
  mass: 0.6,
  reduceMotion: ReduceMotion.System,
} as const;

function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

interface TiltCardProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  emphasized?: boolean;
  onPress: () => void;
}

/**
 * Choice card with dimensional press feedback: it pitches toward the touch
 * point in perspective while a warm sheen sweeps across the surface. Falls
 * back to a plain press under reduced motion.
 */
export const TiltCard = memo(function TiltCard({
  icon,
  title,
  description,
  emphasized = false,
  onPress,
}: TiltCardProps) {
  const theme = useTheme();
  const isDark = useColorScheme() === 'dark';
  const reducedMotion = useReducedMotion();
  const [layout, setLayout] = useState({ width: 0, height: 0 });

  const rotateX = useSharedValue(0);
  const rotateY = useSharedValue(0);
  const scale = useSharedValue(1);
  const sheen = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { perspective: 750 },
      { rotateX: `${rotateX.value}deg` },
      { rotateY: `${rotateY.value}deg` },
      { scale: scale.value },
    ],
  }));

  const handlePressIn = (event: GestureResponderEvent) => {
    scale.value = withSpring(0.985, TILT_SPRING);
    sheen.value = 0;
    sheen.value = withTiming(1, {
      duration: SHEEN_DURATION_MS,
      easing: Easing.out(Easing.cubic),
      reduceMotion: ReduceMotion.System,
    });

    if (reducedMotion || layout.width === 0 || layout.height === 0) {
      return;
    }

    const nx = (event.nativeEvent.locationX / layout.width - 0.5) * 2;
    const ny = (event.nativeEvent.locationY / layout.height - 0.5) * 2;
    rotateY.value = withSpring(nx * MAX_TILT_DEG, TILT_SPRING);
    rotateX.value = withSpring(-ny * MAX_TILT_DEG, TILT_SPRING);
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, TILT_SPRING);
    rotateX.value = withSpring(0, TILT_SPRING);
    rotateY.value = withSpring(0, TILT_SPRING);
  };

  const handleLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setLayout((current) =>
      current.width === width && current.height === height ? current : { width, height },
    );
  };

  const bandWidth = layout.width * 0.55;
  const sheenStart = useDerivedValue(
    () => vec(-bandWidth + sheen.value * (layout.width + 2 * bandWidth), 0),
    [bandWidth, layout.width],
  );
  const sheenEnd = useDerivedValue(
    () => vec(sheenStart.value.x + bandWidth, layout.height),
    [bandWidth, layout.height],
  );

  const sheenTint = isDark ? 'rgba(255, 255, 255, 0.06)' : withAlpha(theme.accent, 0.09);

  return (
    <Animated.View style={animatedStyle}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onLayout={handleLayout}
        style={[
          styles.card,
          {
            backgroundColor: theme.surface,
            borderColor: emphasized ? theme.primary : theme.borderLight,
          },
        ]}
      >
        {layout.width > 0 && layout.height > 0 ? (
          <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
            <RoundedRect
              x={0}
              y={0}
              width={layout.width}
              height={layout.height}
              r={Radius.lg - 1.5}
            >
              <LinearGradient
                start={sheenStart}
                end={sheenEnd}
                colors={['transparent', sheenTint, 'transparent']}
              />
            </RoundedRect>
          </Canvas>
        ) : null}
        <View
          style={[
            styles.icon,
            { backgroundColor: emphasized ? theme.primary : theme.primaryMuted },
          ]}
        >
          <Ionicons name={icon} size={22} color={emphasized ? theme.primaryText : theme.primary} />
        </View>
        <View style={styles.copy}>
          <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
          <Text style={[styles.body, { color: theme.textSecondary }]}>{description}</Text>
        </View>
        <Ionicons name="chevron-forward-outline" size={18} color={theme.textTertiary} />
      </Pressable>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    borderWidth: 1.5,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    overflow: 'hidden',
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
    gap: 3,
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: FontSize.md,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  body: {
    fontSize: FontSize.sm,
    lineHeight: 20,
  },
});
