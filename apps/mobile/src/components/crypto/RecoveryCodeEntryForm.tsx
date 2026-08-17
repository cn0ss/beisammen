import { useGT } from 'gt-react-native';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { Fonts, FontSize, Radius, Spacing } from '@/constants/theme';
import { useCrypto } from '@/features/crypto/provider';
import { useTheme } from '@/hooks/use-theme';

import { Button } from '@/components/ui';

interface RecoveryCodeEntryFormProps {
  onRecovered?: () => void;
}

/**
 * Recovery code input for a device without the master key. The decoder is
 * tolerant of case, spaces, and dashes; a checksum mismatch surfaces as an
 * inline error.
 */
export function RecoveryCodeEntryForm({ onRecovered }: RecoveryCodeEntryFormProps) {
  const theme = useTheme();
  const gt = useGT();
  const { recover } = useCrypto();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = useCallback(async () => {
    setIsSubmitting(true);
    setError(null);

    try {
      await recover(code);
      onRecovered?.();
    } catch {
      setError(gt('Der Code ist ungültig. Bitte prüfe die Eingabe.'));
    } finally {
      setIsSubmitting(false);
    }
  }, [code, gt, onRecovered, recover]);

  return (
    <View style={styles.container}>
      <TextInput
        value={code}
        onChangeText={(value) => {
          setCode(value);
          setError(null);
        }}
        placeholder="XXXXX-XXXXX-XXXXX"
        placeholderTextColor={theme.textTertiary}
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="off"
        multiline
        accessibilityLabel={gt('Wiederherstellungscode')}
        style={[
          styles.input,
          {
            backgroundColor: theme.surface,
            borderColor: error ? theme.danger : theme.border,
            color: theme.text,
          },
        ]}
      />
      {error ? <Text style={[styles.error, { color: theme.danger }]}>{error}</Text> : null}
      <Button
        label={gt('Zugriff wiederherstellen')}
        icon="key-outline"
        loading={isSubmitting}
        disabled={code.trim().length === 0 || isSubmitting}
        onPress={() => {
          void handleSubmit();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.md,
  },
  input: {
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    minHeight: 72,
    textAlignVertical: 'top',
    fontFamily: Fonts.mono,
    fontSize: FontSize.base,
    letterSpacing: 1,
  },
  error: {
    fontSize: FontSize.sm,
    lineHeight: 18,
  },
});
