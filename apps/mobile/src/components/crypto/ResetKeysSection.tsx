import { T, useGT } from 'gt-react-native';
import { useCallback, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { FontSize, Spacing } from '@/constants/theme';
import { useCrypto } from '@/features/crypto/provider';
import { useTheme } from '@/hooks/use-theme';

import { Button } from '@/components/ui';

/**
 * Last-resort escape hatch for a user without master key AND without recovery
 * code: replaces the key material after a destructive confirmation. Shared
 * photos come back automatically once another circle member's app re-grants
 * the circle keys; solo-circle history is lost, which the confirm spells out.
 */
export function ResetKeysSection() {
  const theme = useTheme();
  const gt = useGT();
  const { resetKeys } = useCrypto();
  const [isResetting, setIsResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runReset = useCallback(() => {
    setIsResetting(true);
    setError(null);
    void resetKeys().catch(() => {
      setError(gt('Das Zurücksetzen ist fehlgeschlagen. Bitte versuche es erneut.'));
    }).finally(() => {
      setIsResetting(false);
    });
  }, [gt, resetKeys]);

  const confirmReset = useCallback(() => {
    Alert.alert(
      gt('Verschlüsselung zurücksetzen?'),
      gt(
        'Dein bisheriger Wiederherstellungscode wird ungültig und du erhältst einen neuen. Fotos aus gemeinsamen Circles werden automatisch wieder freigeschaltet, sobald ein anderes Mitglied die App öffnet. Fotos in Circles, in denen du das einzige Mitglied bist, können nicht wiederhergestellt werden.',
      ),
      [
        { text: gt('Abbrechen'), style: 'cancel' },
        {
          text: gt('Zurücksetzen'),
          style: 'destructive',
          onPress: runReset,
        },
      ],
    );
  }, [gt, runReset]);

  return (
    <View style={styles.container}>
      <T>
        <Text style={[styles.body, { color: theme.textSecondary }]}>
          Code verloren? Als letzter Ausweg kannst du die Verschlüsselung zurücksetzen. Du
          bekommst dann einen neuen Code und den Zugriff auf gemeinsame Fotos automatisch zurück.
        </Text>
      </T>
      {error ? <Text style={[styles.error, { color: theme.danger }]}>{error}</Text> : null}
      <Button
        label={gt('Verschlüsselung zurücksetzen')}
        icon="refresh-outline"
        variant="danger"
        loading={isResetting}
        disabled={isResetting}
        onPress={confirmReset}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.md,
  },
  body: {
    fontSize: FontSize.base,
    lineHeight: 22,
  },
  error: {
    fontSize: FontSize.sm,
    lineHeight: 18,
  },
});
