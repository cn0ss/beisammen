type ExpoProjectConfig = {
  easConfig?: {
    projectId?: unknown;
  } | null;
  expoConfig?: {
    extra?: {
      eas?: unknown;
    } | null;
  } | null;
};

export type PushRegistrationPlatform = 'ios' | 'android' | 'web' | 'unknown';

export type PushRegistrationReadiness =
  | {
      canRegister: true;
      projectId: string;
    }
  | {
      canRegister: false;
      reason: 'web' | 'simulator' | 'missing_project_id' | 'unsupported_platform';
    };

function normalizeProjectId(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function resolveExpoProjectId(config: ExpoProjectConfig): string | undefined {
  const easProjectId = normalizeProjectId(config.easConfig?.projectId);

  if (easProjectId) {
    return easProjectId;
  }

  const extraEas = config.expoConfig?.extra?.eas;

  if (!extraEas || typeof extraEas !== 'object' || Array.isArray(extraEas)) {
    return undefined;
  }

  return normalizeProjectId((extraEas as { projectId?: unknown }).projectId);
}

export function pushRegistrationReadiness(input: {
  platform: PushRegistrationPlatform;
  isDevice: boolean;
  projectId: string | undefined;
}): PushRegistrationReadiness {
  if (input.platform === 'web') {
    return { canRegister: false, reason: 'web' };
  }

  if (input.platform !== 'ios' && input.platform !== 'android') {
    return { canRegister: false, reason: 'unsupported_platform' };
  }

  if (!input.isDevice) {
    return { canRegister: false, reason: 'simulator' };
  }

  const projectId = normalizeProjectId(input.projectId);

  if (!projectId) {
    return { canRegister: false, reason: 'missing_project_id' };
  }

  return { canRegister: true, projectId };
}
