import { describe, expect, test } from 'vitest';

import {
  encryptionReadinessNotice,
  uploadBlockerNotice,
  uploadReadinessNotice,
} from './upload-readiness';

describe('upload readiness copy', () => {
  test('returns no notice when uploads are allowed', () => {
    expect(
      uploadReadinessNotice({
        deployment: 'cloud',
        canUpload: true,
        viewerIsBillingOwner: true,
        billingRequired: true,
        reason: 'ready',
        message: 'ready',
      }),
    ).toBeNull();
  });

  test('prompts billing owners to choose a plan', () => {
    expect(
      uploadReadinessNotice({
        deployment: 'cloud',
        canUpload: false,
        viewerIsBillingOwner: true,
        billingRequired: true,
        reason: 'plan_required',
        message: 'plan required',
      }),
    ).toEqual({
      title: 'Tarif erforderlich',
      message: 'Wähle einen aktiven Cloud-Tarif, bevor du Medien hochlädst.',
      action: 'choose_plan',
    });
  });

  test('tells members that the billing owner must act', () => {
    expect(
      uploadReadinessNotice({
        deployment: 'cloud',
        canUpload: false,
        viewerIsBillingOwner: false,
        billingRequired: true,
        reason: 'plan_required',
        message: 'owner required',
      }),
    ).toEqual({
      title: 'Upload pausiert',
      message: 'Der Circle-Owner muss die Cloud-Abrechnung aktivieren, bevor Mitglieder Medien hochladen.',
      action: 'owner_required',
    });
  });

  test('does not send billing owners to checkout when the provider check fails', () => {
    expect(
      uploadReadinessNotice({
        deployment: 'cloud',
        canUpload: false,
        viewerIsBillingOwner: true,
        billingRequired: true,
        reason: 'billing_check_failed',
        message: 'provider unavailable',
      }),
    ).toEqual({
      title: 'Abrechnung nicht erreichbar',
      message: 'Die Upload-Berechtigung konnte gerade nicht geprüft werden. Versuche es gleich noch einmal.',
      action: 'retry_later',
    });
  });

  test('allows uploads when user and circle keys are ready', () => {
    expect(
      encryptionReadinessNotice({
        cryptoStatus: 'ready',
        circleKeysStatus: 'ready',
      }),
    ).toBeNull();
  });

  test('blocks uploads while encryption is still being set up', () => {
    expect(
      encryptionReadinessNotice({
        cryptoStatus: 'loading',
        circleKeysStatus: 'loading',
      }),
    ).toEqual({
      title: 'Verschlüsselung wird eingerichtet',
      message: 'Die Verschlüsselung wird gerade eingerichtet. Versuche es gleich noch einmal.',
      action: 'retry_later',
    });
    expect(
      encryptionReadinessNotice({
        cryptoStatus: 'ready',
        circleKeysStatus: 'loading',
      }),
    ).toEqual({
      title: 'Verschlüsselung wird eingerichtet',
      message: 'Der Schlüssel für diesen Circle wird noch geladen. Versuche es gleich noch einmal.',
      action: 'retry_later',
    });
  });

  test('tells the user that another member must grant the circle key', () => {
    expect(
      encryptionReadinessNotice({
        cryptoStatus: 'ready',
        circleKeysStatus: 'waiting-for-grant',
      }),
    ).toEqual({
      title: 'Verschlüsselung wird eingerichtet',
      message: 'Ein anderes Mitglied muss dir den Schlüssel für diesen Circle erst freigeben. Versuche es gleich noch einmal.',
      action: 'retry_later',
    });
  });

  test('asks for key recovery before uploads on an unrecovered device', () => {
    expect(
      encryptionReadinessNotice({
        cryptoStatus: 'recovery-required',
        circleKeysStatus: 'loading',
      }),
    ).toEqual({
      title: 'Schlüssel wiederherstellen',
      message: 'Stelle zuerst deine Verschlüsselung mit deinem Wiederherstellungscode auf diesem Gerät wieder her, bevor du Medien hochlädst.',
      action: 'retry_later',
    });
  });

  test('distinguishes missing billing configuration from a missing plan', () => {
    expect(
      uploadReadinessNotice({
        deployment: 'cloud',
        canUpload: false,
        viewerIsBillingOwner: true,
        billingRequired: true,
        reason: 'billing_not_configured',
        message: 'not configured',
      }),
    ).toEqual({
      title: 'Abrechnung nicht eingerichtet',
      message: 'Cloud-Abrechnung ist für diese Instanz noch nicht eingerichtet.',
      action: 'owner_required',
    });
  });
});

describe('uploadBlockerNotice', () => {
  const ready = {
    deployment: 'cloud' as const,
    canUpload: true,
    viewerIsBillingOwner: true,
    billingRequired: true,
    reason: 'ready' as const,
    message: 'ready',
  };

  test('reports a pending readiness check instead of failing silently', () => {
    expect(
      uploadBlockerNotice({ readiness: null, cryptoStatus: 'ready', circleKeysStatus: 'ready' }),
    ).toMatchObject({ action: 'retry_later' });
  });

  test('prefers the billing notice over key state', () => {
    expect(
      uploadBlockerNotice({
        readiness: { ...ready, canUpload: false, reason: 'plan_required' },
        cryptoStatus: 'loading',
        circleKeysStatus: 'loading',
      }),
    ).toMatchObject({ action: 'choose_plan' });
  });

  test('offers an immediate retry when the crypto bootstrap failed', () => {
    expect(
      uploadBlockerNotice({
        readiness: ready,
        cryptoStatus: 'unavailable',
        circleKeysStatus: 'loading',
      }),
    ).toMatchObject({ action: 'retry_now' });
  });

  test('returns null once billing and keys are usable', () => {
    expect(
      uploadBlockerNotice({ readiness: ready, cryptoStatus: 'ready', circleKeysStatus: 'ready' }),
    ).toBeNull();
  });
});
