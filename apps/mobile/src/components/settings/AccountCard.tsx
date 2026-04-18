import Ionicons from '@expo/vector-icons/Ionicons';
import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FontSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { Avatar, Button, Card } from '@/components/ui';

interface AccountCardProps {
  serverName: string;
  serverUrl: string;
  accountLabel: string;
  profileName: string;
  profileImageUrl?: string | null;
  hasProfileImage: boolean;
  profileImageLoading: boolean;
  onPickProfileImage: () => void;
  onRemoveProfileImage: () => void;
  onRefresh: () => void;
  onSignOut: () => void;
}

export const AccountCard = memo(function AccountCard({
  serverName,
  serverUrl,
  accountLabel,
  profileName,
  profileImageUrl,
  hasProfileImage,
  profileImageLoading,
  onPickProfileImage,
  onRemoveProfileImage,
  onRefresh,
  onSignOut,
}: AccountCardProps) {
  const theme = useTheme();

  return (
    <Card>
      <View style={styles.heroRow}>
        <Avatar name={profileName} imageUrl={profileImageUrl} size="lg" />
        <View style={styles.heroCopy}>
          <Text style={[styles.heroTitle, { color: theme.text }]} numberOfLines={1}>
            {profileName}
          </Text>
          <Text style={[styles.heroSubtitle, { color: theme.textSecondary }]} numberOfLines={1}>
            Eigenes Profilbild mit Fallback auf dein Login-Bild.
          </Text>
        </View>
      </View>

      <View style={styles.actionRow}>
        <View style={styles.actionCol}>
          <Button
            label={hasProfileImage ? 'Bild ändern' : 'Bild wählen'}
            icon="image-outline"
            variant="ghost"
            loading={profileImageLoading}
            onPress={onPickProfileImage}
          />
        </View>
        {hasProfileImage ? (
          <View style={styles.actionCol}>
            <Button
              label="Entfernen"
              icon="trash-outline"
              variant="danger"
              loading={profileImageLoading}
              onPress={onRemoveProfileImage}
            />
          </View>
        ) : null}
      </View>

      <InfoRow icon="globe-outline" label="Server" value={serverName} />
      <InfoRow icon="link-outline" label="Adresse" value={serverUrl} />
      <InfoRow icon="mail-outline" label="Konto" value={accountLabel} />

      <View style={styles.actionRow}>
        <View style={styles.actionCol}>
          <Button
            label="Sitzung erneuern"
            icon="refresh-outline"
            variant="ghost"
            onPress={onRefresh}
          />
        </View>
        <View style={styles.actionCol}>
          <Button
            label="Abmelden"
            icon="log-out-outline"
            variant="outline"
            onPress={onSignOut}
          />
        </View>
      </View>
    </Card>
  );
});

const InfoRow = memo(function InfoRow({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  const theme = useTheme();

  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={14} color={theme.textTertiary} />
      <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>{label}</Text>
      <Text
        style={[styles.infoValue, { color: theme.text }]}
        numberOfLines={1}
        ellipsizeMode="middle"
      >
        {value}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  heroCopy: {
    flex: 1,
    gap: 2,
  },
  heroTitle: {
    fontSize: FontSize.md,
    fontWeight: '700',
  },
  heroSubtitle: {
    fontSize: FontSize.sm,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: 3,
  },
  infoLabel: {
    fontSize: FontSize.sm,
    fontWeight: '500',
    minWidth: 54,
  },
  infoValue: {
    flex: 1,
    fontSize: FontSize.sm,
    fontWeight: '600',
    textAlign: 'right',
  },
  actionRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  actionCol: {
    flex: 1,
  },
});
