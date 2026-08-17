import { msg } from 'gt-react-native';

import type { CircleUploadReadiness } from '@beisammen/contracts';

export type UploadReadinessNotice = {
  title: string;
  message: string;
  action: 'choose_plan' | 'owner_required' | 'retry_later';
};

/**
 * Blocks the picker while E2EE keys are not usable yet: uploads encrypt with
 * the circle key, so without it no media can leave the device. Mirrors the
 * status unions of `useCrypto` and `useCircleKeys` structurally so the pure
 * module stays testable without the provider tree.
 */
export function encryptionReadinessNotice(input: {
  cryptoStatus: 'loading' | 'ready' | 'recovery-required' | 'unavailable';
  circleKeysStatus: 'loading' | 'waiting-for-grant' | 'ready';
}): UploadReadinessNotice | null {
  if (input.cryptoStatus === 'recovery-required') {
    return {
      title: msg('Schlüssel wiederherstellen'),
      message: msg('Stelle zuerst deine Verschlüsselung mit deinem Wiederherstellungscode auf diesem Gerät wieder her, bevor du Medien hochlädst.'),
      action: 'retry_later',
    };
  }

  if (input.cryptoStatus !== 'ready') {
    return {
      title: msg('Verschlüsselung wird eingerichtet'),
      message: msg('Die Verschlüsselung wird gerade eingerichtet. Versuche es gleich noch einmal.'),
      action: 'retry_later',
    };
  }

  if (input.circleKeysStatus === 'waiting-for-grant') {
    return {
      title: msg('Verschlüsselung wird eingerichtet'),
      message: msg('Ein anderes Mitglied muss dir den Schlüssel für diesen Circle erst freigeben. Versuche es gleich noch einmal.'),
      action: 'retry_later',
    };
  }

  if (input.circleKeysStatus !== 'ready') {
    return {
      title: msg('Verschlüsselung wird eingerichtet'),
      message: msg('Der Schlüssel für diesen Circle wird noch geladen. Versuche es gleich noch einmal.'),
      action: 'retry_later',
    };
  }

  return null;
}

export function uploadReadinessNotice(
  readiness: CircleUploadReadiness | null | undefined,
): UploadReadinessNotice | null {
  if (!readiness || readiness.canUpload) {
    return null;
  }

  if (readiness.reason === 'billing_check_failed') {
    return {
      title: msg('Abrechnung nicht erreichbar'),
      message: msg('Die Upload-Berechtigung konnte gerade nicht geprüft werden. Versuche es gleich noch einmal.'),
      action: 'retry_later',
    };
  }

  if (readiness.reason === 'billing_not_configured') {
    return {
      title: msg('Abrechnung nicht eingerichtet'),
      message: readiness.viewerIsBillingOwner
        ? msg('Cloud-Abrechnung ist für diese Instanz noch nicht eingerichtet.')
        : msg('Die Cloud-Abrechnung dieser Instanz muss eingerichtet werden, bevor Mitglieder Medien hochladen.'),
      action: 'owner_required',
    };
  }

  if (readiness.reason === 'quota_exceeded') {
    return readiness.viewerIsBillingOwner
      ? {
          title: msg('Monatslimit erreicht'),
          message: msg('Dein Upload-Kontingent für diesen Monat ist aufgebraucht. Wechsle den Tarif oder warte auf den nächsten Monat.'),
          action: 'choose_plan',
        }
      : {
          title: msg('Monatslimit erreicht'),
          message: msg('Das Upload-Kontingent des Circle-Owners ist für diesen Monat aufgebraucht.'),
          action: 'owner_required',
        };
  }

  if (readiness.viewerIsBillingOwner) {
    return {
      title: msg('Tarif erforderlich'),
      message: msg('Wähle einen aktiven Cloud-Tarif, bevor du Medien hochlädst.'),
      action: 'choose_plan',
    };
  }

  return {
    title: msg('Upload pausiert'),
    message: msg('Der Circle-Owner muss die Cloud-Abrechnung aktivieren, bevor Mitglieder Medien hochladen.'),
    action: 'owner_required',
  };
}
