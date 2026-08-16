import Ionicons from '@expo/vector-icons/Ionicons';
import { memo, useCallback, useState } from 'react';
import { Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '@/components/ui';
import { Fonts, FontSize, Radius, Spacing } from '@/constants/theme';
import {
  buildInviteShareMessage,
  inviteModeLabel,
  inviteRoleLabel,
  type InviteMode,
  type InviteRole,
} from '@/features/invites/preview-state';
import { useTheme } from '@/hooks/use-theme';

export interface InviteComposerSubmitArgs {
  mode: InviteMode;
  invitedEmail?: string;
  role: InviteRole;
}

export interface InviteComposerResult {
  inviteLink: string;
}

interface LastInvite {
  inviteLink: string;
  mode: InviteMode;
  invitedEmail: string | null;
  role: InviteRole;
}

interface InviteComposerProps {
  circleName: string;
  disabled?: boolean;
  onCreateInvite: (args: InviteComposerSubmitArgs) => Promise<InviteComposerResult>;
  onFeedback: (message: string | null) => void;
}

export const InviteComposer = memo(function InviteComposer({
  circleName,
  disabled = false,
  onCreateInvite,
  onFeedback,
}: InviteComposerProps) {
  const theme = useTheme();
  const [mode, setMode] = useState<InviteMode>('email');
  const [invitedEmail, setInvitedEmail] = useState('');
  const [role, setRole] = useState<InviteRole>('member');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastInvite, setLastInvite] = useState<LastInvite | null>(null);

  const shareInvite = useCallback(
    async (invite: LastInvite) => {
      await Share.share({
        message: buildInviteShareMessage({
          circleName,
          inviteLink: invite.inviteLink,
          mode: invite.mode,
        }),
      });
    },
    [circleName],
  );

  const handleCreateInvite = useCallback(async () => {
    const normalizedEmail = invitedEmail.trim().toLowerCase();

    if (mode === 'email' && !normalizedEmail) {
      onFeedback('Gib eine E-Mail-Adresse ein oder wähle einen offenen Einmal-Link.');
      return;
    }

    setIsSubmitting(true);
    onFeedback(null);

    try {
      const created = await onCreateInvite({
        mode,
        ...(mode === 'email' ? { invitedEmail: normalizedEmail } : {}),
        role,
      });
      const nextInvite = {
        inviteLink: created.inviteLink,
        mode,
        invitedEmail: mode === 'email' ? normalizedEmail : null,
        role,
      };

      setLastInvite(nextInvite);
      setInvitedEmail('');
      onFeedback('Einladung erstellt.');
      await shareInvite(nextInvite);
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : 'Einladung konnte nicht erstellt werden.');
    } finally {
      setIsSubmitting(false);
    }
  }, [invitedEmail, mode, onCreateInvite, onFeedback, role, shareInvite]);

  const handleShareLastInvite = useCallback(async () => {
    if (!lastInvite) {
      return;
    }

    try {
      await shareInvite(lastInvite);
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : 'Invite-Link konnte nicht geteilt werden.');
    }
  }, [lastInvite, onFeedback, shareInvite]);

  const canSubmit = !disabled && !isSubmitting && (mode === 'open' || invitedEmail.trim().length > 0);

  return (
    <View style={styles.container}>
      <View style={styles.copy}>
        <Text style={[styles.kicker, { color: theme.textTertiary }]}>Einladen</Text>
        <Text style={[styles.title, { color: theme.text }]}>Link erstellen</Text>
        <Text style={[styles.body, { color: theme.textSecondary }]}>
          Persönliche Links bleiben an eine E-Mail gebunden. Offene Links sind einmalig nutzbar.
        </Text>
      </View>

      <View style={styles.segmented}>
        <InviteSegment
          active={mode === 'email'}
          icon="mail-outline"
          label="E-Mail"
          onPress={() => setMode('email')}
        />
        <InviteSegment
          active={mode === 'open'}
          icon="link-outline"
          label="Offen"
          onPress={() => setMode('open')}
        />
      </View>

      {mode === 'email' ? (
        <TextInput
          value={invitedEmail}
          onChangeText={setInvitedEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          placeholder="name@example.com"
          placeholderTextColor={theme.textTertiary}
          editable={!disabled && !isSubmitting}
          style={[
            styles.input,
            {
              backgroundColor: theme.background,
              borderColor: theme.border,
              color: theme.text,
            },
          ]}
        />
      ) : null}

      <View style={styles.roleSwitch}>
        <RoleButton label="Mitglied" active={role === 'member'} onPress={() => setRole('member')} />
        <RoleButton label="Admin" active={role === 'admin'} onPress={() => setRole('admin')} />
      </View>

      <Button
        label={isSubmitting ? 'Erstellt...' : 'Invite-Link erstellen'}
        icon="person-add-outline"
        loading={isSubmitting}
        disabled={!canSubmit}
        onPress={() => {
          void handleCreateInvite();
        }}
      />

      {lastInvite ? (
        <View style={[styles.invitePreview, { backgroundColor: theme.background }]}>
          <View style={styles.previewHeader}>
            <Text style={[styles.kicker, { color: theme.textTertiary }]}>letzter link</Text>
            <Text style={[styles.previewMeta, { color: theme.textSecondary }]}>
              {inviteModeLabel(lastInvite.mode)} · {inviteRoleLabel(lastInvite.role)}
            </Text>
          </View>
          {lastInvite.invitedEmail ? (
            <Text style={[styles.previewMeta, { color: theme.textSecondary }]} numberOfLines={1}>
              {lastInvite.invitedEmail}
            </Text>
          ) : null}
          <Text selectable style={[styles.linkText, { color: theme.primary }]}>
            {lastInvite.inviteLink}
          </Text>
          <Button
            label="Erneut teilen"
            icon="share-social-outline"
            variant="outline"
            onPress={() => {
              void handleShareLastInvite();
            }}
          />
        </View>
      ) : null}
    </View>
  );
});

const InviteSegment = memo(function InviteSegment({
  active,
  icon,
  label,
  onPress,
}: {
  active: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.segment,
        {
          backgroundColor: active ? theme.primaryMuted : theme.background,
          borderColor: active ? theme.primary : theme.border,
          opacity: pressed ? 0.82 : 1,
        },
      ]}
    >
      <Ionicons name={icon} size={15} color={active ? theme.primary : theme.textSecondary} />
      <Text style={[styles.segmentText, { color: active ? theme.primary : theme.textSecondary }]}>
        {label}
      </Text>
    </Pressable>
  );
});

const RoleButton = memo(function RoleButton({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.roleButton,
        {
          backgroundColor: active ? theme.accentMuted : theme.background,
          borderColor: active ? theme.accent : theme.border,
          opacity: pressed ? 0.82 : 1,
        },
      ]}
    >
      <Text style={[styles.roleButtonText, { color: active ? theme.accent : theme.textSecondary }]}>
        {label}
      </Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  container: {
    gap: Spacing.md,
  },
  copy: {
    gap: 5,
  },
  kicker: {
    fontFamily: Fonts.mono,
    fontSize: FontSize.xs,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: FontSize.xl,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  body: {
    fontSize: FontSize.sm,
    lineHeight: 20,
  },
  segmented: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  segment: {
    minHeight: 42,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
  },
  segmentText: {
    fontSize: FontSize.sm,
    fontWeight: '700',
  },
  input: {
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    fontSize: FontSize.base,
  },
  roleSwitch: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  roleButton: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
  },
  roleButtonText: {
    fontSize: FontSize.sm,
    fontWeight: '700',
  },
  invitePreview: {
    gap: Spacing.sm,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  previewHeader: {
    gap: 3,
  },
  previewMeta: {
    fontSize: FontSize.xs,
    fontWeight: '600',
  },
  linkText: {
    fontSize: FontSize.sm,
    lineHeight: 20,
  },
});
