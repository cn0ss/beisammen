#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

import {
  buildReleaseSteps,
  createReleaseSummary,
  parseReleaseArgs,
} from './beta-release-lib.mjs';

function usage() {
  return [
    'Usage: pnpm release:beta -- --cloud-url=<url> --self-hosted-url=<url> --app-version=<version>',
    '',
    'Runs typecheck, tests, and deployment smoke checks for the provided beta targets.',
  ].join('\n');
}

function runStep(step) {
  const startedAt = Date.now();
  const commandText = [step.command, ...step.args].join(' ');

  console.log(`$ ${commandText}`);
  const result = spawnSync(step.command, step.args, {
    stdio: 'inherit',
  });
  const durationMs = Date.now() - startedAt;

  if (result.error) {
    return {
      name: step.name,
      command: commandText,
      status: 'failed',
      durationMs,
      error: result.error.message,
    };
  }

  return {
    name: step.name,
    command: commandText,
    status: result.status === 0 ? 'passed' : 'failed',
    durationMs,
    exitCode: result.status ?? 1,
  };
}

function printSummary(args, checks) {
  console.log('');
  console.log('Beta release summary:');
  console.log(JSON.stringify(createReleaseSummary(args, checks), null, 2));
}

try {
  const args = parseReleaseArgs(process.argv.slice(2));
  const checks = [];
  let failedCheck = null;

  for (const step of buildReleaseSteps(args)) {
    const check = runStep(step);
    checks.push(check);

    if (check.status === 'failed') {
      failedCheck = check;
      if (typeof check.exitCode === 'number') {
        process.exitCode = check.exitCode;
      }
      break;
    }
  }

  printSummary(args, checks);

  if (failedCheck) {
    throw new Error(`${failedCheck.command} failed.`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error('');
  console.error(usage());

  if (!process.exitCode) {
    process.exitCode = 1;
  }
}
