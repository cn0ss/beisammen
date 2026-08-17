import {
  BETA_MAX_MEDIA_SELECTION_COUNT,
  BETA_MAX_VIDEO_DURATION_SECONDS,
  type BillingPlanSummary,
  type DeploymentKind,
} from '@beisammen/contracts';

export { BETA_MAX_MEDIA_SELECTION_COUNT, BETA_MAX_VIDEO_DURATION_SECONDS };

type EnvSource = Record<string, string | undefined>;

export interface DeploymentPolicy {
  kind: DeploymentKind;
  isCloud: boolean;
  isSelfHosted: boolean;
  billing:
    | {
        enabled: true;
        provider: 'revenuecat';
      }
    | {
        enabled: false;
      };
  limits: {
    mediaSelectionCount: number | null;
    videoDurationSeconds: number | null;
  };
}

export const CLOUD_BILLING_PROVIDER = 'revenuecat';

// Display names only — entitlement/product ids stay cloud_plus/cloud_max.
export const DEFAULT_CLOUD_BILLING_PLANS: BillingPlanSummary[] = [
  {
    id: 'cloud_plus',
    name: 'Plus',
    description: 'Bis zu 3 Circles, 100 GB gemeinsamer Speicher.',
    monthlyPriceLabel: '$5.99/month',
    yearlyPriceLabel: '$49.99/year',
  },
  {
    id: 'cloud_max',
    name: 'Max',
    description: 'Bis zu 10 Circles, 250 GB und größeres Upload-Kontingent.',
    monthlyPriceLabel: '$11.99/month',
    yearlyPriceLabel: '$99.99/year',
  },
];

function readOptionalEnv(name: string, env: EnvSource): string | null {
  const value = env[name];

  if (!value || value.trim().length === 0) {
    return null;
  }

  return value.trim();
}

export function readDeploymentKindFromEnv(env: EnvSource = process.env): DeploymentKind {
  const configured =
    readOptionalEnv('PUBLIC_DEPLOYMENT_KIND', env) ??
    readOptionalEnv('DEPLOYMENT_KIND', env);

  if (configured === 'cloud' || configured === 'self-hosted') {
    return configured;
  }

  if (configured) {
    throw new Error(
      `Invalid deployment kind "${configured}". Expected "cloud" or "self-hosted".`,
    );
  }

  const legacySelfHosted = readOptionalEnv('PUBLIC_SELF_HOSTED', env);

  if (legacySelfHosted === 'true') {
    return 'self-hosted';
  }

  if (legacySelfHosted && legacySelfHosted !== 'false') {
    throw new Error(
      `Invalid PUBLIC_SELF_HOSTED "${legacySelfHosted}". Expected "true" or "false".`,
    );
  }

  return 'cloud';
}

export function getDeploymentPolicyFromEnv(env: EnvSource = process.env): DeploymentPolicy {
  const kind = readDeploymentKindFromEnv(env);

  if (kind === 'self-hosted') {
    return {
      kind,
      isCloud: false,
      isSelfHosted: true,
      billing: {
        enabled: false,
      },
      limits: {
        mediaSelectionCount: null,
        videoDurationSeconds: null,
      },
    };
  }

  return {
    kind,
    isCloud: true,
    isSelfHosted: false,
    billing: {
      enabled: true,
      provider: CLOUD_BILLING_PROVIDER,
    },
    limits: {
      mediaSelectionCount: BETA_MAX_MEDIA_SELECTION_COUNT,
      videoDurationSeconds: BETA_MAX_VIDEO_DURATION_SECONDS,
    },
  };
}

export function isSelfHostedDeployment(env: EnvSource = process.env): boolean {
  return getDeploymentPolicyFromEnv(env).isSelfHosted;
}

export function getCurrentMediaSelectionLimit(): number | null {
  return getDeploymentPolicyFromEnv().limits.mediaSelectionCount;
}

export function getCurrentVideoDurationLimit(): number | null {
  return getDeploymentPolicyFromEnv().limits.videoDurationSeconds;
}

export function readCloudBillingPlansFromEnv(
  env: EnvSource = process.env,
): BillingPlanSummary[] {
  const configured = readOptionalEnv('PUBLIC_BILLING_PLANS', env);

  if (!configured) {
    return DEFAULT_CLOUD_BILLING_PLANS;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(configured);
  } catch {
    throw new Error('PUBLIC_BILLING_PLANS must be a JSON array.');
  }

  if (!Array.isArray(parsed)) {
    throw new Error('PUBLIC_BILLING_PLANS must be a JSON array.');
  }

  return parsed.map((plan, index) => {
    if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
      throw new Error(`PUBLIC_BILLING_PLANS[${index}] must be an object.`);
    }

    const record = plan as Record<string, unknown>;

    if (typeof record.id !== 'string' || record.id.trim().length === 0) {
      throw new Error(`PUBLIC_BILLING_PLANS[${index}].id must be a non-empty string.`);
    }

    if (typeof record.name !== 'string' || record.name.trim().length === 0) {
      throw new Error(`PUBLIC_BILLING_PLANS[${index}].name must be a non-empty string.`);
    }

    return {
      id: record.id.trim(),
      name: record.name.trim(),
      ...(typeof record.description === 'string' && record.description.trim().length > 0
        ? { description: record.description.trim() }
        : {}),
      ...(typeof record.monthlyPriceLabel === 'string' &&
      record.monthlyPriceLabel.trim().length > 0
        ? { monthlyPriceLabel: record.monthlyPriceLabel.trim() }
        : {}),
      ...(typeof record.yearlyPriceLabel === 'string' &&
      record.yearlyPriceLabel.trim().length > 0
        ? { yearlyPriceLabel: record.yearlyPriceLabel.trim() }
        : {}),
    };
  });
}
