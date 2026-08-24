import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import Purchases from 'react-native-purchases';
import RevenueCatUI from 'react-native-purchases-ui';
import { T, useGT } from 'gt-react-native';

import { useConvexAuth, useQuery } from 'convex/react';

import type { BillingBalanceSummary } from '@beisammen/contracts';

import { Fonts, FontSize, Radius, Spacing } from '@/constants/theme';
import { enterSection } from '@/lib/motion';
import { configurePurchases } from '@/features/billing/purchases';
import { usePlanPaywall } from '@/features/billing/use-plan-paywall';
import { useSyncPurchases } from '@/features/billing/use-purchase-sync';
import { api } from '@/features/convex/api';
import { formatBytes } from '@/features/media/client';
import { useDateFormat } from '@/i18n/use-date-format';
import { useTheme } from '@/hooks/use-theme';

import { Button, Card, FeedbackToast, LoadingBox, SectionHeader } from '@/components/ui';
import { LegalLinks } from '@/components/billing/LegalLinks';
import { CircleUsageList } from '@/components/settings/CircleUsageList';
import { SettingsScreenHeader } from '@/components/settings/SettingsScreenHeader';
import { UsageMeter } from '@/components/settings/UsageMeter';

const RESET_DATE_FORMAT: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' };

function formatCount(value: number): string {
  return String(value);
}

export default function PlanScreen() {
  const theme = useTheme();
  const gt = useGT();
  const convexAuth = useConvexAuth();
  const viewerState = useQuery(api.users.viewerState, convexAuth.isAuthenticated ? {} : 'skip');
  const hasViewer = viewerState?.isAuthenticated === true && viewerState.viewer !== null;
  const billingStatus = useQuery(api.billing.status, hasViewer ? {} : 'skip');
  const storageStats = useQuery(api.storageStats.forViewer, hasViewer ? {} : 'skip');
  const circleUsage = useQuery(api.storageStats.perCircleForViewer, hasViewer ? {} : 'skip');

  const [feedback, setFeedback] = useState<string | null>(null);
  const [isBillingBusy, setIsBillingBusy] = useState(false);
  const { present: presentPaywall } = usePlanPaywall(setFeedback);
  const syncPurchases = useSyncPurchases();

  const handleShowPaywall = useCallback(async () => {
    setIsBillingBusy(true);

    try {
      await presentPaywall();
    } finally {
      setIsBillingBusy(false);
    }
  }, [presentPaywall]);

  const handleManageBilling = useCallback(async () => {
    if (!configurePurchases()) {
      setFeedback(gt('In-App-Käufe sind in diesem Build nicht konfiguriert.'));
      return;
    }

    setIsBillingBusy(true);
    setFeedback(null);

    try {
      await RevenueCatUI.presentCustomerCenter();
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : gt('Abrechnung konnte nicht geöffnet werden.'),
      );
    } finally {
      setIsBillingBusy(false);
    }
  }, [gt]);

  const handleRestorePurchases = useCallback(async () => {
    if (!configurePurchases()) {
      setFeedback(gt('In-App-Käufe sind in diesem Build nicht konfiguriert.'));
      return;
    }

    setIsBillingBusy(true);
    setFeedback(null);

    try {
      const customerInfo = await Purchases.restorePurchases();
      const restoredCount = Object.keys(customerInfo.entitlements.active).length;

      if (restoredCount > 0) {
        // Mirror the restored entitlement into Convex right away instead of
        // waiting for the RevenueCat webhook.
        await syncPurchases();
        setFeedback(gt('Käufe wurden wiederhergestellt.'));
      } else {
        setFeedback(gt('Für dieses Store-Konto wurden keine aktiven Käufe gefunden.'));
      }
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : gt('Käufe konnten nicht wiederhergestellt werden.'),
      );
    } finally {
      setIsBillingBusy(false);
    }
  }, [gt, syncPurchases]);

  const handleDismissFeedback = useCallback(() => setFeedback(null), []);

  const isSelfHosted = billingStatus?.deployment === 'self-hosted';
  const activePlan =
    billingStatus?.deployment === 'cloud'
      ? billingStatus.plans.find((plan) => billingStatus.activePlanIds.includes(plan.id))
      : undefined;
  const billingConfigured =
    billingStatus?.deployment === 'cloud' && billingStatus.billing.configured;
  const balances = billingStatus?.deployment === 'cloud' ? billingStatus.balances : [];

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]} edges={['top']}>
      <Animated.ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={enterSection(0)}>
          <SettingsScreenHeader eyebrow={gt('Einstellungen')} title={gt('Tarif & Nutzung')} />
        </Animated.View>

        <Animated.View entering={enterSection(1)} style={styles.section}>
          {billingStatus === undefined ? (
            <Card>
              <LoadingBox />
            </Card>
          ) : (
            <Card>
              <View style={styles.planHero}>
                <View
                  style={[
                    styles.planIcon,
                    { backgroundColor: isSelfHosted ? theme.primaryMuted : theme.accentMuted },
                  ]}
                >
                  <Ionicons
                    name={isSelfHosted ? 'server-outline' : 'sparkles-outline'}
                    size={22}
                    color={isSelfHosted ? theme.primary : theme.accent}
                  />
                </View>
                <View style={styles.planCopy}>
                  <Text style={[styles.planName, { color: theme.text }]}>
                    {isSelfHosted
                      ? gt('Self-hosted')
                      : (activePlan?.name ?? gt('Kein aktiver Tarif'))}
                  </Text>
                  <Text style={[styles.planMeta, { color: theme.textSecondary }]}>
                    {isSelfHosted
                      ? gt('Keine Zahlungen. Keine App-Limits.')
                      : billingConfigured
                        ? gt('Dein Tarif gilt für alle Circles, die du besitzt.')
                        : gt('Abrechnung nicht konfiguriert')}
                  </Text>
                </View>
              </View>
            </Card>
          )}
        </Animated.View>

        {balances.length > 0 ? (
          <Animated.View entering={enterSection(2)} style={styles.section}>
            <SectionHeader icon="speedometer-outline" label={gt('Kontingente')} />
            <Card style={styles.metersCard}>
              {balances.map((balance, index) => (
                <BalanceMeter key={balance.featureId} balance={balance} index={index} />
              ))}
            </Card>
          </Animated.View>
        ) : null}

        <Animated.View entering={enterSection(3)} style={styles.section}>
          <SectionHeader icon="images-outline" label={gt('Deine Medien')} />
          {storageStats === undefined ? (
            <Card>
              <LoadingBox />
            </Card>
          ) : (
            <Card>
              <View style={styles.statGrid}>
                <StatTile value={formatCount(storageStats.imageCount)} label={gt('Fotos')} />
                <StatTile value={formatCount(storageStats.videoCount)} label={gt('Videos')} />
                <StatTile
                  value={formatBytes(storageStats.totalSizeBytes) ?? '0 KB'}
                  label={gt('Speicher')}
                />
                <StatTile
                  value={
                    storageStats.isTruncated
                      ? `${storageStats.circleCount}+`
                      : formatCount(storageStats.circleCount)
                  }
                  label={gt('Circles')}
                />
              </View>
            </Card>
          )}
        </Animated.View>

        <Animated.View entering={enterSection(4)} style={styles.section}>
          <SectionHeader icon="albums-outline" label={gt('Nutzung nach Circle')} />
          <CircleUsageList breakdown={circleUsage} />
        </Animated.View>

        {billingStatus?.deployment === 'cloud' ? (
          <Animated.View entering={enterSection(5)} style={styles.section}>
            <SectionHeader icon="card-outline" label={gt('Abrechnung')} />
            <Card>
              <View style={styles.actionRow}>
                {activePlan ? (
                  // The Customer Center knows the active subscription and
                  // offers upgrade, downgrade, and cancellation in context.
                  <Button
                    label={gt('Tarif ändern')}
                    icon="swap-vertical-outline"
                    variant="primary"
                    disabled={!billingConfigured}
                    loading={isBillingBusy}
                    onPress={handleManageBilling}
                  />
                ) : (
                  <Button
                    label={gt('Tarife ansehen')}
                    icon="sparkles-outline"
                    variant="primary"
                    disabled={!billingConfigured}
                    loading={isBillingBusy}
                    onPress={handleShowPaywall}
                  />
                )}
                <Button
                  label={gt('Käufe wiederherstellen')}
                  icon="refresh-outline"
                  variant="ghost"
                  disabled={!billingConfigured || isBillingBusy}
                  onPress={handleRestorePurchases}
                />
              </View>
              <T>
                <Text style={[styles.finePrint, { color: theme.textTertiary }]}>
                  Jederzeit kündbar. Ein Tarif deckt alle Mitglieder deiner Circles ab. Abos
                  verlängern sich automatisch, bis sie in den Store-Einstellungen gekündigt
                  werden.
                </Text>
              </T>
              <LegalLinks style={styles.legalLinks} />
            </Card>
          </Animated.View>
        ) : null}
      </Animated.ScrollView>

      <FeedbackToast message={feedback} onDismiss={handleDismissFeedback} />
    </SafeAreaView>
  );
}

function BalanceMeter({ balance, index }: { balance: BillingBalanceSummary; index: number }) {
  const gt = useGT();
  const resetDateFormat = useDateFormat(RESET_DATE_FORMAT);

  if (balance.granted === null || balance.usage === null) {
    return null;
  }

  const isStorage = balance.featureId === 'storage_bytes';
  const label = isStorage
    ? gt('Speicher')
    : balance.featureId === 'circles'
      ? gt('Eigene Circles')
      : balance.featureId;
  const value = isStorage
    ? (formatBytes(balance.usage) ?? '0 KB')
    : formatCount(balance.usage);
  const quota = balance.unlimited
    ? gt('Unbegrenzt')
    : gt('von {total}', {
        total: isStorage ? (formatBytes(balance.granted) ?? '0 KB') : formatCount(balance.granted),
      });

  const detailParts: string[] = [];

  if (!balance.unlimited && balance.remaining !== null) {
    detailParts.push(
      gt('{rest} übrig', {
        rest: isStorage ? (formatBytes(balance.remaining) ?? '0 KB') : formatCount(balance.remaining),
      }),
    );
  }

  if (balance.nextResetAt !== null) {
    detailParts.push(
      gt('Zurückgesetzt am {date}', { date: resetDateFormat.format(new Date(balance.nextResetAt)) }),
    );
  }

  return (
    <UsageMeter
      label={label}
      value={value}
      quota={quota}
      fraction={
        balance.unlimited || balance.granted <= 0 ? undefined : balance.usage / balance.granted
      }
      detail={detailParts.length > 0 ? detailParts.join(' · ') : undefined}
      delayMs={index * 120}
    />
  );
}

function StatTile({ value, label }: { value: string; label: string }) {
  const theme = useTheme();

  return (
    <View style={styles.statTile}>
      <Text
        style={[styles.statValue, { color: theme.text }]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
      <Text style={[styles.statLabel, { color: theme.textTertiary }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scroll: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing['3xl'],
    gap: Spacing.lg,
  },
  section: {
    gap: Spacing.sm,
  },
  planHero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  planIcon: {
    width: 48,
    height: 48,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  planCopy: {
    flex: 1,
    gap: 2,
  },
  planName: {
    fontFamily: Fonts.display,
    fontSize: FontSize.xl,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  planMeta: {
    fontSize: FontSize.sm,
    lineHeight: 18,
  },
  metersCard: {
    gap: Spacing.xl,
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  statTile: {
    width: '50%',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.md,
  },
  statValue: {
    fontFamily: Fonts.display,
    fontSize: FontSize.xl,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  statLabel: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  actionRow: {
    gap: Spacing.sm,
  },
  finePrint: {
    fontSize: FontSize.xs,
    lineHeight: 16,
    textAlign: 'center',
  },
  legalLinks: {
    marginTop: Spacing.xs,
  },
});
