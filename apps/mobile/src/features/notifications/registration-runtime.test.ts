import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  setPushDeviceUnregisterHandler,
  unregisterCurrentPushDevice,
} from './registration-runtime';

let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
});

describe('push registration runtime', () => {
  test('does nothing when no device is registered', async () => {
    await expect(unregisterCurrentPushDevice()).resolves.toBeUndefined();
  });

  test('delegates unregistering to the active notification hook', async () => {
    const unregister = vi.fn(async () => undefined);
    cleanup = setPushDeviceUnregisterHandler(unregister);

    await unregisterCurrentPushDevice();

    expect(unregister).toHaveBeenCalledOnce();
  });
});
