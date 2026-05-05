import Ionicons from '@expo/vector-icons/Ionicons';
import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { BillingPlanSummary, BillingStatus } from '@beisammen/contracts';

import { Fonts, FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { Button, Card, LoadingBox } from '@/components/ui';

interface BillingCardProps {
  status: BillingStatus | undefined;
  isBusy?: boolean;
  onManageBilling: () => void;
  onChoosePlan: (planId: string) => void;
}

export const BillingCard = memo(function BillingCard({
  status,
  isBusy = false,
  onManageBilling,
  onChoosePlan,
}: BillingCardProps) {
  const theme = useTheme();

  if (status === undefined) {
    return (
      <Card>
        <LoadingBox />
      </Card>
    );
  }

  if (status.deployment === 'self-hosted') {
    return (
      <Card>
        <View style={styles.header}>
          <View style={[styles.iconCircle, { backgroundColor: theme.primaryMuted }]}>
            <Ionicons name="server-outline" size={19} color={theme.primary} />
          </View>
          <View style={styles.headerCopy}>
            <Text style={[styles.title, { color: theme.text }]}>Self-hosted</Text>
            <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
              Keine Zahlungen. Keine App-Limits.
            </Text>
          </View>
        </View>

        <View style={styles.rows}>
          <InfoRow icon="card-outline" label="Abrechnung" value="Aus" />
          <InfoRow icon="infinite-outline" label="Limits" value="Aus" />
        </View>
      </Card>
    );
  }

  const activePlan = status.plans.find((plan) => status.activePlanIds.includes(plan.id));
  const billingConfigured = status.billing.configured;

  return (
    <Card>
      <View style={styles.header}>
        <View style={[styles.iconCircle, { backgroundColor: theme.accentMuted }]}>
          <Ionicons name="cloud-outline" size={19} color={theme.accent} />
        </View>
        <View style={styles.headerCopy}>
          <Text style={[styles.title, { color: theme.text }]}>Cloud</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
            {billingConfigured ? 'Dein Tarif gilt für eigene Circles.' : 'Autumn nicht konfiguriert'}
          </Text>
        </View>
      </View>

      <View style={styles.rows}>
        <InfoRow
          icon="receipt-outline"
          label="Tarif"
          value={activePlan?.name ?? 'Kein aktiver Tarif'}
        />
        <InfoRow icon="people-circle-outline" label="Gilt für" value="Eigene Circles" />
      </View>

      <View style={styles.actionRow}>
        <Button
          label="Abo verwalten"
          icon="open-outline"
          variant="outline"
          disabled={!billingConfigured}
          loading={isBusy}
          onPress={onManageBilling}
        />
      </View>

      {status.plans.length > 0 ? (
        <View style={[styles.planList, { borderTopColor: theme.borderLight }]}>
          {status.plans.map((plan) => (
            <PlanRow
              key={plan.id}
              plan={plan}
              active={status.activePlanIds.includes(plan.id)}
              disabled={!billingConfigured || isBusy}
              onChoosePlan={onChoosePlan}
            />
          ))}
        </View>
      ) : null}
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
      <Text style={[styles.infoValue, { color: theme.text }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
});

const PlanRow = memo(function PlanRow({
  plan,
  active,
  disabled,
  onChoosePlan,
}: {
  plan: BillingPlanSummary;
  active: boolean;
  disabled: boolean;
  onChoosePlan: (planId: string) => void;
}) {
  const theme = useTheme();

  return (
    <View style={styles.planRow}>
      <View style={styles.planCopy}>
        <Text style={[styles.planName, { color: theme.text }]} numberOfLines={1}>
          {plan.name}
        </Text>
        <Text style={[styles.planMeta, { color: theme.textSecondary }]} numberOfLines={1}>
          {plan.monthlyPriceLabel ?? plan.description ?? plan.id}
        </Text>
      </View>
      <Button
        label={active ? 'Aktiv' : 'Wählen'}
        icon={active ? 'checkmark-circle-outline' : 'arrow-forward-outline'}
        variant={active ? 'ghost' : 'primary'}
        disabled={active || disabled}
        onPress={() => onChoosePlan(plan.id)}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCopy: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: FontSize.lg,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: FontSize.sm,
    fontWeight: '600',
  },
  rows: {
    gap: Spacing.xs,
    marginTop: Spacing.md,
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
    minWidth: 74,
  },
  infoValue: {
    flex: 1,
    fontSize: FontSize.sm,
    fontWeight: '700',
    textAlign: 'right',
  },
  actionRow: {
    marginTop: Spacing.md,
  },
  planList: {
    borderTopWidth: 1,
    gap: Spacing.sm,
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
  },
  planRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  planCopy: {
    flex: 1,
    gap: 2,
  },
  planName: {
    fontSize: FontSize.base,
    fontWeight: '700',
  },
  planMeta: {
    fontSize: FontSize.sm,
    fontWeight: '600',
  },
});
