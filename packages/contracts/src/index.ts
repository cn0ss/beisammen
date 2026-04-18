/** Active provider for new uploads. Legacy data may still reference 'convex-files'. */
export type StorageProviderKind = 's3';

export type AssetKind = 'image' | 'video';
export type UploadStatus = 'draft' | 'processing' | 'uploading' | 'uploaded' | 'failed';
export type AuthProvider = 'workos';
export type AuthMode = 'hosted-browser' | 'native-client';
export type AuthCapability = 'password' | 'email_otp' | 'social' | 'hosted_sso';
export type MediaLocationSource = 'embedded' | 'device-fallback';
export type PublicConfigValue = string | number | boolean | null;

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
  client: {
    minimumAppVersion: string;
  };
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
  fileName?: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  location?: MediaLocation;
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
