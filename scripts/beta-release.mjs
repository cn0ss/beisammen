#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

import {
  buildReleaseCommands,
  parseReleaseArgs,
} from './beta-release-lib.mjs';

function usage() {
  return [
    'Usage: pnpm release:beta -- --cloud-url=<url> --self-hosted-url=<url> --app-version=<version>',
    '',
    'Runs typecheck, tests, and deployment smoke checks for the provided beta targets.',
  ].join('\n');
}

function runCommand(command, args) {
  console.log(`$ ${[command, ...args].join(' ')}`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    throw new Error(`${command} ${args.join(' ')} failed.`);
  }
}

try {
  const args = parseReleaseArgs(process.argv.slice(2));

  for (const [command, commandArgs] of buildReleaseCommands(args)) {
    runCommand(command, commandArgs);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error('');
  console.error(usage());

  if (!process.exitCode) {
    process.exitCode = 1;
  }
}
