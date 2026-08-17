import { T, useGT } from 'gt-react-native';
import { memo, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Fonts, FontSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useDateFormat } from '@/i18n/use-date-format';

import { Avatar } from '@/components/ui';

interface HomeHeaderProps {
  displayName: string;
  profileImageUrl?: string | null;
  onOpenSettings: () => void;
}

const DATE_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  weekday: 'long',
  day: '2-digit',
  month: 'short',
};

function formatEditorialDate(now: Date, format: Intl.DateTimeFormat): string {
  const parts = format.formatToParts(now);
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  const month = parts.find((p) => p.type === 'month')?.value.replace('.', '') ?? '';
  return `${weekday} · ${day} ${month}`;
}

export const HomeHeader = memo(function HomeHeader({
  displayName,
  profileImageUrl,
  onOpenSettings,
}: HomeHeaderProps) {
  const theme = useTheme();
  const gt = useGT();
  const dateFormat = useDateFormat(DATE_FORMAT_OPTIONS);
  const editorialDate = useMemo(() => formatEditorialDate(new Date(), dateFormat), [dateFormat]);

  return (
    <View style={styles.wrapper}>
      <View style={styles.topRow}>
        <View style={styles.eyebrowBlock}>
          <View style={[styles.eyebrowRule, { backgroundColor: theme.accent }]} />
          <Text
            allowFontScaling={false}
            style={[styles.eyebrow, { color: theme.textTertiary }]}
          >
            {editorialDate}
          </Text>
        </View>
        <Pressable
          onPress={onOpenSettings}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={gt('Einstellungen öffnen')}
          style={({ pressed }) => ({
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Avatar name={displayName} imageUrl={profileImageUrl} size="sm" />
        </Pressable>
      </View>

      <View style={styles.titleRow}>
        <Text
          allowFontScaling={false}
          style={[styles.title, { color: theme.text }]}
        >
          beisammen
        </Text>
        <Text
          allowFontScaling={false}
          style={[styles.titleAccent, { color: theme.accent }]}
        >
          .
        </Text>
      </View>

      <T>
        <Text
          allowFontScaling={false}
          style={[styles.subtitle, { color: theme.textSecondary }]}
        >
          Geteilte Momente, für die Menschen, die zählen.
        </Text>
      </T>
    </View>
  );
});

const styles = StyleSheet.create({
  wrapper: {
    paddingVertical: Spacing.xs,
    gap: Spacing.xs,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  eyebrowBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  eyebrowRule: {
    width: 14,
    height: 1.5,
    borderRadius: 1,
  },
  eyebrow: {
    fontFamily: Fonts.body,
    fontSize: FontSize.xs,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: FontSize['2xl'],
    fontWeight: '700',
    letterSpacing: -0.8,
    lineHeight: 34,
  },
  titleAccent: {
    fontFamily: Fonts.display,
    fontSize: FontSize['2xl'],
    fontWeight: '700',
    lineHeight: 34,
  },
  subtitle: {
    fontFamily: Fonts.display,
    fontStyle: 'italic',
    fontSize: FontSize.sm,
    letterSpacing: 0.1,
    marginTop: -2,
  },
});
