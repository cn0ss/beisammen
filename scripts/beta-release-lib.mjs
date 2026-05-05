export function parseReleaseArgs(argv) {
  const args = {
    cloudUrl: null,
    selfHostedUrl: null,
    appVersion: null,
  };

  for (const arg of argv) {
    if (arg.startsWith('--cloud-url=')) {
      args.cloudUrl = arg.slice('--cloud-url='.length).trim() || null;
      continue;
    }

    if (arg.startsWith('--self-hosted-url=')) {
      args.selfHostedUrl = arg.slice('--self-hosted-url='.length).trim() || null;
      continue;
    }

    if (arg.startsWith('--app-version=')) {
      args.appVersion = arg.slice('--app-version='.length).trim() || null;
      continue;
    }

    throw new Error(`Unexpected argument: ${arg}`);
  }

  if (!args.cloudUrl && !args.selfHostedUrl) {
    throw new Error('Provide --cloud-url, --self-hosted-url, or both.');
  }

  if (!args.appVersion) {
    throw new Error('Provide --app-version.');
  }

  return args;
}

export function buildReleaseCommands(args) {
  const commands = [
    ['pnpm', ['typecheck']],
    ['pnpm', ['test']],
  ];

  if (args.cloudUrl) {
    commands.push([
      'pnpm',
      [
        'smoke:beta',
        '--',
        args.cloudUrl,
        '--expect-kind=cloud',
        `--app-version=${args.appVersion}`,
      ],
    ]);
  }

  if (args.selfHostedUrl) {
    commands.push([
      'pnpm',
      [
        'smoke:beta',
        '--',
        args.selfHostedUrl,
        '--expect-kind=self-hosted',
        `--app-version=${args.appVersion}`,
      ],
    ]);
  }

  return commands;
}
