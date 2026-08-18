# Contributing

Thanks for contributing to notionctl.

## Development

Requirements:

- Node.js 20.11+
- pnpm
- a Notion integration token for live API tests

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

## Pull requests

1. Keep changes focused.
2. Add or update tests for behavior changes.
3. Do not commit `.env`, tokens, or workspace identifiers that should remain private.
4. Update documentation when CLI behavior changes.
5. Make destructive behavior explicit and conservative.

## Design principle

Prefer deterministic, reviewable desired-state behavior over convenience that can silently mutate user data.
