/** Active provider for new uploads. Legacy data may still reference 'convex-files'. */
export type StorageProviderKind = 's3';

export type AssetKind = 'image' | 'video';
export type UploadStatus = 'draft' | 'processing' | 'uploading' | 'uploaded' | 'failed';
export type AuthProvider = 'workos';
export type AuthMode = 'hosted-browser' | 'native-client';
export type AuthCapability = 'password' | 'email_otp' | 'social' | 'hosted_sso';
export type DeploymentKind = 'cloud' | 'self-hosted';
export type BillingProviderKind = 'autumn';
export type BillingReturnSource = 'checkout' | 'portal';
export type NotificationKind = 'share.published' | 'comment.created' | 'reaction.set';
export type NotificationDeliveryStatus = 'queued' | 'skipped' | 'delivered' | 'failed';
export type MediaLocationSource = 'embedded' | 'device-fallback';
export type PublicConfigValue = string | number | boolean | null;

export const INSTANCE_DISCOVERY_PATH = '/.well-known/beisammen-instance.json';
export const BILLING_RETURN_PATH = '/billing/return';

export const BETA_MAX_MEDIA_SELECTION_COUNT = 10;
export const BETA_MAX_VIDEO_DURATION_SECONDS = 30;
export const COMMENT_MAX_BODY_LENGTH = 1000;
export const REACTION_TOP_EMOJI_LIMIT = 3;

export const SUPPORTED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/heic',
  'image/heif',
  'image/webp',
] as const;

export const SUPPORTED_VIDEO_MIME_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/mov',
] as const;

export interface MediaLocation {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
  label?: string;
  city?: string;
  region?: string;
  country?: string;
  source: MediaLocationSource;
}

export interface EngagementReactionSummary {
  emoji: string;
  count: number;
  reactedByViewer: boolean;
}

export interface EngagementSummary {
  commentCount: number;
  reactionCount: number;
  topReactions: EngagementReactionSummary[];
}

type GraphemeSegment = {
  segment: string;
};

type SegmenterLike = {
  segment(value: string): Iterable<GraphemeSegment>;
};

type SegmenterConstructor = new (
  locale: string | undefined,
  options: { granularity: 'grapheme' },
) => SegmenterLike;

function splitGraphemes(value: string): string[] {
  const segmenterConstructor = (Intl as unknown as { Segmenter?: SegmenterConstructor }).Segmenter;

  if (!segmenterConstructor) {
    return Array.from(value);
  }

  const segmenter = new segmenterConstructor(undefined, { granularity: 'grapheme' });
  return Array.from(segmenter.segment(value), (segment) => segment.segment);
}

function isEmojiGrapheme(value: string): boolean {
  return (
    /\p{Extended_Pictographic}/u.test(value) ||
    /^(?:\p{Regional_Indicator}){2}$/u.test(value) ||
    /^[0-9#*]\uFE0F?\u20E3$/u.test(value)
  );
}

export function normalizeCommentBody(body: string): string {
  const normalized = body.replace(/\r\n?/g, '\n').trim();

  if (normalized.length === 0) {
    throw new Error('Comment body is required.');
  }

  if (normalized.length > COMMENT_MAX_BODY_LENGTH) {
    throw new Error(`Comments must be ${COMMENT_MAX_BODY_LENGTH} characters or shorter.`);
  }

  return normalized;
}

export function normalizeReactionEmoji(value: string): string {
  const normalized = value.trim().normalize('NFC');
  const graphemes = splitGraphemes(normalized);

  if (graphemes.length !== 1) {
    throw new Error('Reaction must be a single emoji.');
  }

  const [emoji] = graphemes;

  if (!emoji || !isEmojiGrapheme(emoji)) {
    throw new Error('Reaction must be an emoji.');
  }

  return emoji;
}

export interface InstanceConfig {
  instance: {
    id: string;
    name: string;
    baseUrl: string;
  };
  backend: {
    convexUrl: string;
  };
  auth: {
    provider: AuthProvider;
    mode: AuthMode;
    capabilities: AuthCapability[];
    publicConfig: Record<string, PublicConfigValue>;
  };
  features: {
    storageProviders: StorageProviderKind[];
    selfHosted: boolean;
  };
  deployment: {
    kind: DeploymentKind;
  };
  billing:
    | {
        enabled: true;
        provider: BillingProviderKind;
        plans?: BillingPlanSummary[];
      }
    | {
        enabled: false;
        provider?: never;
        plans?: never;
      };
  client: {
    minimumAppVersion: string;
  };
}

export interface BillingPlanSummary {
  id: string;
  name: string;
  description?: string;
  monthlyPriceLabel?: string;
}

export interface BillingBalanceSummary {
  featureId: string;
  granted: number | null;
  remaining: number | null;
  usage: number | null;
  unlimited: boolean;
  overageAllowed: boolean;
  nextResetAt: number | null;
}

export interface BillingSubscriptionSummary {
  planId: string;
  status: string;
  currentPeriodEnd?: number | null;
}

export type BillingStatus =
  | {
      deployment: 'self-hosted';
      billing: {
        enabled: false;
        configured: false;
      };
      plans: [];
      activePlanIds: [];
      subscriptions: [];
      balances: [];
    }
  | {
      deployment: 'cloud';
      billing: {
        enabled: true;
        configured: boolean;
        provider: 'autumn';
        customerId?: string;
      };
      plans: BillingPlanSummary[];
      activePlanIds: string[];
      subscriptions: BillingSubscriptionSummary[];
      balances: BillingBalanceSummary[];
    };

export interface BillingCheckoutResult {
  billingEnabled: boolean;
  checkoutUrl: string | null;
}

export interface BillingPortalSessionResult {
  billingEnabled: boolean;
  portalUrl: string | null;
}

export interface CircleUploadReadiness {
  deployment: DeploymentKind;
  canUpload: boolean;
  viewerIsBillingOwner: boolean;
  billingRequired: boolean;
  reason:
    | 'self_hosted'
    | 'ready'
    | 'billing_not_configured'
    | 'plan_required'
    | 'billing_check_failed';
  message: string;
}

export interface NotificationDeviceRegistration {
  deviceId: string;
  instanceUrl: string;
  platform: 'ios' | 'android' | 'web' | 'unknown';
  provider: 'expo';
  registeredAt: number;
}

export interface NotificationPreference {
  kind: NotificationKind;
  enabled: boolean;
  updatedAt: number | null;
}

export interface AppSession {
  instanceUrl: string;
  provider: AuthProvider;
  subject: string;
  email?: string;
  displayName?: string;
  avatarUrl?: string;
  expiresAt?: number;
  capabilities: AuthCapability[];
}

export interface AuthSessionResult {
  session: AppSession;
  accessToken?: string;
  refreshToken?: string;
}

export type AuthBeginSignInResult =
  | {
      type: 'open-browser';
      authUrl: string;
    }
  | {
      type: 'session';
      result: AuthSessionResult;
    };

export interface AuthAdapter {
  beginSignIn(input: {
    instance: InstanceConfig;
    redirectUrl: string;
  }): Promise<AuthBeginSignInResult>;
  handleCallback(input: {
    instance: InstanceConfig;
    callbackUrl: string;
    currentSession: AppSession | null;
  }): Promise<AuthSessionResult | null>;
  refreshSession(input: {
    instance: InstanceConfig;
    currentSession: AppSession | null;
    refreshToken: string;
  }): Promise<AuthSessionResult | null>;
  restoreSession(input: {
    instance: InstanceConfig;
    currentSession: AppSession | null;
  }): Promise<AppSession | null>;
  signOut(input: {
    instance: InstanceConfig;
    currentSession: AppSession | null;
  }): Promise<void>;
  getCurrentSession(input: {
    currentSession: AppSession | null;
  }): AppSession | null;
}

const authProviders: AuthProvider[] = ['workos'];
const authModes: AuthMode[] = ['hosted-browser', 'native-client'];
const authCapabilities: AuthCapability[] = [
  'password',
  'email_otp',
  'social',
  'hosted_sso',
];
const storageProviders: StorageProviderKind[] = ['s3'];
const deploymentKinds: DeploymentKind[] = ['cloud', 'self-hosted'];
const billingProviders: BillingProviderKind[] = ['autumn'];

type ParsedAppVersion = {
  parts: [number, number, number];
  prerelease: string[] | null;
};

function normalizeVersionComparison(value: number): -1 | 0 | 1 {
  if (value < 0) {
    return -1;
  }

  if (value > 0) {
    return 1;
  }

  return 0;
}

function parseAppVersion(value: string, fieldName: string): ParsedAppVersion {
  const trimmed = value.trim();
  const withoutBuildMetadata = trimmed.split('+', 1)[0];
  const [core, prereleaseValue] = withoutBuildMetadata.split('-', 2);
  const identifiers = core.split('.');

  if (
    trimmed.length === 0 ||
    identifiers.length > 3 ||
    identifiers.some((identifier) => !/^\d+$/.test(identifier))
  ) {
    throw new Error(`${fieldName} must be a semantic app version.`);
  }

  return {
    parts: [
      Number(identifiers[0]),
      Number(identifiers[1] ?? 0),
      Number(identifiers[2] ?? 0),
    ],
    prerelease:
      prereleaseValue && prereleaseValue.trim().length > 0
        ? prereleaseValue.split('.')
        : null,
  };
}

function comparePrereleaseVersions(
  left: string[] | null,
  right: string[] | null,
): -1 | 0 | 1 {
  if (!left && !right) {
    return 0;
  }

  if (!left) {
    return 1;
  }

  if (!right) {
    return -1;
  }

  const maxLength = Math.max(left.length, right.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = left[index];
    const rightValue = right[index];

    if (leftValue === undefined) {
      return -1;
    }

    if (rightValue === undefined) {
      return 1;
    }

    if (leftValue === rightValue) {
      continue;
    }

    const leftIsNumeric = /^\d+$/.test(leftValue);
    const rightIsNumeric = /^\d+$/.test(rightValue);

    if (leftIsNumeric && rightIsNumeric) {
      return normalizeVersionComparison(Number(leftValue) - Number(rightValue));
    }

    if (leftIsNumeric) {
      return -1;
    }

    if (rightIsNumeric) {
      return 1;
    }

    return normalizeVersionComparison(leftValue.localeCompare(rightValue));
  }

  return 0;
}

export function compareAppVersions(
  currentVersion: string,
  minimumVersion: string,
): -1 | 0 | 1 {
  const current = parseAppVersion(currentVersion, 'current app version');
  const minimum = parseAppVersion(minimumVersion, 'minimum app version');

  for (let index = 0; index < current.parts.length; index += 1) {
    const compared = normalizeVersionComparison(
      current.parts[index] - minimum.parts[index],
    );

    if (compared !== 0) {
      return compared;
    }
  }

  return comparePrereleaseVersions(current.prerelease, minimum.prerelease);
}

export function isAppVersionSupported(
  currentVersion: string,
  minimumVersion: string,
): boolean {
  return compareAppVersions(currentVersion, minimumVersion) >= 0;
}

export function assertAppVersionSupported(
  currentVersion: string,
  minimumVersion: string,
): void {
  if (isAppVersionSupported(currentVersion, minimumVersion)) {
    return;
  }

  throw new Error(
    `This instance requires app version ${minimumVersion} or newer. Current app version is ${currentVersion}.`,
  );
}

export type ConvexFilesStorageReference = {
  provider: 'convex-files';
  storageId: string;
};

export type S3StorageReference = {
  provider: 's3';
  objectKey: string;
  bucket: string;
  region?: string;
  endpoint?: string;
  basePath?: string;
};

export type StorageReference = ConvexFilesStorageReference | S3StorageReference;

export type UploadTarget = {
  provider: 's3';
  uploadUrl: string;
  method: 'PUT';
  objectKey: string;
  expiresAt: number;
  headers?: Record<string, string>;
};

export interface StoredObject {
  storage: StorageReference;
  checksum?: string;
  sizeBytes?: number;
}

export interface SignedReadUrl {
  url: string | null;
  expiresAt: number | null;
}

export interface ConnectionCheck {
  ok: boolean;
  message: string;
}

export interface InstanceStorageStatus {
  providerKind: StorageProviderKind;
  label: string;
  bucket?: string;
  region?: string;
  endpoint?: string;
  basePath?: string;
}

export interface StorageUsageStats {
  imageCount: number;
  videoCount: number;
  totalSizeBytes: number;
  circleCount: number;
  isTruncated: boolean;
}

export interface CreateUploadTargetInput {
  circleId: string;
  shareBatchId: string;
  mimeType: string;
  kind: AssetKind;
  fileName: string;
}

export interface CompleteUploadInput {
  uploadId: string;
  storageId?: string;
  objectKey?: string;
  previewStorageId?: string;
  previewObjectKey?: string;
  fileName?: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  location?: MediaLocation;
  capturedAt?: number;
}

export interface ReadObjectInput {
  storage: StorageReference;
}

export interface DeleteObjectInput {
  storage: StorageReference;
}

export interface StorageAdapter {
  createUploadTarget(input: CreateUploadTargetInput): Promise<UploadTarget>;
  completeUpload(input: CompleteUploadInput): Promise<StoredObject>;
  getReadUrl(input: ReadObjectInput): Promise<SignedReadUrl>;
  deleteObject(input: DeleteObjectInput): Promise<void>;
}

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

export function isAuthProvider(value: unknown): value is AuthProvider {
  return typeof value === 'string' && authProviders.includes(value as AuthProvider);
}

export function isAuthMode(value: unknown): value is AuthMode {
  return typeof value === 'string' && authModes.includes(value as AuthMode);
}

export function isAuthCapability(value: unknown): value is AuthCapability {
  return typeof value === 'string' && authCapabilities.includes(value as AuthCapability);
}

export function isStorageProviderKind(value: unknown): value is StorageProviderKind {
  return typeof value === 'string' && storageProviders.includes(value as StorageProviderKind);
}

export function isDeploymentKind(value: unknown): value is DeploymentKind {
  return typeof value === 'string' && deploymentKinds.includes(value as DeploymentKind);
}

export function isBillingProviderKind(value: unknown): value is BillingProviderKind {
  return typeof value === 'string' && billingProviders.includes(value as BillingProviderKind);
}

export interface BuildWorkOSInstanceConfigInput {
  id: string;
  name: string;
  baseUrl: string;
  convexUrl: string;
  authMode: AuthMode;
  authClientId?: string;
  authSignInUrl?: string;
  capabilities?: AuthCapability[];
  deploymentKind?: DeploymentKind;
  billingPlans?: BillingPlanSummary[];
  /** @deprecated use deploymentKind instead. */
  selfHosted?: boolean;
  minimumAppVersion: string;
}

function normalizePublicUrl(value: string, fieldName: string): string {
  const trimmed = normalizeBaseUrl(value);

  try {
    const url = new URL(trimmed);

    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error(`${fieldName} must use http or https.`);
    }

    return normalizeBaseUrl(url.toString());
  } catch (error) {
    if (error instanceof Error && error.message.includes('must use http or https')) {
      throw error;
    }

    throw new Error(`${fieldName} must be a valid absolute URL.`);
  }
}

function requireRecord(value: unknown, fieldName: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }

  return value.trim();
}

function requireBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${fieldName} must be a boolean.`);
  }

  return value;
}

function parseDeploymentKind(value: unknown, fallback: DeploymentKind): DeploymentKind {
  if (value === undefined) {
    return fallback;
  }

  if (!isDeploymentKind(value)) {
    throw new Error(`Unsupported deployment kind "${String(value)}".`);
  }

  return value;
}

function parseBillingPlans(value: unknown): BillingPlanSummary[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error('billing.plans must be an array.');
  }

  return value.map((plan, index) => {
    const record = requireRecord(plan, `billing.plans[${index}]`);

    return {
      id: requireString(record.id, `billing.plans[${index}].id`),
      name: requireString(record.name, `billing.plans[${index}].name`),
      ...(typeof record.description === 'string' && record.description.trim()
        ? { description: record.description.trim() }
        : {}),
      ...(typeof record.monthlyPriceLabel === 'string' && record.monthlyPriceLabel.trim()
        ? { monthlyPriceLabel: record.monthlyPriceLabel.trim() }
        : {}),
    };
  });
}

function buildBillingConfig(input: {
  deploymentKind: DeploymentKind;
  billing?: unknown;
  billingPlans?: BillingPlanSummary[];
}): InstanceConfig['billing'] {
  if (input.billing === undefined) {
    return input.deploymentKind === 'cloud'
      ? {
          enabled: true,
          provider: 'autumn',
          ...(input.billingPlans ? { plans: input.billingPlans } : {}),
        }
      : { enabled: false };
  }

  const billing = requireRecord(input.billing, 'billing');
  const enabled = requireBoolean(billing.enabled, 'billing.enabled');

  if (!enabled) {
    if (input.deploymentKind === 'cloud') {
      throw new Error('Cloud deployments must use Autumn billing.');
    }

    return { enabled: false };
  }

  if (!isBillingProviderKind(billing.provider)) {
    throw new Error('Cloud deployments must use Autumn billing.');
  }

  if (input.deploymentKind !== 'cloud') {
    throw new Error('Self-hosted deployments must not enable billing.');
  }

  const plans = parseBillingPlans(billing.plans);

  return {
    enabled: true,
    provider: billing.provider,
    ...(plans ? { plans } : {}),
  };
}

function isPublicConfigValue(value: unknown): value is PublicConfigValue {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

function parsePublicConfig(value: unknown): Record<string, PublicConfigValue> {
  const record = requireRecord(value, 'auth.publicConfig');
  const parsed: Record<string, PublicConfigValue> = {};

  for (const [key, configValue] of Object.entries(record)) {
    if (key.trim().length === 0) {
      throw new Error('auth.publicConfig keys must be non-empty strings.');
    }

    if (!isPublicConfigValue(configValue)) {
      throw new Error(`auth.publicConfig.${key} must be public JSON scalar value.`);
    }

    parsed[key] = configValue;
  }

  return parsed;
}

function requirePublicConfigString(
  publicConfig: Record<string, PublicConfigValue>,
  key: string,
  fieldName: string,
): string {
  return requireString(publicConfig[key], fieldName);
}

function validateConvexClientUrl(convexUrl: string): void {
  if (convexUrl.includes('.site')) {
    throw new Error('backend.convexUrl should be the Convex client URL, not the site URL.');
  }
}

function validateAuthPublicConfig(
  mode: AuthMode,
  publicConfig: Record<string, PublicConfigValue>,
): void {
  if (mode === 'native-client') {
    requirePublicConfigString(publicConfig, 'clientId', 'auth.publicConfig.clientId');
    return;
  }

  normalizePublicUrl(
    requirePublicConfigString(publicConfig, 'signInUrl', 'auth.publicConfig.signInUrl'),
    'auth.publicConfig.signInUrl',
  );
}

function validateSelfHostedFlag(
  selfHosted: boolean,
  deploymentKind: DeploymentKind,
): void {
  if (selfHosted !== (deploymentKind === 'self-hosted')) {
    throw new Error('features.selfHosted must match deployment.kind.');
  }
}

function parseAuthCapabilities(value: unknown): AuthCapability[] {
  if (!Array.isArray(value)) {
    throw new Error('auth.capabilities must be an array.');
  }

  return value.map((capability) => {
    if (!isAuthCapability(capability)) {
      throw new Error(`Unsupported auth capability "${String(capability)}".`);
    }

    return capability;
  });
}

function parseStorageProviders(value: unknown): StorageProviderKind[] {
  if (!Array.isArray(value)) {
    throw new Error('features.storageProviders must be an array.');
  }

  return value.map((provider) => {
    if (!isStorageProviderKind(provider)) {
      throw new Error(`Unsupported storage provider "${String(provider)}".`);
    }

    return provider;
  });
}

export function buildInstanceDiscoveryUrl(baseUrl: string): string {
  return `${normalizePublicUrl(baseUrl, 'instance base URL')}${INSTANCE_DISCOVERY_PATH}`;
}

export function normalizeBillingReturnSource(value: unknown): BillingReturnSource {
  return value === 'portal' ? 'portal' : 'checkout';
}

export function buildBillingReturnUrl(
  baseUrl: string,
  source: BillingReturnSource,
): string {
  const url = new URL(BILLING_RETURN_PATH, `${normalizePublicUrl(baseUrl, 'instance base URL')}/`);
  url.searchParams.set('source', source);
  return url.toString();
}

export function assertInstanceBaseUrlMatches(
  config: InstanceConfig,
  expectedBaseUrl: string,
): void {
  const expected = normalizePublicUrl(expectedBaseUrl, 'instance base URL');

  if (config.instance.baseUrl !== expected) {
    throw new Error(
      `instance.baseUrl ${config.instance.baseUrl} does not match requested instance URL ${expected}.`,
    );
  }
}

export function buildWorkOSInstanceConfig(
  input: BuildWorkOSInstanceConfigInput,
): InstanceConfig {
  const baseUrl = normalizePublicUrl(input.baseUrl, 'instance.baseUrl');
  const deploymentKind = input.deploymentKind ?? (input.selfHosted ? 'self-hosted' : 'cloud');
  const publicConfig: Record<string, PublicConfigValue> = {
    redirectPath: 'auth/callback',
  };
  const authClientId = input.authClientId?.trim();
  const authSignInUrl = input.authSignInUrl?.trim();

  if (authClientId) {
    publicConfig.clientId = authClientId;
  }

  if (input.authMode === 'hosted-browser') {
    publicConfig.signInUrl = authSignInUrl
      ? normalizePublicUrl(authSignInUrl, 'auth.publicConfig.signInUrl')
      : `${baseUrl}/auth/sign-in`;
  }

  return {
    instance: {
      id: requireString(input.id, 'instance.id'),
      name: requireString(input.name, 'instance.name'),
      baseUrl,
    },
    backend: {
      convexUrl: normalizePublicUrl(input.convexUrl, 'backend.convexUrl'),
    },
    auth: {
      provider: 'workos',
      mode: input.authMode,
      capabilities: input.capabilities ?? [...authCapabilities],
      publicConfig,
    },
    features: {
      storageProviders: ['s3'],
      selfHosted: deploymentKind === 'self-hosted',
    },
    deployment: {
      kind: deploymentKind,
    },
    billing: buildBillingConfig({
      deploymentKind,
      billingPlans: input.billingPlans,
    }),
    client: {
      minimumAppVersion: requireString(input.minimumAppVersion, 'client.minimumAppVersion'),
    },
  };
}

export function parseInstanceConfig(value: unknown): InstanceConfig {
  const root = requireRecord(value, 'instance config');
  const instance = requireRecord(root.instance, 'instance');
  const backend = requireRecord(root.backend, 'backend');
  const auth = requireRecord(root.auth, 'auth');
  const features = requireRecord(root.features, 'features');
  const fallbackDeploymentKind =
    features.selfHosted === true ? 'self-hosted' : 'cloud';
  const deployment =
    root.deployment === undefined
      ? { kind: fallbackDeploymentKind }
      : requireRecord(root.deployment, 'deployment');
  const deploymentKind = parseDeploymentKind(deployment.kind, fallbackDeploymentKind);
  const client = requireRecord(root.client, 'client');
  const provider = auth.provider;
  const mode = auth.mode;

  if (!isAuthProvider(provider)) {
    throw new Error(`Unsupported auth provider "${String(provider)}".`);
  }

  if (!isAuthMode(mode)) {
    throw new Error(`Unsupported auth mode "${String(mode)}".`);
  }

  const convexUrl = normalizePublicUrl(
    requireString(backend.convexUrl, 'backend.convexUrl'),
    'backend.convexUrl',
  );
  const publicConfig = parsePublicConfig(auth.publicConfig);
  const selfHosted =
    features.selfHosted === undefined
      ? deploymentKind === 'self-hosted'
      : requireBoolean(features.selfHosted, 'features.selfHosted');

  validateConvexClientUrl(convexUrl);
  validateAuthPublicConfig(mode, publicConfig);
  validateSelfHostedFlag(selfHosted, deploymentKind);

  return {
    instance: {
      id: requireString(instance.id, 'instance.id'),
      name: requireString(instance.name, 'instance.name'),
      baseUrl: normalizePublicUrl(
        requireString(instance.baseUrl, 'instance.baseUrl'),
        'instance.baseUrl',
      ),
    },
    backend: {
      convexUrl,
    },
    auth: {
      provider,
      mode,
      capabilities: parseAuthCapabilities(auth.capabilities),
      publicConfig,
    },
    features: {
      storageProviders: parseStorageProviders(features.storageProviders),
      selfHosted,
    },
    deployment: {
      kind: deploymentKind,
    },
    billing: buildBillingConfig({
      deploymentKind,
      billing: root.billing,
    }),
    client: {
      minimumAppVersion: requireString(client.minimumAppVersion, 'client.minimumAppVersion'),
    },
  };
}
