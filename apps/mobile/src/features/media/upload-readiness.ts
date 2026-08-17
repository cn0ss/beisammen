import { msg } from 'gt-react-native';

import type { CircleUploadReadiness } from '@beisammen/contracts';

export type UploadReadinessNotice = {
  title: string;
  message: string;
  action: 'choose_plan' | 'owner_required' | 'retry_later';
};

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
