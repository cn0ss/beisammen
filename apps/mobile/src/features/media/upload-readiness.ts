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
      title: 'Abrechnung nicht erreichbar',
      message: 'Die Upload-Berechtigung konnte gerade nicht geprüft werden. Versuche es gleich noch einmal.',
      action: 'retry_later',
    };
  }

  if (readiness.reason === 'billing_not_configured') {
    return {
      title: 'Abrechnung nicht eingerichtet',
      message: readiness.viewerIsBillingOwner
        ? 'Cloud-Abrechnung ist für diese Instanz noch nicht eingerichtet.'
        : 'Die Cloud-Abrechnung dieser Instanz muss eingerichtet werden, bevor Mitglieder Medien hochladen.',
      action: 'owner_required',
    };
  }

  if (readiness.viewerIsBillingOwner) {
    return {
      title: 'Tarif erforderlich',
      message: 'Wähle einen aktiven Cloud-Tarif, bevor du Medien hochlädst.',
      action: 'choose_plan',
    };
  }

  return {
    title: 'Upload pausiert',
    message: 'Der Circle-Owner muss die Cloud-Abrechnung aktivieren, bevor Mitglieder Medien hochladen.',
    action: 'owner_required',
  };
}
