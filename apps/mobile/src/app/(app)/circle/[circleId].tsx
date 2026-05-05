import Ionicons from '@expo/vector-icons/Ionicons';
import * as ImagePicker from 'expo-image-picker';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAction, useConvexAuth, useMutation, useQuery } from 'convex/react';

import { Avatar, Button, Card, FeedbackToast, LoadingBox } from '@/components/ui';
import { Fonts, FontSize, Radius, Spacing } from '@/constants/theme';
import type { CircleInviteRecord, CircleMemberRecord } from '@/features/convex/api';
import { useSession } from '@/features/auth/session-provider';
import { api } from '@/features/convex/api';
import { optimizePickerAsset, uploadPreparedFile } from '@/features/media/client';
import { useCircleImageUrl } from '@/features/media/use-circle-image-url';
import { useTheme } from '@/hooks/use-theme';

function firstParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

async function pickSingleImageAsset() {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

  if (!permission.granted) {
    throw new Error('Ohne Mediathek-Zugriff kann kein Bild ausgewählt werden.');
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: false,
    quality: 1,
  });

  if (result.canceled || !result.assets.length) {
    return null;
  }

  return result.assets[0] ?? null;
}

function formatDateTime(timestamp: number) {
  return new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

function roleLabel(role: 'owner' | 'admin' | 'member') {
  switch (role) {
    case 'owner':
      return 'Owner';
    case 'admin':
      return 'Admin';
    default:
      return 'Mitglied';
  }
}

function inviteStatusLabel(status: CircleInviteRecord['status']) {
  switch (status) {
    case 'accepted':
      return 'Angenommen';
    case 'expired':
      return 'Abgelaufen';
    case 'revoked':
      return 'Zurückgezogen';
    default:
      return 'Ausstehend';
  }
}

function buildInviteMessage(circleName: string, inviteLink: string) {
  return `Komm in meinen Circle "${circleName}": ${inviteLink}`;
}

export default function CircleManagementScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { setActiveCircleId } = useSession();
  const convexAuth = useConvexAuth();
  const params = useLocalSearchParams<{ circleId?: string | string[] }>();
  const circleId = firstParam(params.circleId);
  const viewerState = useQuery(api.users.viewerState, convexAuth.isAuthenticated ? {} : 'skip');
  const hasViewer = viewerState?.isAuthenticated === true && viewerState.viewer !== null;
  const circle = useQuery(api.circles.getById, circleId && hasViewer ? { circleId } : 'skip');
  const members = useQuery(api.circles.listMembers, circleId && hasViewer ? { circleId } : 'skip');
  const invites = useQuery(api.invites.listForCircle, circleId && hasViewer ? { circleId } : 'skip');
  const updateCircle = useMutation(api.circles.update);
  const updateMemberRole = useMutation(api.circles.updateMemberRole);
  const removeMember = useMutation(api.circles.removeMember);
  const transferOwnership = useMutation(api.circles.transferOwnership);
  const leaveCircle = useMutation(api.circles.leave);
  const createInvite = useMutation(api.invites.create);
  const revokeInvite = useMutation(api.invites.revoke);
  const createCircleImageTarget = useAction(api.circles.createImageTarget);
  const completeCircleImageUpload = useAction(api.circles.completeImageUpload);
  const removeCircleImage = useAction(api.circles.removeImage);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member');
  const [lastInviteLink, setLastInviteLink] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isSavingDetails, setIsSavingDetails] = useState(false);
  const [isSubmittingInvite, setIsSubmittingInvite] = useState(false);
  const [busyMemberId, setBusyMemberId] = useState<string | null>(null);
  const [busyInviteId, setBusyInviteId] = useState<string | null>(null);
  const [isLeaving, setIsLeaving] = useState(false);
  const [isImageBusy, setIsImageBusy] = useState(false);
  const imageUrl = useCircleImageUrl(circle?._id, Boolean(circle?.hasImage));

  useEffect(() => {
    if (!circle) {
      return;
    }

    setName(circle.name);
    setDescription(circle.description);
    setLastInviteLink(null);
  }, [circle?._id, circle?.name, circle?.description]);

  const detailsDirty =
    Boolean(circle) &&
    (name.trim() !== (circle?.name ?? '') ||
      description.trim() !== (circle?.description ?? ''));
  const otherMembers = useMemo(
    () => members?.filter((member) => !member.isSelf) ?? [],
    [members],
  );

  const handleSaveDetails = useCallback(async () => {
    if (!circleId || !circle) {
      return;
    }

    setIsSavingDetails(true);
    setFeedback(null);

    try {
      await updateCircle({
        circleId,
        name: name.trim(),
        description: description.trim() || undefined,
      });
      setFeedback('Circle-Details aktualisiert.');
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Circle konnte nicht aktualisiert werden.');
    } finally {
      setIsSavingDetails(false);
    }
  }, [circle, circleId, description, name, updateCircle]);

  const handlePickCircleImage = useCallback(async () => {
    if (!circle?.canManage) {
      return;
    }

    setIsImageBusy(true);
    setFeedback(null);

    try {
      const pickedAsset = await pickSingleImageAsset();

      if (!pickedAsset) {
        return;
      }

      const processedAsset = await optimizePickerAsset(pickedAsset);
      const prepared = await createCircleImageTarget({
        circleId: circle._id,
        mimeType: processedAsset.mimeType,
        fileName: processedAsset.fileName,
      });
      const uploaded = await uploadPreparedFile({
        target: prepared.target,
        asset: processedAsset,
      });

      await completeCircleImageUpload({
        uploadId: prepared.uploadId,
        objectKey: uploaded.objectKey,
        storageId: uploaded.storageId,
        sizeBytes: processedAsset.sizeBytes,
      });
      setFeedback(`Bild für "${circle.name}" aktualisiert.`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Circle-Bild konnte nicht gesetzt werden.');
    } finally {
      setIsImageBusy(false);
    }
  }, [circle, completeCircleImageUpload, createCircleImageTarget]);

  const handleRemoveCircleImage = useCallback(() => {
    if (!circle?.canManage || !circle.hasImage || isImageBusy) {
      return;
    }

    Alert.alert('Circle-Bild entfernen?', `Das Bild von "${circle.name}" wird entfernt.`, [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Entfernen',
        style: 'destructive',
        onPress: () => {
          setIsImageBusy(true);
          setFeedback(null);
          void removeCircleImage({ circleId: circle._id })
            .then(() => {
              setFeedback(`Bild für "${circle.name}" entfernt.`);
            })
            .catch((error) => {
              setFeedback(
                error instanceof Error
                  ? error.message
                  : 'Circle-Bild konnte nicht entfernt werden.',
              );
            })
            .finally(() => {
              setIsImageBusy(false);
            });
        },
      },
    ]);
  }, [circle, isImageBusy, removeCircleImage]);

  const handleCreateInvite = useCallback(async () => {
    if (!circleId || !circle || !inviteEmail.trim()) {
      return;
    }

    setIsSubmittingInvite(true);
    setFeedback(null);

    try {
      const created = await createInvite({
        circleId,
        invitedEmail: inviteEmail.trim(),
        role: inviteRole,
      });
      setInviteEmail('');
      setLastInviteLink(created.inviteLink);
      setFeedback('Einladung erstellt.');
      await Share.share({
        message: buildInviteMessage(circle.name, created.inviteLink),
      });
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Einladung konnte nicht erstellt werden.');
    } finally {
      setIsSubmittingInvite(false);
    }
  }, [circle, circleId, createInvite, inviteEmail, inviteRole]);

  const handleShareLastInvite = useCallback(async () => {
    if (!circle || !lastInviteLink) {
      return;
    }

    try {
      await Share.share({
        message: buildInviteMessage(circle.name, lastInviteLink),
      });
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Invite-Link konnte nicht geteilt werden.');
    }
  }, [circle, lastInviteLink]);

  const handleToggleRole = useCallback(
    (member: CircleMemberRecord) => {
      const nextRole = member.role === 'admin' ? 'member' : 'admin';
      const actionLabel = nextRole === 'admin' ? 'zum Admin machen' : 'zum Mitglied herunterstufen';

      Alert.alert(
        'Rolle ändern?',
        `${member.displayName} wird ${actionLabel}.`,
        [
          { text: 'Abbrechen', style: 'cancel' },
          {
            text: 'Bestätigen',
            onPress: () => {
              setBusyMemberId(member._id);
              setFeedback(null);
              void updateMemberRole({
                circleId: circleId!,
                memberId: member._id,
                role: nextRole,
              })
                .then(() => {
                  setFeedback(`Rolle für ${member.displayName} aktualisiert.`);
                })
                .catch((error) => {
                  setFeedback(
                    error instanceof Error ? error.message : 'Rolle konnte nicht geändert werden.',
                  );
                })
                .finally(() => {
                  setBusyMemberId(null);
                });
            },
          },
        ],
      );
    },
    [circleId, updateMemberRole],
  );

  const handleRemoveMember = useCallback(
    (member: CircleMemberRecord) => {
      Alert.alert(
        'Mitglied entfernen?',
        `${member.displayName} verliert sofort den Zugriff auf diesen Circle.`,
        [
          { text: 'Abbrechen', style: 'cancel' },
          {
            text: 'Entfernen',
            style: 'destructive',
            onPress: () => {
              setBusyMemberId(member._id);
              setFeedback(null);
              void removeMember({
                circleId: circleId!,
                memberId: member._id,
              })
                .then(() => {
                  setFeedback(`${member.displayName} wurde entfernt.`);
                })
                .catch((error) => {
                  setFeedback(
                    error instanceof Error ? error.message : 'Mitglied konnte nicht entfernt werden.',
                  );
                })
                .finally(() => {
                  setBusyMemberId(null);
                });
            },
          },
        ],
      );
    },
    [circleId, removeMember],
  );

  const handleTransferOwnership = useCallback(
    (member: CircleMemberRecord) => {
      Alert.alert(
        'Ownership übertragen?',
        `${member.displayName} wird Owner. Dein eigener Zugriff bleibt als Admin bestehen.`,
        [
          { text: 'Abbrechen', style: 'cancel' },
          {
            text: 'Uebertragen',
            onPress: () => {
              setBusyMemberId(member._id);
              setFeedback(null);
              void transferOwnership({
                circleId: circleId!,
                targetMemberId: member._id,
              })
                .then(() => {
                  setFeedback(`Ownership an ${member.displayName} übertragen.`);
                })
                .catch((error) => {
                  setFeedback(
                    error instanceof Error
                      ? error.message
                      : 'Ownership konnte nicht übertragen werden.',
                  );
                })
                .finally(() => {
                  setBusyMemberId(null);
                });
            },
          },
        ],
      );
    },
    [circleId, transferOwnership],
  );

  const handleRevokeInvite = useCallback(
    (invite: CircleInviteRecord) => {
      Alert.alert(
        'Einladung zurückziehen?',
        `Die Einladung für ${invite.invitedEmail} wird sofort ungültig.`,
        [
          { text: 'Abbrechen', style: 'cancel' },
          {
            text: 'Zurückziehen',
            style: 'destructive',
            onPress: () => {
              setBusyInviteId(invite._id);
              setFeedback(null);
              void revokeInvite({ inviteId: invite._id })
                .then(() => {
                  setFeedback(`Einladung für ${invite.invitedEmail} wurde zurückgezogen.`);
                })
                .catch((error) => {
                  setFeedback(
                    error instanceof Error
                      ? error.message
                      : 'Einladung konnte nicht zurückgezogen werden.',
                  );
                })
                .finally(() => {
                  setBusyInviteId(null);
                });
            },
          },
        ],
      );
    },
    [revokeInvite],
  );

  const handleLeaveCircle = useCallback(() => {
    if (!circleId || !circle?.canLeave) {
      return;
    }

    Alert.alert('Circle verlassen?', `Du verlässt "${circle.name}" und verlierst den Zugriff.`, [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Verlassen',
        style: 'destructive',
        onPress: () => {
          setIsLeaving(true);
          setFeedback(null);
          void leaveCircle({ circleId })
            .then(() => {
              setActiveCircleId(null);
              router.replace('/(app)/settings');
            })
            .catch((error) => {
              setFeedback(error instanceof Error ? error.message : 'Circle konnte nicht verlassen werden.');
            })
            .finally(() => {
              setIsLeaving(false);
            });
        },
      },
    ]);
  }, [circle?.canLeave, circle?.name, circleId, leaveCircle, router, setActiveCircleId]);

  if (!circleId) {
    return <Redirect href="/(app)/settings" />;
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Pressable
            accessibilityLabel="Zurück"
            onPress={() => {
              router.back();
            }}
            style={({ pressed }) => [
              styles.backButton,
              {
                backgroundColor: theme.surface,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <Ionicons name="arrow-back-outline" size={18} color={theme.text} />
          </Pressable>
          <Text style={[styles.eyebrow, { color: theme.textTertiary }]}>circle management</Text>
          <Text style={[styles.title, { color: theme.text }]}>{circle?.name ?? 'Circle'}</Text>
        </View>

        {!hasViewer || circle === undefined || members === undefined || invites === undefined ? (
          <Card>
            <LoadingBox />
          </Card>
        ) : (
          <>
            <Card>
              <View style={styles.sectionHeader}>
                <Text style={[styles.cardTitle, { color: theme.text }]}>Circle-Details</Text>
                <Text style={[styles.sectionMeta, { color: theme.textTertiary }]}>
                  {roleLabel(circle.role)}
                </Text>
              </View>

              <View style={styles.heroRow}>
                <Avatar name={circle.name} imageUrl={imageUrl} size="lg" />
                <View style={styles.heroCopy}>
                  <Text style={[styles.heroTitle, { color: theme.text }]}>{circle.name}</Text>
                  <Text style={[styles.heroSubtitle, { color: theme.textSecondary }]}>
                    {circle.memberCount} {circle.memberCount === 1 ? 'Mitglied' : 'Mitglieder'}
                  </Text>
                </View>
              </View>

              {circle.canManage ? (
                <View style={styles.buttonRow}>
                  <View style={styles.buttonCol}>
                    <Button
                      label={circle.hasImage ? 'Bild ändern' : 'Bild wählen'}
                      icon="image-outline"
                      variant="ghost"
                      loading={isImageBusy}
                      onPress={() => {
                        void handlePickCircleImage();
                      }}
                    />
                  </View>
                  {circle.hasImage ? (
                    <View style={styles.buttonCol}>
                      <Button
                        label="Entfernen"
                        icon="trash-outline"
                        variant="danger"
                        loading={isImageBusy}
                        onPress={handleRemoveCircleImage}
                      />
                    </View>
                  ) : null}
                </View>
              ) : null}

              {circle.canEdit ? (
                <>
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
                    placeholder="Beschreibung"
                    placeholderTextColor={theme.textTertiary}
                    multiline
                    style={[
                      styles.input,
                      styles.textArea,
                      {
                        backgroundColor: theme.background,
                        borderColor: theme.border,
                        color: theme.text,
                      },
                    ]}
                  />
                  <Button
                    label="Details speichern"
                    icon="save-outline"
                    loading={isSavingDetails}
                    disabled={!name.trim() || !detailsDirty}
                    onPress={() => {
                      void handleSaveDetails();
                    }}
                  />
                </>
              ) : (
                <Text style={[styles.body, { color: theme.textSecondary }]}>
                  {circle.description || 'Keine Beschreibung hinterlegt.'}
                </Text>
              )}
            </Card>

            <Card>
              <View style={styles.sectionHeader}>
                <Text style={[styles.cardTitle, { color: theme.text }]}>Mitglieder</Text>
                <Text style={[styles.sectionMeta, { color: theme.textTertiary }]}>
                  {members.length.toString().padStart(2, '0')}
                </Text>
              </View>
              {members.map((member, index) => (
                <MemberRow
                  key={member._id}
                  member={member}
                  isBusy={busyMemberId === member._id}
                  hasSeparator={index < members.length - 1}
                  onToggleRole={handleToggleRole}
                  onRemove={handleRemoveMember}
                  onTransferOwnership={handleTransferOwnership}
                />
              ))}
            </Card>

            <Card>
              <View style={styles.sectionHeader}>
                <Text style={[styles.cardTitle, { color: theme.text }]}>Einladen</Text>
                <Text style={[styles.sectionMeta, { color: theme.textTertiary }]}>
                  {circle.canInvite ? 'aktiv' : 'read only'}
                </Text>
              </View>

              {circle.canInvite ? (
                <>
                  <TextInput
                    value={inviteEmail}
                    onChangeText={setInviteEmail}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    placeholder="name@example.com"
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
                  <View style={styles.roleSwitch}>
                    <InviteRoleButton
                      label="Mitglied"
                      active={inviteRole === 'member'}
                      onPress={() => setInviteRole('member')}
                    />
                    <InviteRoleButton
                      label="Admin"
                      active={inviteRole === 'admin'}
                      onPress={() => setInviteRole('admin')}
                    />
                  </View>
                  <Button
                    label="Invite-Link erstellen"
                    icon="person-add-outline"
                    loading={isSubmittingInvite}
                    disabled={!inviteEmail.trim()}
                    onPress={() => {
                      void handleCreateInvite();
                    }}
                  />
                  {lastInviteLink ? (
                    <View style={styles.invitePreview}>
                      <Text style={[styles.kicker, { color: theme.textTertiary }]}>letzter link</Text>
                      <Text selectable style={[styles.linkText, { color: theme.primary }]}>
                        {lastInviteLink}
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
                </>
              ) : (
                <Text style={[styles.body, { color: theme.textSecondary }]}>
                  Nur Owner und Admins dürfen neue Personen einladen.
                </Text>
              )}
            </Card>

            <Card>
              <View style={styles.sectionHeader}>
                <Text style={[styles.cardTitle, { color: theme.text }]}>Ausstehende Einladungen</Text>
                <Text style={[styles.sectionMeta, { color: theme.textTertiary }]}>
                  {invites.length.toString().padStart(2, '0')}
                </Text>
              </View>
              {invites.length === 0 ? (
                <Text style={[styles.body, { color: theme.textSecondary }]}>
                  Aktuell gibt es keine offenen Einladungen für diesen Circle.
                </Text>
              ) : (
                invites.map((invite, index) => (
                  <InviteRow
                    key={invite._id}
                    invite={invite}
                    isBusy={busyInviteId === invite._id}
                    hasSeparator={index < invites.length - 1}
                    onRevoke={handleRevokeInvite}
                  />
                ))
              )}
            </Card>

            <Card>
              <Text style={[styles.cardTitle, { color: theme.text }]}>Circle verlassen</Text>
              {circle.canLeave ? (
                <>
                  <Text style={[styles.body, { color: theme.textSecondary }]}>
                    Du kannst diesen Circle jederzeit verlassen. Der Zugriff auf alle Inhalte endet
                    sofort.
                  </Text>
                  <Button
                    label="Circle verlassen"
                    icon="exit-outline"
                    variant="danger"
                    loading={isLeaving}
                    onPress={handleLeaveCircle}
                  />
                </>
              ) : (
                <Text style={[styles.body, { color: theme.textSecondary }]}>
                  Als Owner musst du Ownership zuerst an ein anderes Mitglied übertragen.
                  {otherMembers.length === 0
                    ? ' Aktuell gibt es noch niemanden, an den du den Circle übergeben kannst.'
                    : ' Wähle dazu oben ein Mitglied aus.'}
                </Text>
              )}
            </Card>
          </>
        )}
      </ScrollView>
      <FeedbackToast message={feedback} onDismiss={() => setFeedback(null)} />
    </SafeAreaView>
  );
}

function MemberRow({
  member,
  hasSeparator,
  isBusy,
  onToggleRole,
  onRemove,
  onTransferOwnership,
}: {
  member: CircleMemberRecord;
  hasSeparator: boolean;
  isBusy: boolean;
  onToggleRole: (member: CircleMemberRecord) => void;
  onRemove: (member: CircleMemberRecord) => void;
  onTransferOwnership: (member: CircleMemberRecord) => void;
}) {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.row,
        hasSeparator && {
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.borderLight,
        },
      ]}
    >
      <Avatar name={member.displayName} imageUrl={member.avatarUrl ?? null} size="sm" />
      <View style={styles.rowCopy}>
        <View style={styles.inlineRow}>
          <Text style={[styles.rowTitle, { color: theme.text }]} numberOfLines={1}>
            {member.displayName}
          </Text>
          {member.isSelf ? (
            <Text style={[styles.selfBadge, { color: theme.primary }]}>du</Text>
          ) : null}
        </View>
        <Text style={[styles.rowMeta, { color: theme.textSecondary }]} numberOfLines={1}>
          {roleLabel(member.role)} · seit {formatDateTime(member.joinedAt)}
        </Text>
        {member.email ? (
          <Text style={[styles.rowMeta, { color: theme.textTertiary }]} numberOfLines={1}>
            {member.email}
          </Text>
        ) : null}
      </View>
      <View style={styles.toolsColumn}>
        {member.canChangeRole ? (
          <MiniAction
            label={member.role === 'admin' ? 'Als Mitglied' : 'Als Admin'}
            onPress={() => onToggleRole(member)}
            disabled={isBusy}
          />
        ) : null}
        {member.canTransferOwnership ? (
          <MiniAction
            label="Owner geben"
            variant="outline"
            onPress={() => onTransferOwnership(member)}
            disabled={isBusy}
          />
        ) : null}
        {member.canRemove ? (
          <MiniAction
            label="Entfernen"
            variant="danger"
            onPress={() => onRemove(member)}
            disabled={isBusy}
          />
        ) : null}
      </View>
    </View>
  );
}

function InviteRow({
  invite,
  hasSeparator,
  isBusy,
  onRevoke,
}: {
  invite: CircleInviteRecord;
  hasSeparator: boolean;
  isBusy: boolean;
  onRevoke: (invite: CircleInviteRecord) => void;
}) {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.row,
        hasSeparator && {
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.borderLight,
        },
      ]}
    >
      <View style={styles.inviteMarker}>
        <Ionicons name="mail-open-outline" size={16} color={theme.primary} />
      </View>
      <View style={styles.rowCopy}>
        <Text style={[styles.rowTitle, { color: theme.text }]} numberOfLines={1}>
          {invite.invitedEmail}
        </Text>
        <Text style={[styles.rowMeta, { color: theme.textSecondary }]}>
          {roleLabel(invite.role)} · {inviteStatusLabel(invite.status)}
        </Text>
        <Text style={[styles.rowMeta, { color: theme.textTertiary }]} numberOfLines={1}>
          Von {invite.invitedBy.displayName} · bis {formatDateTime(invite.expiresAt)}
        </Text>
      </View>
      {invite.canRevoke ? (
        <MiniAction
          label="Zurückziehen"
          variant="danger"
          onPress={() => onRevoke(invite)}
          disabled={isBusy}
        />
      ) : null}
    </View>
  );
}

function InviteRoleButton({
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
      onPress={onPress}
      style={({ pressed }) => [
        styles.roleButton,
        {
          backgroundColor: active ? theme.primaryMuted : theme.background,
          borderColor: active ? theme.primary : theme.border,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <Text
        style={[
          styles.roleButtonLabel,
          { color: active ? theme.primary : theme.textSecondary },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function MiniAction({
  disabled,
  label,
  onPress,
  variant = 'ghost',
}: {
  disabled: boolean;
  label: string;
  onPress: () => void;
  variant?: 'ghost' | 'outline' | 'danger';
}) {
  const theme = useTheme();
  const colors =
    variant === 'danger'
      ? { backgroundColor: theme.dangerMuted, borderColor: 'transparent', color: theme.danger }
      : variant === 'outline'
        ? { backgroundColor: 'transparent', borderColor: theme.border, color: theme.text }
        : { backgroundColor: theme.primaryMuted, borderColor: 'transparent', color: theme.primary };

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.miniAction,
        {
          backgroundColor: colors.backgroundColor,
          borderColor: colors.borderColor,
          opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
        },
      ]}
    >
      <Text style={[styles.miniActionLabel, { color: colors.color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  content: {
    padding: Spacing.lg,
    gap: Spacing.lg,
  },
  header: {
    gap: Spacing.xs,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  eyebrow: {
    fontFamily: Fonts.mono,
    fontSize: FontSize.xs,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: FontSize['2xl'],
    letterSpacing: -0.6,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  cardTitle: {
    fontFamily: Fonts.display,
    fontSize: FontSize.xl,
    letterSpacing: -0.4,
  },
  sectionMeta: {
    fontFamily: Fonts.mono,
    fontSize: FontSize.xs,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
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
    fontSize: FontSize.lg,
    fontWeight: '700',
  },
  heroSubtitle: {
    fontSize: FontSize.sm,
  },
  input: {
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    fontSize: FontSize.base,
  },
  textArea: {
    minHeight: 96,
    textAlignVertical: 'top',
  },
  body: {
    fontSize: FontSize.base,
    lineHeight: 22,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  buttonCol: {
    flex: 1,
  },
  roleSwitch: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  roleButton: {
    flex: 1,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingVertical: 12,
    alignItems: 'center',
  },
  roleButtonLabel: {
    fontSize: FontSize.sm,
    fontWeight: '700',
  },
  invitePreview: {
    gap: Spacing.sm,
  },
  kicker: {
    fontFamily: Fonts.mono,
    fontSize: FontSize.xs,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  linkText: {
    fontSize: FontSize.sm,
    lineHeight: 20,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
  },
  rowCopy: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontSize: FontSize.base,
    fontWeight: '700',
  },
  rowMeta: {
    fontSize: FontSize.xs,
    lineHeight: 18,
  },
  toolsColumn: {
    gap: Spacing.xs,
    alignItems: 'flex-end',
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  selfBadge: {
    fontFamily: Fonts.mono,
    fontSize: FontSize.xs,
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },
  miniAction: {
    minWidth: 108,
    borderRadius: Radius.md,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    alignItems: 'center',
  },
  miniActionLabel: {
    fontSize: FontSize.xs,
    fontWeight: '700',
  },
  inviteMarker: {
    width: 34,
    height: 34,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
