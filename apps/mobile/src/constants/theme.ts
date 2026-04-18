/**
 * Beisammen Design System
 *
 * "Warm Editorial" — intimate family app meets refined magazine aesthetic.
 * Georgia serif for headings, system sans for body, deep forest green primary,
 * warm ivory surfaces, terracotta accents.
 */

import { Platform } from 'react-native';

export const Colors = {
  light: {
    // Backgrounds
    background: '#F7F5F0',
    surface: '#FFFFFF',
    surfacePressed: '#F2EFEA',

    // Text
    text: '#1C1C1E',
    textSecondary: '#6B6B6F',
    textTertiary: '#A0A0A5',

    // Primary — deep forest green
    primary: '#1B6B45',
    primaryText: '#FFFFFF',
    primaryMuted: '#E4F2EB',

    // Accent — warm terracotta
    accent: '#C2703E',
    accentMuted: '#FDF0E8',

    // Utility
    border: '#E5E2DC',
    borderLight: '#EEEBE6',
    separator: '#E5E2DC',
    danger: '#C0392B',
    dangerMuted: '#FDECEC',

    // Tab bar
    tabBar: '#FFFFFF',
    tabBarBorder: '#E5E2DC',
    tabActive: '#1B6B45',
    tabInactive: '#A0A0A5',
  },
  dark: {
    // Backgrounds
    background: '#0C0C0E',
    surface: '#1C1C1E',
    surfacePressed: '#2C2C2E',

    // Text
    text: '#F5F3EF',
    textSecondary: '#98989D',
    textTertiary: '#636366',

    // Primary
    primary: '#3EBD7A',
    primaryText: '#0C0C0E',
    primaryMuted: '#142920',

    // Accent
    accent: '#E08A54',
    accentMuted: '#2A1E14',

    // Utility
    border: '#2C2C2E',
    borderLight: '#1C1C1E',
    separator: '#2C2C2E',
    danger: '#E74C3C',
    dangerMuted: '#2A1414',

    // Tab bar
    tabBar: '#1C1C1E',
    tabBarBorder: '#2C2C2E',
    tabActive: '#3EBD7A',
    tabInactive: '#636366',
  },
} as const;

export type ThemeColors = { [K in keyof typeof Colors.light]: string };
export type ThemeColor = keyof typeof Colors.light;

export const Fonts = {
  /** Warm serif for display headings */
  display: Platform.select({
    ios: 'Georgia',
    android: 'serif',
    default: 'Georgia, serif',
  }) as string,
  /** System sans for body text */
  body: Platform.select({
    ios: 'System',
    android: 'normal',
    default: 'system-ui, -apple-system, sans-serif',
  }) as string,
  /** Monospaced for code/technical info */
  mono: Platform.select({
    ios: 'Menlo',
    android: 'monospace',
    default: 'ui-monospace, monospace',
  }) as string,
};

export const FontSize = {
  xs: 11,
  sm: 13,
  base: 15,
  md: 17,
  lg: 20,
  xl: 24,
  '2xl': 30,
  '3xl': 36,
} as const;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  '2xl': 32,
  '3xl': 48,
  '4xl': 64,
} as const;

export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  full: 999,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
