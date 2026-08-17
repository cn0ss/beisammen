import Ionicons from '@expo/vector-icons/Ionicons';
import { memo, useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';

import { FontSize, Radius, Spacing } from '@/constants/theme';
import { MotionDuration, motionEasing } from '@/lib/motion';
import { useTheme } from '@/hooks/use-theme';

interface FeedbackToastProps {
  message: string | null;
  type?: 'info' | 'success' | 'error';
  autoDismissMs?: number;
  onDismiss: () => void;
}

export const FeedbackToast = memo(function FeedbackToast({
  message,
  type = 'info',
  autoDismissMs = 3500,
  onDismiss,
}: FeedbackToastProps) {
  const theme = useTheme();
  const dismissTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (dismissTimeoutRef.current) {
      clearTimeout(dismissTimeoutRef.current);
      dismissTimeoutRef.current = null;
    }

    if (message) {
      dismissTimeoutRef.current = setTimeout(onDismiss, autoDismissMs);
    }

    return () => {
      if (dismissTimeoutRef.current) {
        clearTimeout(dismissTimeoutRef.current);
        dismissTimeoutRef.current = null;
      }
    };
  }, [autoDismissMs, message, onDismiss]);

  if (!message) return null;

  const colorMap = {
    info: { bg: theme.primaryMuted, fg: theme.primary, icon: 'information-circle' as const },
    success: { bg: theme.primaryMuted, fg: theme.primary, icon: 'checkmark-circle' as const },
    error: { bg: theme.dangerMuted, fg: theme.danger, icon: 'alert-circle' as const },
  };
  const colors = colorMap[type];

  return (
    <Animated.View
      entering={FadeInDown.duration(MotionDuration.base).easing(motionEasing)}
      exiting={FadeOutDown.duration(MotionDuration.fast)}
    >
      <Pressable
        onPress={onDismiss}
        style={[styles.container, { backgroundColor: colors.bg }]}
      >
        <Ionicons name={colors.icon} size={18} color={colors.fg} />
        <Text style={[styles.text, { color: colors.fg }]}>{message}</Text>
        <Ionicons name="close" size={14} color={colors.fg} style={styles.dismiss} />
      </Pressable>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.md,
  },
  text: {
    flex: 1,
    fontSize: FontSize.sm,
    lineHeight: 20,
    fontWeight: '600',
  },
  dismiss: {
    marginTop: 2,
    opacity: 0.6,
  },
});
