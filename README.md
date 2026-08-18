# notionctl

**Safe GitOps and infrastructure-as-code for Notion databases and data sources.**

`notionctl` lets teams define Notion schemas as version-controlled YAML, preview changes, detect drift, and safely reconcile Notion from Git. It is designed around the same desired-state workflow used by infrastructure tools: **pull → plan → review → apply**.

## Why notionctl?

Notion is excellent for collaborative workspaces, but database schemas are often changed manually and are hard to review, reproduce, or audit. `notionctl` makes the schema declarative:

```text
Git/YAML → validate → plan → review → apply → Notion
                         ↑
                      drift
```

Destructive property deletes and type changes are blocked by default.

## Features

- Declarative YAML manifests for databases and data sources
- Deterministic diffs and machine-readable JSON plans
- Safe `apply` with explicit confirmation
- Drift detection between Git and live Notion
- Resource status and connectivity diagnostics
- Migration scaffolding for schema evolution
- Lock/state tracking for stable Notion IDs
- Notion API version pinning
- Node.js 20+ and TypeScript
- Unit-tested diff/config/manifest layers
- GitHub Actions CI and npm-ready packaging

## Install

```bash
npm install -g notionctl
# or
pnpm add -g notionctl
```

For development:

```bash
pnpm install
pnpm check
```

## Authentication

Create a Notion integration and share the target database with it, then export the token:

```bash
export NOTION_TOKEN=secret_...
```

`.env` is supported for local development and is ignored by Git. Never commit tokens.

## Quick start

```bash
notionctl init --database <database-id> --name tasks
notionctl pull
notionctl validate
notionctl plan
notionctl apply --yes
```

To inspect machine-readable output:

```bash
notionctl plan --json
```

## Detect drift

If someone edits a managed database directly in Notion:

```bash
notionctl drift
```

A drifted resource exits non-zero and reports the same reconciliation plan that `apply` would use.

## Commands

| Command | Purpose |
| --- | --- |
| `init` | Register a Notion database as a managed resource |
| `pull` | Export live Notion schema to YAML |
| `validate` | Validate configuration and manifests |
| `plan` | Preview changes without mutating Notion |
| `diff` | Backward-compatible alias for `plan` |
| `apply` | Safely reconcile Notion from manifests |
| `drift` | Detect divergence between Git and Notion |
| `status` | Summarize managed resources and drift |
| `doctor` | Diagnose configuration, token, and API access |
| `migrate` | Create and inspect ordered schema migration files |

## Safety model

`apply` always computes a fresh plan. It requires `--yes` when changes exist. Property deletion and property type changes are blocked unless explicitly enabled:

```bash
notionctl apply --yes --allow-delete-properties
notionctl apply --yes --allow-type-change
```

Do not enable destructive flags casually. Review the plan first.

## GitHub Actions

A minimal CI workflow is included under `.github/workflows/ci.yml`. For deployment, provide `NOTION_TOKEN` as a GitHub Actions secret and run `notionctl validate`/`notionctl plan` in pull requests. Keep `apply` in a protected deployment workflow with an explicit environment approval.

## Repository layout

```text
src/
  commands.ts     CLI and command orchestration
  diff.ts         desired-vs-live reconciliation planner
  apply.ts        safe mutation executor
  notion.ts       Notion API adapter
  remote.ts       live-state retrieval
  manifest.ts     YAML manifest IO
  schemas.ts      Zod schemas and domain types
  config.ts       config/state/secrets handling

test/             unit tests
migrations/       ordered schema migration notes
.github/workflows/ci.yml
```

## Development

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

## Roadmap

- Environment-specific workspaces and deployment approvals
- First-class migration apply/rollback semantics
- GitHub PR plan comments
- More Notion resource types
- Published documentation site

## Security

Please report security issues privately using the repository's security policy rather than opening a public issue. See `SECURITY.md`.

## License

MIT. See `LICENSE`.
