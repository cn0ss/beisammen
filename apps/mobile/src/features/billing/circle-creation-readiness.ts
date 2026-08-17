import { msg } from 'gt-react-native';

import type { CircleCreationReadiness } from '@beisammen/contracts';

export type CircleCreationNotice = {
  title: string;
  message: string;
  action: 'choose_plan' | 'retry_later';
};

export function circleCreationNotice(
  readiness: CircleCreationReadiness | null | undefined,
): CircleCreationNotice | null {
  if (!readiness || readiness.canCreate) {
    return null;
  }

  if (readiness.reason === 'billing_check_failed') {
    return {
      title: msg('Abrechnung nicht erreichbar'),
      message: msg('Ob du einen Circle erstellen kannst, konnte gerade nicht geprüft werden. Versuche es gleich noch einmal.'),
      action: 'retry_later',
    };
  }

  if (readiness.reason === 'limit_reached') {
    return {
      title: msg('Circle-Limit erreicht'),
      message: msg('Dein Tarif umfasst keine weiteren Circles. Wechsle den Tarif oder lösche einen Circle, um einen neuen zu erstellen.'),
      action: 'choose_plan',
    };
  }

  return {
    title: msg('Tarif erforderlich'),
    message: msg('Wähle einen aktiven Cloud-Tarif, um einen Circle zu erstellen. Eingeladenen Circles kannst du weiterhin kostenlos beitreten.'),
    action: 'choose_plan',
  };
}
