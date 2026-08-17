/// <reference types="vite/client" />

import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';

import { api, internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);

function createTest() {
  return convexTest(schema, modules);
}

describe('appConfig', () => {
  test('get returns null when no config row exists', async () => {
    const t = createTest();

    expect(await t.query(api.appConfig.get, {})).toBeNull();
  });

  test('set and get round-trip', async () => {
    const t = createTest();

    await t.mutation(internal.appConfig.set, {
      minSupportedAppVersion: '1.1',
      forceUpdateMessage: 'Bitte aktualisieren.',
    });

    expect(await t.query(api.appConfig.get, {})).toEqual({
      minSupportedAppVersion: '1.1',
      forceUpdateMessage: 'Bitte aktualisieren.',
      maintenanceMode: false,
      maintenanceMessage: null,
    });
  });

  test('set replaces the whole config, clearing omitted fields', async () => {
    const t = createTest();

    await t.mutation(internal.appConfig.set, {
      minSupportedAppVersion: '1.1',
      maintenanceMode: true,
    });
    await t.mutation(internal.appConfig.set, {});

    expect(await t.query(api.appConfig.get, {})).toEqual({
      minSupportedAppVersion: null,
      forceUpdateMessage: null,
      maintenanceMode: false,
      maintenanceMessage: null,
    });
  });

  test('set rejects an unparseable minimum version', async () => {
    const t = createTest();

    await expect(
      t.mutation(internal.appConfig.set, { minSupportedAppVersion: 'kaputt' }),
    ).rejects.toThrow();

    expect(await t.query(api.appConfig.get, {})).toBeNull();
  });

  test('appVersionAdoption counts active devices per version', async () => {
    const t = createTest();
    const now = Date.now();

    await t.run(async (ctx) => {
      const userId = await ctx.db.insert('users', {
        tokenIdentifier: 'clerk|adoption',
        authProvider: 'clerk',
        authSubject: 'adoption',
        createdAt: now,
      });
      const baseDevice = {
        userId,
        instanceUrl: 'https://example.test',
        provider: 'expo' as const,
        platform: 'ios' as const,
        createdAt: now,
        updatedAt: now,
        lastRegisteredAt: now,
      };

      await ctx.db.insert('notificationDevices', {
        ...baseDevice,
        deviceToken: 'a',
        appVersion: '1.0',
      });
      await ctx.db.insert('notificationDevices', {
        ...baseDevice,
        deviceToken: 'b',
        appVersion: '1.0',
      });
      await ctx.db.insert('notificationDevices', {
        ...baseDevice,
        deviceToken: 'c',
        appVersion: '1.1',
      });
      await ctx.db.insert('notificationDevices', {
        ...baseDevice,
        deviceToken: 'd',
      });
      await ctx.db.insert('notificationDevices', {
        ...baseDevice,
        deviceToken: 'e',
        appVersion: '0.9',
        disabledAt: now,
      });
    });

    expect(await t.query(internal.appConfig.appVersionAdoption, {})).toEqual({
      scanned: 5,
      truncated: false,
      versions: { '1.0': 2, '1.1': 1, unknown: 1 },
    });
  });
});
