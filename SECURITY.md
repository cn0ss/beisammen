# Security Policy

Please do not file public issues for security vulnerabilities.

## Reporting

- Use GitHub Security Advisories once the repository is published on GitHub.
- If that is not yet available, contact the maintainer through a private
  channel before disclosing details publicly.

## Scope

Security-sensitive areas for this project include:

- WorkOS authentication and token handling
- Convex auth configuration
- provider credential storage
- signed upload and read URL generation
- mobile deep link handling
- Expo and EAS environment separation

## Hard rules

- Never commit secrets to git, including revoked ones
- Never put secrets in `EXPO_PUBLIC_*` variables
- Never place secrets in `app.config.ts`, `app.json`, or `eas.json`

