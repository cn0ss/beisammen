import { describe, expect, test } from 'vitest';

import { uploadReadinessNotice } from './upload-readiness';

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
