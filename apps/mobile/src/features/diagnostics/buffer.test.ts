import { beforeEach, describe, expect, test } from 'vitest';

import {
  clearClientDiagnostics,
  formatClientDiagnostics,
  getClientDiagnostics,
  recordClientDiagnostic,
} from './buffer';

describe('client diagnostics buffer', () => {
  beforeEach(() => {
    clearClientDiagnostics();
  });

  test('stores recent diagnostics newest first', () => {
    recordClientDiagnostic('upload', 'Upload failed', { queueId: 'q1' });
    recordClientDiagnostic('auth_refresh', 'Refresh failed', { error: new Error('expired') });

    expect(getClientDiagnostics()).toEqual([
      expect.objectContaining({
        category: 'auth_refresh',
        message: 'Refresh failed',
        context: {
          error: {
            name: 'Error',
            message: 'expired',
          },
        },
      }),
      expect.objectContaining({
        category: 'upload',
        message: 'Upload failed',
        context: {
          queueId: 'q1',
        },
      }),
    ]);
    expect(formatClientDiagnostics()).toContain('[auth_refresh] Refresh failed');
  });
});
