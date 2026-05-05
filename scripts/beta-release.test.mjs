import { describe, expect, test } from 'vitest';

import {
  buildReleaseCommands,
  parseReleaseArgs,
} from './beta-release-lib.mjs';

describe('beta release verification', () => {
  test('parses cloud and self-hosted release check targets', () => {
    expect(
      parseReleaseArgs([
        '--cloud-url=https://cloud.example.com',
        '--self-hosted-url=https://home.example.com',
        '--app-version=0.1.0',
      ]),
    ).toEqual({
      cloudUrl: 'https://cloud.example.com',
      selfHostedUrl: 'https://home.example.com',
      appVersion: '0.1.0',
    });
  });

  test('requires at least one live deployment target', () => {
    expect(() => parseReleaseArgs(['--app-version=0.1.0'])).toThrow(/cloud-url.*self-hosted-url/i);
  });

  test('builds typecheck, test, and deployment smoke commands', () => {
    expect(
      buildReleaseCommands({
        cloudUrl: 'https://cloud.example.com',
        selfHostedUrl: 'https://home.example.com',
        appVersion: '0.1.0',
      }),
    ).toEqual([
      ['pnpm', ['typecheck']],
      ['pnpm', ['test']],
      [
        'pnpm',
        [
          'smoke:beta',
          '--',
          'https://cloud.example.com',
          '--expect-kind=cloud',
          '--app-version=0.1.0',
        ],
      ],
      [
        'pnpm',
        [
          'smoke:beta',
          '--',
          'https://home.example.com',
          '--expect-kind=self-hosted',
          '--app-version=0.1.0',
        ],
      ],
    ]);
  });
});
