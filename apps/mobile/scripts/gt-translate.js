#!/usr/bin/env node
// Runs `gt translate` when General Translation credentials are configured.
// Used as the EAS `eas-build-post-install` hook so store builds ship fresh
// translations, and skips gracefully (committed src/_gt/*.json are used as-is)
// when no credentials are present.
const { spawnSync } = require('node:child_process');

if (!process.env.GT_API_KEY || !process.env.GT_PROJECT_ID) {
  console.log('[gt] GT_API_KEY / GT_PROJECT_ID not set — using committed translations.');
  process.exit(0);
}

const result = spawnSync('npx', ['gt', 'translate'], {
  cwd: __dirname + '/..',
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
