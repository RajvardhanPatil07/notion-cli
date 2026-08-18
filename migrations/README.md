# Migrations

Migration files are ordered YAML records describing intentional schema changes.

Create one with:

```bash
notionctl migrate create add-priority
```

Review and commit the generated file. `migrate status` lists the local migration history.

The current release uses migrations as an auditable planning layer; remote reconciliation remains handled by `plan` and `apply`. Future releases can attach transactional apply/rollback semantics where the Notion API supports them.
