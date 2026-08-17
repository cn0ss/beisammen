#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const result = spawnSync(
  'npx',
  [
    '-y',
    '--package=node@22',
    '--package=eas-cli@22.0.0',
    'eas',
    ...process.argv.slice(2),
  ],
  {
    env: process.env,
    stdio: 'inherit',
  },
);

if (result.error) {
  console.error(result.error.message);
}

process.exit(result.status ?? 1);
