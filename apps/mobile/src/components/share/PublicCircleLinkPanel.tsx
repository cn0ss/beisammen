import Ionicons from '@expo/vector-icons/Ionicons';
import { T, useGT, Var } from 'gt-react-native';
import { memo, useCallback, useMemo, useState } from 'react';
import { Share, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui';
import { Fonts, FontSize, Radius, Spacing } from '@/constants/theme';
import type {
  CreatePublicCircleLinkResult,
  PublicCircleLinkRecord,
} from '@/features/convex/api';
import { useTheme } from '@/hooks/use-theme';
import { useDateFormat } from '@/i18n/use-date-format';

interface PublicCircleLinkPanelProps {
  circleName: string;
  links: PublicCircleLinkRecord[];
  disabled?: boolean;
  onCreatePublicLink: () => Promise<CreatePublicCircleLinkResult>;
  onRevokePublicLink: (publicLinkId: string) => Promise<void>;
  onFeedback: (message: string | null) => void;
}

interface LastPublicLink {
  shareUrl: string;
  expiresAt: number;
}

const DATE_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  dateStyle: 'medium',
};

function formatDate(timestamp: number, format: Intl.DateTimeFormat) {
  return format.format(new Date(timestamp));
}

export const PublicCircleLinkPanel = memo(function PublicCircleLinkPanel({
  circleName,
  links,
  disabled = false,
  onCreatePublicLink,
  onRevokePublicLink,
  onFeedback,
}: PublicCircleLinkPanelProps) {
  const theme = useTheme();
  const gt = useGT();
  const dateFormat = useDateFormat(DATE_FORMAT_OPTIONS);
  const [lastLink, setLastLink] = useState<LastPublicLink | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const activeLink = useMemo(
    () => links.find((link) => link.status === 'active') ?? null,
    [links],
  );

  const sharePublicLink = useCallback(
    async (link: LastPublicLink) => {
      await Share.share({
        message: gt('Hier kannst du die neuen Momente aus "{circleName}" ansehen:\n{shareUrl}', {
          circleName,
          shareUrl: link.shareUrl,
        }),
      });
    },
    [circleName, gt],
  );

  const handleCreate = useCallback(async () => {
    setIsCreating(true);
    onFeedback(null);

    try {
      const created = await onCreatePublicLink();
      const nextLink = {
        shareUrl: created.shareUrl,
        expiresAt: created.expiresAt,
      };

      setLastLink(nextLink);
      onFeedback(gt('Web-Link erstellt.'));
      await sharePublicLink(nextLink);
    } catch (error) {
      onFeedback(
        error instanceof Error ? error.message : gt('Web-Link konnte nicht erstellt werden.'),
      );
    } finally {
      setIsCreating(false);
    }
  }, [gt, onCreatePublicLink, onFeedback, sharePublicLink]);

  const handleShareLast = useCallback(async () => {
    if (!lastLink) {
      return;
    }

    try {
      await sharePublicLink(lastLink);
    } catch (error) {
      onFeedback(
        error instanceof Error ? error.message : gt('Web-Link konnte nicht geteilt werden.'),
      );
    }
  }, [gt, lastLink, onFeedback, sharePublicLink]);

  const handleRevoke = useCallback(async () => {
    if (!activeLink) {
      return;
    }

    setRevokingId(activeLink._id);
    onFeedback(null);

    try {
      await onRevokePublicLink(activeLink._id);
      setLastLink(null);
      onFeedback(gt('Web-Link zurückgezogen.'));
    } catch (error) {
      onFeedback(
        error instanceof Error ? error.message : gt('Web-Link konnte nicht zurückgezogen werden.'),
      );
    } finally {
      setRevokingId(null);
    }
  }, [activeLink, gt, onFeedback, onRevokePublicLink]);

  return (
    <View style={styles.container}>
      <View style={styles.copy}>
        <T>
          <Text style={[styles.kicker, { color: theme.textTertiary }]}>Öffentliche Website</Text>
          <Text style={[styles.title, { color: theme.text }]}>Link für Familie</Text>
          <Text style={[styles.body, { color: theme.textSecondary }]}>
            Der Link zeigt veröffentlichte Beiträge ohne App-Installation. Nur Personen mit dem Link
            können ihn öffnen.
          </Text>
        </T>
      </View>

      <View style={[styles.statusBox, { backgroundColor: theme.background, borderColor: theme.border }]}>
        <View style={styles.statusIcon}>
          <Ionicons
            name={activeLink ? 'globe-outline' : 'lock-closed-outline'}
            size={18}
            color={activeLink ? theme.primary : theme.textTertiary}
          />
        </View>
        <View style={styles.statusCopy}>
          <Text style={[styles.statusTitle, { color: theme.text }]}>
            {activeLink
              ? gt('Aktiv bis {date}', { date: formatDate(activeLink.expiresAt, dateFormat) })
              : gt('Kein aktiver Web-Link')}
          </Text>
          <Text style={[styles.statusMeta, { color: theme.textSecondary }]}>
            {activeLink
              ? gt('Erstellt von {name}', { name: activeLink.createdByName })
              : gt('Beim Erstellen werden ältere aktive Web-Links ersetzt.')}
          </Text>
        </View>
      </View>

      <View style={styles.buttonRow}>
        <View style={styles.buttonCol}>
          <Button
            label={activeLink ? gt('Neuen Link erstellen') : gt('Web-Link erstellen')}
            icon="link-outline"
            loading={isCreating}
            disabled={disabled || revokingId !== null}
            onPress={() => {
              void handleCreate();
            }}
          />
        </View>
        {activeLink ? (
          <View style={styles.buttonCol}>
            <Button
              label={gt('Zurückziehen')}
              icon="close-circle-outline"
              variant="danger"
              loading={revokingId === activeLink._id}
              disabled={disabled || isCreating}
              onPress={() => {
                void handleRevoke();
              }}
            />
          </View>
        ) : null}
      </View>

      {lastLink ? (
        <View style={[styles.linkPreview, { backgroundColor: theme.background }]}>
          <View style={styles.previewHeader}>
            <T>
              <Text style={[styles.kicker, { color: theme.textTertiary }]}>letzter web-link</Text>
              <Text style={[styles.previewMeta, { color: theme.textSecondary }]}>
                gültig bis <Var>{formatDate(lastLink.expiresAt, dateFormat)}</Var>
              </Text>
            </T>
          </View>
          <Text selectable style={[styles.linkText, { color: theme.primary }]}>
            {lastLink.shareUrl}
          </Text>
          <Button
            label={gt('Erneut teilen')}
            icon="share-social-outline"
            variant="outline"
            onPress={() => {
              void handleShareLast();
            }}
          />
        </View>
      ) : null}
    </View>
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
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: FontSize.xl,
    fontWeight: '800',
  },
  body: {
    fontSize: FontSize.base,
    lineHeight: 22,
  },
  statusBox: {
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing.md,
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  statusIcon: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusCopy: {
    flex: 1,
    minWidth: 0,
  },
  statusTitle: {
    fontSize: FontSize.base,
    fontWeight: '800',
  },
  statusMeta: {
    marginTop: 2,
    fontSize: FontSize.sm,
    lineHeight: 19,
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  buttonCol: {
    flexGrow: 1,
    minWidth: 180,
  },
  linkPreview: {
    borderRadius: Radius.md,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  previewHeader: {
    gap: 3,
  },
  previewMeta: {
    fontSize: FontSize.sm,
  },
  linkText: {
    fontFamily: Fonts.mono,
    fontSize: FontSize.sm,
    lineHeight: 20,
  },
});
