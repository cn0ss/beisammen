import { describe, expect, test } from 'vitest';

import {
  pushRegistrationReadiness,
  resolveExpoProjectId,
} from './push-registration';

describe('push registration readiness', () => {
  test('skips web registration', () => {
    expect(
      pushRegistrationReadiness({
        isDevice: true,
        platform: 'web',
        projectId: 'project-1',
      }),
    ).toEqual({ canRegister: false, reason: 'web' });
  });

  test('skips iOS simulator registration', () => {
    expect(
      pushRegistrationReadiness({
        isDevice: false,
        platform: 'ios',
        projectId: 'project-1',
      }),
    ).toEqual({ canRegister: false, reason: 'simulator' });
  });

  test('skips Android emulator registration', () => {
    expect(
      pushRegistrationReadiness({
        isDevice: false,
        platform: 'android',
        projectId: 'project-1',
      }),
    ).toEqual({ canRegister: false, reason: 'simulator' });
  });

  test('allows physical iOS and Android registration when project id is configured', () => {
    expect(
      pushRegistrationReadiness({
        isDevice: true,
        platform: 'ios',
        projectId: 'project-1',
      }),
    ).toEqual({ canRegister: true, projectId: 'project-1' });

    expect(
      pushRegistrationReadiness({
        isDevice: true,
        platform: 'android',
        projectId: 'project-1',
      }),
    ).toEqual({ canRegister: true, projectId: 'project-1' });
  });

  test('skips physical device registration when project id is missing', () => {
    expect(
      pushRegistrationReadiness({
        isDevice: true,
        platform: 'ios',
        projectId: undefined,
      }),
    ).toEqual({ canRegister: false, reason: 'missing_project_id' });
  });
});

describe('Expo project id resolution', () => {
  test('prefers EAS config project id over Expo extra project id', () => {
    expect(
      resolveExpoProjectId({
        easConfig: { projectId: 'eas-project' },
        expoConfig: { extra: { eas: { projectId: 'extra-project' } } },
      }),
    ).toBe('eas-project');
  });

  test('falls back to Expo extra project id', () => {
    expect(
      resolveExpoProjectId({
        easConfig: null,
        expoConfig: { extra: { eas: { projectId: 'extra-project' } } },
      }),
    ).toBe('extra-project');
  });

  test('ignores blank project ids', () => {
    expect(
      resolveExpoProjectId({
        easConfig: { projectId: '   ' },
        expoConfig: { extra: { eas: { projectId: '' } } },
      }),
    ).toBeUndefined();
  });
});
