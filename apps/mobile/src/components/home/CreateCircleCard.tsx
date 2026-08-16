import { memo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { Fonts, FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { Button, Card } from '@/components/ui';

interface CreateCircleCardProps {
  onCreateCircle: (name: string, description: string) => Promise<void>;
}

export const CreateCircleCard = memo(function CreateCircleCard({
  onCreateCircle,
}: CreateCircleCardProps) {
  const theme = useTheme();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  async function handleCreate() {
    if (!name.trim()) return;
    setIsCreating(true);
    try {
      await onCreateCircle(name.trim(), description.trim());
      setName('');
      setDescription('');
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <Card>
      <View style={styles.copy}>
        <Text style={[styles.kicker, { color: theme.textTertiary }]}>neuer circle</Text>
        <Text style={[styles.title, { color: theme.text }]}>Benenne zuerst die Menschen.</Text>
        <Text style={[styles.body, { color: theme.textSecondary }]}>
          Erstelle einen privaten Raum für genau eine Gruppe. Keine Suche, kein Publikum, nur
          eingeladene Personen.
        </Text>
      </View>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Name des Circles"
        placeholderTextColor={theme.textTertiary}
        style={[
          styles.input,
          {
            backgroundColor: theme.background,
            borderColor: theme.border,
            color: theme.text,
          },
        ]}
      />
      <TextInput
        value={description}
        onChangeText={setDescription}
        placeholder="Beschreibung (optional)"
        placeholderTextColor={theme.textTertiary}
        style={[
          styles.input,
          {
            backgroundColor: theme.background,
            borderColor: theme.border,
            color: theme.text,
          },
        ]}
      />
      <Button
        label={isCreating ? 'Erstelle...' : 'Circle anlegen'}
        icon="add-outline"
        loading={isCreating}
        disabled={!name.trim()}
        onPress={() => {
          void handleCreate();
        }}
      />
    </Card>
  );
});

const styles = StyleSheet.create({
  copy: {
    gap: 6,
  },
  kicker: {
    fontFamily: Fonts.mono,
    fontSize: FontSize.xs,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: FontSize.xl,
    letterSpacing: -0.4,
  },
  body: {
    fontSize: FontSize.sm,
    lineHeight: 20,
  },
  input: {
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    fontSize: FontSize.base,
  },
});
