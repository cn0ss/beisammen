import type { PropsWithChildren, ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  useColorScheme,
  View,
  type ColorSchemeName,
  type ViewStyle,
} from 'react-native';

// ---------------------------------------------------------------------------
//  Design Tokens — synced with apps/mobile/src/constants/theme.ts
// ---------------------------------------------------------------------------

const palette = {
  light: {
    background: '#F7F5F0',
    surface: '#FFFFFF',
    surfacePressed: '#F2EFEA',
    text: '#1C1C1E',
    textSecondary: '#6B6B6F',
    textTertiary: '#A0A0A5',
    primary: '#1B6B45',
    primaryText: '#FFFFFF',
    primaryMuted: '#E4F2EB',
    accent: '#C2703E',
    accentMuted: '#FDF0E8',
    border: '#E5E2DC',
    danger: '#C0392B',
  },
  dark: {
    background: '#0C0C0E',
    surface: '#1C1C1E',
    surfacePressed: '#2C2C2E',
    text: '#F5F3EF',
    textSecondary: '#98989D',
    textTertiary: '#636366',
    primary: '#3EBD7A',
    primaryText: '#0C0C0E',
    primaryMuted: '#142920',
    accent: '#E08A54',
    accentMuted: '#2A1E14',
    border: '#2C2C2E',
    danger: '#E74C3C',
  },
} as const;

type Palette = {
  background: string;
  surface: string;
  surfacePressed: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  primary: string;
  primaryText: string;
  primaryMuted: string;
  accent: string;
  accentMuted: string;
  border: string;
  danger: string;
};

// ---------------------------------------------------------------------------
//  Theme resolution — reads system color scheme via useColorScheme().
//  An explicit `colorScheme` prop overrides the system value.
// ---------------------------------------------------------------------------

function useResolvedScheme(override: ColorSchemeName | undefined): 'light' | 'dark' {
  const system = useColorScheme();
  if (override === 'dark' || override === 'light') return override;
  return system === 'dark' ? 'dark' : 'light';
}

function t(scheme: 'light' | 'dark'): Palette {
  return scheme === 'dark' ? palette.dark : palette.light;
}

// ---------------------------------------------------------------------------
//  Screen
// ---------------------------------------------------------------------------

export function Screen({
  children,
  colorScheme,
}: PropsWithChildren<{ colorScheme?: ColorSchemeName }>) {
  const scheme = useResolvedScheme(colorScheme);
  const c = t(scheme);
  return <View style={[styles.screen, { backgroundColor: c.background }]}>{children}</View>;
}

// ---------------------------------------------------------------------------
//  Section
// ---------------------------------------------------------------------------

export function Section({
  title,
  subtitle,
  children,
  colorScheme,
}: PropsWithChildren<{
  title: string;
  subtitle?: string;
  colorScheme?: ColorSchemeName;
}>) {
  const scheme = useResolvedScheme(colorScheme);
  const c = t(scheme);
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: c.text }]}>{title}</Text>
      {subtitle ? (
        <Text style={[styles.sectionSubtitle, { color: c.textSecondary }]}>
          {subtitle}
        </Text>
      ) : null}
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

// ---------------------------------------------------------------------------
//  Surface
// ---------------------------------------------------------------------------

export function Surface({
  eyebrow,
  title,
  description,
  children,
  colorScheme,
  style,
}: PropsWithChildren<{
  eyebrow?: string;
  title: string;
  description?: string;
  colorScheme?: ColorSchemeName;
  style?: ViewStyle;
}>) {
  const scheme = useResolvedScheme(colorScheme);
  const c = t(scheme);
  return (
    <View
      style={[
        styles.surface,
        {
          backgroundColor: c.surface,
          shadowColor: scheme === 'dark' ? '#000' : '#8B8680',
        },
        style,
      ]}
    >
      {eyebrow ? (
        <Text style={[styles.eyebrow, { color: c.accent }]}>{eyebrow}</Text>
      ) : null}
      <Text style={[styles.surfaceTitle, { color: c.text }]}>{title}</Text>
      {description ? (
        <Text style={[styles.surfaceDescription, { color: c.textSecondary }]}>
          {description}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

// ---------------------------------------------------------------------------
//  Pill
// ---------------------------------------------------------------------------

export function Pill({
  children,
  variant = 'default',
  colorScheme,
}: PropsWithChildren<{
  variant?: 'default' | 'primary' | 'accent';
  colorScheme?: ColorSchemeName;
}>) {
  const scheme = useResolvedScheme(colorScheme);
  const c = t(scheme);

  const bg =
    variant === 'primary'
      ? c.primaryMuted
      : variant === 'accent'
        ? c.accentMuted
        : scheme === 'dark'
          ? '#2C2C2E'
          : '#F0EDE8';

  const fg =
    variant === 'primary'
      ? c.primary
      : variant === 'accent'
        ? c.accent
        : c.textSecondary;

  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[styles.pillText, { color: fg }]}>{children}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
//  PrimaryButton
// ---------------------------------------------------------------------------

export function PrimaryButton({
  label,
  hint,
  onPress,
  variant = 'primary',
  colorScheme,
}: {
  label: string;
  hint?: ReactNode;
  onPress?: () => void;
  variant?: 'primary' | 'outline' | 'danger';
  colorScheme?: ColorSchemeName;
}) {
  const scheme = useResolvedScheme(colorScheme);
  const c = t(scheme);

  const bgColor =
    variant === 'danger'
      ? c.danger
      : variant === 'outline'
        ? 'transparent'
        : c.primary;

  const textColor =
    variant === 'outline' ? c.primary : c.primaryText;

  const borderColor = variant === 'outline' ? c.border : 'transparent';

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: bgColor,
          borderColor,
          borderWidth: variant === 'outline' ? 1.5 : 0,
          opacity: pressed ? 0.85 : 1,
          transform: [{ scale: pressed ? 0.985 : 1 }],
        },
      ]}
    >
      <Text style={[styles.buttonLabel, { color: textColor }]}>{label}</Text>
      {hint ? <View>{hint}</View> : null}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
//  SecondaryButton
// ---------------------------------------------------------------------------

export function SecondaryButton({
  label,
  onPress,
  colorScheme,
}: {
  label: string;
  onPress?: () => void;
  colorScheme?: ColorSchemeName;
}) {
  const scheme = useResolvedScheme(colorScheme);
  const c = t(scheme);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.secondaryBtn,
        { opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Text style={[styles.secondaryBtnLabel, { color: c.primary }]}>
        {label}
      </Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
//  Divider
// ---------------------------------------------------------------------------

export function Divider({ colorScheme }: { colorScheme?: ColorSchemeName }) {
  const scheme = useResolvedScheme(colorScheme);
  const c = t(scheme);
  return <View style={[styles.divider, { backgroundColor: c.border }]} />;
}

// ---------------------------------------------------------------------------
//  Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },

  // Section
  section: {
    gap: 8,
  },
  sectionTitle: {
    fontFamily: 'Georgia',
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  sectionSubtitle: {
    fontSize: 15,
    lineHeight: 22,
    letterSpacing: -0.1,
  },
  sectionBody: {
    gap: 12,
    marginTop: 4,
  },

  // Surface
  surface: {
    gap: 6,
    padding: 20,
    borderRadius: 16,
    // iOS shadow
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    // Android elevation
    elevation: 2,
  },
  eyebrow: {
    textTransform: 'uppercase',
    letterSpacing: 1.6,
    fontSize: 11,
    fontWeight: '700',
  },
  surfaceTitle: {
    fontFamily: 'Georgia',
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  surfaceDescription: {
    fontSize: 14,
    lineHeight: 21,
    letterSpacing: -0.1,
  },

  // Pill
  pill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  pillText: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.2,
  },

  // Button
  button: {
    gap: 4,
    borderRadius: 14,
    paddingHorizontal: 20,
    paddingVertical: 15,
    alignItems: 'center',
  },
  buttonLabel: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
  },

  // Secondary button
  secondaryBtn: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  secondaryBtnLabel: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: -0.1,
  },

  // Divider
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 4,
  },
});
