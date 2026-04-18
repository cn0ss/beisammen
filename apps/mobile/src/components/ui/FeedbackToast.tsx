import Ionicons from '@expo/vector-icons/Ionicons';
import { memo, useCallback, useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text } from 'react-native';

import { FontSize, Radius, Spacing } from '@/constants/theme';
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
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(8)).current;
  const dismissTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDismissingRef = useRef(false);

  const clearDismissTimeout = useCallback(() => {
    if (dismissTimeoutRef.current) {
      clearTimeout(dismissTimeoutRef.current);
      dismissTimeoutRef.current = null;
    }
  }, []);

  const handleDismiss = useCallback(() => {
    if (!message || isDismissingRef.current) {
      return;
    }

    isDismissingRef.current = true;
    clearDismissTimeout();

    Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 8, duration: 180, useNativeDriver: true }),
    ]).start(({ finished }) => {
      isDismissingRef.current = false;
      if (finished) {
        onDismiss();
      }
    });
  }, [clearDismissTimeout, message, onDismiss, opacity, translateY]);

  useEffect(() => {
    if (message) {
      isDismissingRef.current = false;
      clearDismissTimeout();
      opacity.setValue(0);
      translateY.setValue(8);
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 250, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 0, duration: 250, useNativeDriver: true }),
      ]).start();

      dismissTimeoutRef.current = setTimeout(() => {
        handleDismiss();
      }, autoDismissMs);
    } else {
      clearDismissTimeout();
      isDismissingRef.current = false;
      opacity.setValue(0);
      translateY.setValue(8);
    }
    return clearDismissTimeout;
  }, [autoDismissMs, clearDismissTimeout, handleDismiss, message, opacity, translateY]);

  if (!message) return null;

  const colorMap = {
    info: { bg: theme.primaryMuted, fg: theme.primary, icon: 'information-circle' as const },
    success: { bg: theme.primaryMuted, fg: theme.primary, icon: 'checkmark-circle' as const },
    error: { bg: theme.dangerMuted, fg: theme.danger, icon: 'alert-circle' as const },
  };
  const colors = colorMap[type];

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      <Pressable
        onPress={handleDismiss}
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
