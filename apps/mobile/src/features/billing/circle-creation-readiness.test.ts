import { describe, expect, test } from 'vitest';

import { circleCreationNotice } from './circle-creation-readiness';

describe('circle creation readiness copy', () => {
  test('returns no notice when creation is allowed', () => {
    expect(
      circleCreationNotice({
        deployment: 'cloud',
        canCreate: true,
        billingRequired: true,
        reason: 'ready',
        message: 'ready',
        usedCircles: 1,
        maxCircles: 3,
      }),
    ).toBeNull();
  });

  test('returns no notice while readiness is still loading', () => {
    expect(circleCreationNotice(undefined)).toBeNull();
    expect(circleCreationNotice(null)).toBeNull();
  });

  test('prompts for a plan when none is active', () => {
    expect(
      circleCreationNotice({
        deployment: 'cloud',
        canCreate: false,
        billingRequired: true,
        reason: 'plan_required',
        message: 'plan required',
        usedCircles: 0,
        maxCircles: null,
      }),
    ).toEqual({
      title: 'Tarif erforderlich',
      message: 'Wähle einen aktiven Cloud-Tarif, um einen Circle zu erstellen. Eingeladenen Circles kannst du weiterhin kostenlos beitreten.',
      action: 'choose_plan',
    });
  });

  test('points at the plan limit when it is reached', () => {
    expect(
      circleCreationNotice({
        deployment: 'cloud',
        canCreate: false,
        billingRequired: true,
        reason: 'limit_reached',
        message: 'limit reached',
        usedCircles: 3,
        maxCircles: 3,
      }),
    ).toEqual({
      title: 'Circle-Limit erreicht',
      message: 'Dein Tarif umfasst keine weiteren Circles. Wechsle den Tarif oder lösche einen Circle, um einen neuen zu erstellen.',
      action: 'choose_plan',
    });
  });

  test('suggests retrying when the provider check fails', () => {
    expect(
      circleCreationNotice({
        deployment: 'cloud',
        canCreate: false,
        billingRequired: true,
        reason: 'billing_check_failed',
        message: 'provider unavailable',
        usedCircles: 1,
        maxCircles: null,
      }),
    ).toEqual({
      title: 'Abrechnung nicht erreichbar',
      message: 'Ob du einen Circle erstellen kannst, konnte gerade nicht geprüft werden. Versuche es gleich noch einmal.',
      action: 'retry_later',
    });
  });
});
