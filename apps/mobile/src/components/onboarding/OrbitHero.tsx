import {
  Canvas,
  Circle,
  Group,
  Path,
  RadialGradient,
  RoundedRect,
  Skia,
  vec,
} from '@shopify/react-native-skia';
import { memo, useEffect, useMemo, useRef } from 'react';
import { PanResponder, View } from 'react-native';
import {
  cancelAnimation,
  Easing,
  ReduceMotion,
  useDerivedValue,
  useSharedValue,
  withDecay,
  withDelay,
  withRepeat,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { type ThemeColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const RING_DRAW_MS = 900;
const POP_BASE_DELAY_MS = 480;
const POP_STAGGER_MS = 80;
const AMBIENT_TURN_MS = 40000;
const BREATH_MS = 5600;

/** Vertical squash of the orbit — how "tilted" the 3D ring reads. */
const SQUASH_BASE = 0.42;
const SQUASH_AMPLITUDE = 0.045;
/** How strongly depth scales items (front vs. back of the orbit). */
const DEPTH_SCALE = 0.24;
const DRAG_RAD_PER_PX = 0.012;

interface OrbitItem {
  kind: 'member' | 'memory';
  /** Resting angle on the ring in degrees; -90 = top. */
  angle: number;
  scale: number;
  /** Static rotation for memory cards, like casually scattered photos. */
  tilt: number;
}

const ITEMS: OrbitItem[] = [
  { kind: 'member', angle: -90, scale: 1, tilt: 0 },
  { kind: 'memory', angle: -42, scale: 1, tilt: -0.16 },
  { kind: 'member', angle: 4, scale: 0.84, tilt: 0 },
  { kind: 'member', angle: 52, scale: 1.08, tilt: 0 },
  { kind: 'memory', angle: 104, scale: 0.9, tilt: 0.12 },
  { kind: 'member', angle: 158, scale: 0.92, tilt: 0 },
  { kind: 'memory', angle: 212, scale: 1, tilt: 0.2 },
  { kind: 'member', angle: 266, scale: 1.05, tilt: 0 },
];

interface OrbitNodeProps {
  item: OrbitItem;
  index: number;
  /** Which depth pass this instance renders in; the other pass hides it. */
  layer: 'back' | 'front';
  rotation: SharedValue<number>;
  squash: SharedValue<number>;
  center: number;
  ringRadius: number;
  size: number;
  theme: ThemeColors;
}

function OrbitNode({
  item,
  index,
  layer,
  rotation,
  squash,
  center,
  ringRadius,
  size,
  theme,
}: OrbitNodeProps) {
  const pop = useSharedValue(0);

  useEffect(() => {
    pop.value = withDelay(
      POP_BASE_DELAY_MS + index * POP_STAGGER_MS,
      withSpring(1, {
        damping: 12,
        stiffness: 220,
        mass: 0.7,
        reduceMotion: ReduceMotion.System,
      }),
    );
  }, [index, pop]);

  const baseAngle = (item.angle * Math.PI) / 180;
  const dotRadius = size * 0.05 * item.scale;
  const cardWidth = size * 0.13 * item.scale;
  const cardHeight = size * 0.165 * item.scale;

  // Fake-3D projection: depth = sin(angle); items low on the ellipse are
  // near (larger, opaque), items high on it are far (smaller, dimmer).
  const depth = useDerivedValue(() => Math.sin(baseAngle + rotation.value), [baseAngle]);
  const cx = useDerivedValue(
    () => center + Math.cos(baseAngle + rotation.value) * ringRadius,
    [baseAngle, center, ringRadius],
  );
  const cy = useDerivedValue(
    () => center + depth.value * ringRadius * squash.value,
    [center, ringRadius],
  );
  const depthScale = useDerivedValue(
    () => (1 + depth.value * DEPTH_SCALE) * Math.max(pop.value, 0),
    [],
  );
  const opacity = useDerivedValue(() => {
    const inLayer = layer === 'front' ? depth.value >= 0 : depth.value < 0;
    if (!inLayer) {
      return 0;
    }
    return (0.42 + 0.58 * (depth.value + 1) / 2) * Math.min(pop.value, 1);
  }, [layer]);

  if (item.kind === 'member') {
    const memberColors = [theme.primary, theme.accent, theme.textTertiary];

    return (
      <MemberDot
        cx={cx}
        cy={cy}
        dotRadius={dotRadius}
        depthScale={depthScale}
        opacity={opacity}
        color={memberColors[index % memberColors.length] ?? theme.primary}
      />
    );
  }

  return (
    <MemoryCard
      cx={cx}
      cy={cy}
      tilt={item.tilt}
      depthScale={depthScale}
      opacity={opacity}
      cardWidth={cardWidth}
      cardHeight={cardHeight}
      photoColor={index % 2 === 0 ? theme.primaryMuted : theme.accentMuted}
      theme={theme}
    />
  );
}

function MemberDot({
  cx,
  cy,
  dotRadius,
  depthScale,
  opacity,
  color,
}: {
  cx: SharedValue<number>;
  cy: SharedValue<number>;
  dotRadius: number;
  depthScale: SharedValue<number>;
  opacity: SharedValue<number>;
  color: string;
}) {
  const haloRadius = useDerivedValue(() => dotRadius * 2.1 * depthScale.value, [dotRadius]);
  const r = useDerivedValue(() => dotRadius * depthScale.value, [dotRadius]);
  const haloOpacity = useDerivedValue(() => opacity.value * 0.22, []);

  return (
    <>
      <Circle cx={cx} cy={cy} r={haloRadius} color={color} opacity={haloOpacity} />
      <Circle cx={cx} cy={cy} r={r} color={color} opacity={opacity} />
    </>
  );
}

function MemoryCard({
  cx,
  cy,
  tilt,
  depthScale,
  opacity,
  cardWidth,
  cardHeight,
  photoColor,
  theme,
}: {
  cx: SharedValue<number>;
  cy: SharedValue<number>;
  tilt: number;
  depthScale: SharedValue<number>;
  opacity: SharedValue<number>;
  cardWidth: number;
  cardHeight: number;
  photoColor: string;
  theme: ThemeColors;
}) {
  const transform = useDerivedValue(
    () => [
      { translateX: cx.value },
      { translateY: cy.value },
      { rotate: tilt },
      { scale: depthScale.value },
    ],
    [tilt],
  );

  // A tiny "polaroid": surface frame with a tinted photo area.
  return (
    <Group transform={transform} opacity={opacity}>
      <RoundedRect
        x={-cardWidth / 2}
        y={-cardHeight / 2}
        width={cardWidth}
        height={cardHeight}
        r={3}
        color={theme.surface}
      />
      <RoundedRect
        x={-cardWidth / 2}
        y={-cardHeight / 2}
        width={cardWidth}
        height={cardHeight}
        r={3}
        style="stroke"
        strokeWidth={1}
        color={theme.border}
      />
      <RoundedRect
        x={-cardWidth / 2 + cardWidth * 0.11}
        y={-cardHeight / 2 + cardWidth * 0.11}
        width={cardWidth * 0.78}
        height={cardHeight * 0.62}
        r={2}
        color={photoColor}
      />
    </Group>
  );
}

interface OrbitHeroProps {
  size?: number;
}

/**
 * Interactive 3D orbit hero: members and shared memories circle the warm
 * core on a tilted, breathing ring with real depth (near items are larger
 * and pass in front of the core, far ones recede behind it). A horizontal
 * flick spins the orbit with momentum before it settles back into its
 * ambient drift.
 */
export const OrbitHero = memo(function OrbitHero({ size = 210 }: OrbitHeroProps) {
  const theme = useTheme();
  const center = size / 2;
  const ringRadius = size * 0.4;

  const ringEnd = useSharedValue(0);
  const ambient = useSharedValue(0);
  const spin = useSharedValue(0);
  const breath = useSharedValue(0);

  useEffect(() => {
    ringEnd.value = withTiming(1, {
      duration: RING_DRAW_MS,
      easing: Easing.out(Easing.cubic),
      reduceMotion: ReduceMotion.System,
    });
    ambient.value = withRepeat(
      withTiming(Math.PI * 2, {
        duration: AMBIENT_TURN_MS,
        easing: Easing.linear,
        reduceMotion: ReduceMotion.System,
      }),
      -1,
      false,
    );
    breath.value = withRepeat(
      withTiming(1, {
        duration: BREATH_MS,
        easing: Easing.inOut(Easing.sin),
        reduceMotion: ReduceMotion.System,
      }),
      -1,
      true,
    );
  }, [ambient, breath, ringEnd]);

  const rotation = useDerivedValue(() => ambient.value + spin.value, []);
  const squash = useDerivedValue(
    () => SQUASH_BASE + (breath.value - 0.5) * 2 * SQUASH_AMPLITUDE,
    [],
  );
  const ringTransform = useDerivedValue(
    () => [{ scaleY: squash.value }],
    [],
  );

  const ringPath = useMemo(() => {
    const path = Skia.Path.Make();
    const inset = center - ringRadius;
    path.addArc(
      { x: inset, y: inset, width: ringRadius * 2, height: ringRadius * 2 },
      -90,
      360,
    );
    return path;
  }, [center, ringRadius]);

  const lastDx = useRef(0);
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dx) > 6 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderGrant: () => {
          lastDx.current = 0;
          cancelAnimation(spin);
        },
        onPanResponderMove: (_event, gesture) => {
          spin.value += (gesture.dx - lastDx.current) * DRAG_RAD_PER_PX;
          lastDx.current = gesture.dx;
        },
        onPanResponderRelease: (_event, gesture) => {
          lastDx.current = 0;
          spin.value = withDecay({
            velocity: gesture.vx * 1000 * DRAG_RAD_PER_PX,
            deceleration: 0.9985,
          });
        },
        onPanResponderTerminate: () => {
          lastDx.current = 0;
        },
      }),
    [spin],
  );

  return (
    <View
      style={{ width: size, height: size }}
      accessibilityElementsHidden
      {...panResponder.panHandlers}
    >
      <Canvas style={{ width: size, height: size }}>
        <Group transform={ringTransform} origin={vec(center, center)}>
          <Path
            path={ringPath}
            style="stroke"
            strokeWidth={2}
            strokeCap="round"
            color={theme.border}
            start={0}
            end={ringEnd}
          />
        </Group>

        {ITEMS.map((item, index) => (
          <OrbitNode
            key={`back-${item.angle}`}
            item={item}
            index={index}
            layer="back"
            rotation={rotation}
            squash={squash}
            center={center}
            ringRadius={ringRadius}
            size={size}
            theme={theme}
          />
        ))}

        <Circle cx={center} cy={center} r={size * 0.17}>
          <RadialGradient
            c={vec(center, center)}
            r={size * 0.17}
            colors={[theme.primaryMuted, 'transparent']}
          />
        </Circle>
        <Circle cx={center} cy={center} r={size * 0.07} color={theme.primaryMuted} />
        <Circle cx={center} cy={center} r={size * 0.036} color={theme.primary} />

        {ITEMS.map((item, index) => (
          <OrbitNode
            key={`front-${item.angle}`}
            item={item}
            index={index}
            layer="front"
            rotation={rotation}
            squash={squash}
            center={center}
            ringRadius={ringRadius}
            size={size}
            theme={theme}
          />
        ))}
      </Canvas>
    </View>
  );
});
