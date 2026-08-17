import { Canvas, Fill, Shader, Skia, useClock } from '@shopify/react-native-skia';
import { memo, useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { useDerivedValue, useReducedMotion } from 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';

/** Frozen shader time under reduced motion — picked for a balanced composition. */
const STILL_TIME_S = 9.4;

const FIELD_SKSL = `
uniform float uTime;
uniform float2 uSize;
uniform float3 uBase;
uniform float3 uPrimary;
uniform float3 uAccent;
uniform float uIntensity;

float hash(float2 p) {
  return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453);
}

half4 main(float2 xy) {
  float2 uv = xy / uSize;
  float aspect = uSize.x / uSize.y;
  float2 st = float2(uv.x * aspect, uv.y);
  float t = uTime;

  // Gentle domain warp so the color fields flow instead of sliding.
  float2 w = st + 0.045 * float2(
    sin(t * 0.32 + st.y * 3.4),
    cos(t * 0.26 + st.x * 4.1)
  );

  float2 pA = float2(aspect * (0.24 + 0.07 * sin(t * 0.21)), 0.20 + 0.05 * cos(t * 0.17));
  float2 pB = float2(aspect * (0.80 - 0.06 * sin(t * 0.19)), 0.34 + 0.07 * sin(t * 0.23));
  float2 pC = float2(aspect * (0.52 + 0.09 * cos(t * 0.15)), 1.04);

  float a = smoothstep(0.62, 0.0, distance(w, pA));
  float b = smoothstep(0.55, 0.0, distance(w, pB));
  float c = smoothstep(0.78, 0.0, distance(w, pC));

  float3 col = uBase;
  col = mix(col, uPrimary, a * 0.16 * uIntensity);
  col = mix(col, uAccent, b * 0.14 * uIntensity);
  col = mix(col, uPrimary, c * 0.10 * uIntensity);

  // Fine film grain keeps the field organic instead of airbrushed.
  float g = (hash(xy + floor(t * 8.0)) - 0.5) * 0.02;
  col += g;

  return half4(half3(col), 1.0);
}
`;

const fieldEffect = Skia.RuntimeEffect.Make(FIELD_SKSL);

function hexToVec3(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  return [
    parseInt(value.slice(0, 2), 16) / 255,
    parseInt(value.slice(2, 4), 16) / 255,
    parseInt(value.slice(4, 6), 16) / 255,
  ];
}

/**
 * Full-bleed SkSL color field: the theme background with two warm gradient
 * pools drifting through it plus film grain. Runs entirely on the GPU;
 * time freezes to a fixed composition under reduced motion.
 */
export const DriftFieldBackdrop = memo(function DriftFieldBackdrop() {
  const theme = useTheme();
  const isDark = useColorScheme() === 'dark';
  const reducedMotion = useReducedMotion();
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  const clock = useClock();

  const palette = useMemo(
    () => ({
      base: hexToVec3(theme.background),
      primary: hexToVec3(theme.primary),
      accent: hexToVec3(theme.accent),
    }),
    [theme.accent, theme.background, theme.primary],
  );

  const uniforms = useDerivedValue(
    () => ({
      uTime: reducedMotion ? STILL_TIME_S : clock.value / 1000,
      uSize: [layout.width, layout.height],
      uBase: palette.base,
      uPrimary: palette.primary,
      uAccent: palette.accent,
      uIntensity: isDark ? 0.65 : 1,
    }),
    [isDark, layout.height, layout.width, palette, reducedMotion],
  );

  const handleLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setLayout((current) =>
      current.width === width && current.height === height ? current : { width, height },
    );
  };

  if (!fieldEffect) {
    return null;
  }

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      accessibilityElementsHidden
      onLayout={handleLayout}
    >
      {layout.width > 0 && layout.height > 0 ? (
        <Canvas style={StyleSheet.absoluteFill}>
          <Fill>
            <Shader source={fieldEffect} uniforms={uniforms} />
          </Fill>
        </Canvas>
      ) : null}
    </View>
  );
});
