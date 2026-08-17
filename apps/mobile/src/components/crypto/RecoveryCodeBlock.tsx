import * as Clipboard from 'expo-clipboard';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useGT } from 'gt-react-native';
import { memo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Fonts, FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { Button } from '@/components/ui';

// The file name is what users later search for in the Files app, so it must
// stay recognizable and stable across exports.
const RECOVERY_FILE_NAME = 'Beisammen-Wiederherstellungscode.txt';

async function exportRecoveryCodeFile(code: string, body: string): Promise<void> {
  const isAvailable = await Sharing.isAvailableAsync();

  if (!isAvailable) {
    throw new Error('Sharing unavailable');
  }

  const file = new File(Paths.cache, RECOVERY_FILE_NAME);

  if (file.exists) {
    file.delete();
  }

  file.create();
  file.write(`${body}\n\n${code}\n`);

  try {
    await Sharing.shareAsync(file.uri, {
      mimeType: 'text/plain',
      UTI: 'public.plain-text',
    });
  } finally {
    // The plaintext code should not linger in the cache directory.
    if (file.exists) {
      file.delete();
    }
  }
}

interface RecoveryCodeBlockProps {
  code: string;
  onCopied?: () => void;
  onExportFailed?: () => void;
}

/** Monospace recovery code with copy-to-clipboard and file-export actions. */
export const RecoveryCodeBlock = memo(function RecoveryCodeBlock({
  code,
  onCopied,
  onExportFailed,
}: RecoveryCodeBlockProps) {
  const theme = useTheme();
  const gt = useGT();
  const [isExporting, setIsExporting] = useState(false);

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.codeBox,
          { backgroundColor: theme.surfacePressed, borderColor: theme.border },
        ]}
      >
        <Text selectable style={[styles.code, { color: theme.text }]}>
          {code}
        </Text>
      </View>
      <Button
        label={gt('Code kopieren')}
        icon="copy-outline"
        variant="outline"
        onPress={() => {
          void Clipboard.setStringAsync(code).then(() => {
            onCopied?.();
          });
        }}
      />
      <Button
        label={gt('Als Datei exportieren')}
        icon="download-outline"
        variant="outline"
        loading={isExporting}
        disabled={isExporting}
        onPress={() => {
          setIsExporting(true);
          void exportRecoveryCodeFile(
            code,
            gt(
              'Dein Beisammen-Wiederherstellungscode. Mit diesem Code bekommst du auf einem neuen Gerät wieder Zugriff auf deine verschlüsselten Fotos. Bewahre diese Datei sicher auf und teile sie mit niemandem.',
            ),
          )
            .catch(() => {
              onExportFailed?.();
            })
            .finally(() => {
              setIsExporting(false);
            });
        }}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    gap: Spacing.md,
  },
  codeBox: {
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  code: {
    fontFamily: Fonts.mono,
    fontSize: FontSize.base,
    lineHeight: 26,
    letterSpacing: 1.2,
    textAlign: 'center',
  },
});
