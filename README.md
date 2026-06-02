# notionctl

`notionctl` is a conservative GitOps CLI for Notion databases and data sources.

It stores Notion database/data-source definitions as stable YAML manifests so teams can review schema changes in git before applying them back to Notion.

## Quick Start

```sh
pnpm install
pnpm build
export NOTION_TOKEN=secret_...

node dist/cli.js init --database <database-id> --name tasks
node dist/cli.js pull
node dist/cli.js diff
node dist/cli.js apply --yes
```

`apply` always computes a plan first, requires `--yes`, and blocks property deletes or property type changes unless you explicitly opt into those risks.
