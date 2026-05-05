#!/usr/bin/env node

import {
  normalizeBaseUrl,
  parseArgs,
  runSmokeCheck,
  usage,
} from './smoke-beta-lib.mjs';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = normalizeBaseUrl(args.instanceUrl, 'instance URL');

  console.log(`Smoke checking ${baseUrl}`);

  const result = await runSmokeCheck(args);

  console.log('OK /healthz');
  console.log(`OK ${result.discoveryPath}`);
  if (args.appVersion) {
    console.log(
      `App version: ${args.appVersion}, minimum required: ${result.summary.minimumAppVersion}`,
    );
  }
  console.log(
    `Instance: ${result.summary.instanceName} (${result.summary.deploymentKind}, ${result.summary.authMode})`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  console.error('');
  console.error(usage());
  process.exitCode = 1;
});
