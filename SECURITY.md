# Security Policy

## Supported versions

Security fixes target the latest release and the default branch.

## Reporting a vulnerability

Please do not disclose exploitable vulnerabilities in a public issue. Use GitHub's private vulnerability reporting for this repository when available.

Include:

- affected version or commit
- reproduction steps
- impact
- suggested mitigation, if known

Never include Notion API tokens or other secrets in reports.

## Security principles

`notionctl` is designed to be conservative:

- secrets are read from environment variables or local `.env`
- `.env` is ignored by Git
- destructive schema operations require explicit flags
- `apply` requires explicit confirmation
- remote changes are planned before mutation
