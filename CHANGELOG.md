# Changelog

All notable changes to notionctl are documented here.

## [0.2.0] - 2026-08-18

### Added

- `plan` command with `diff` compatibility alias
- deterministic plan IDs for safer applies
- `drift`, `status`, and `doctor` commands
- migration file creation and status commands
- environment-specific Notion token selection via `NOTIONCTL_ENV`
- retry/backoff handling for transient Notion API failures
- npm package metadata and release checks
- CI workflow and open-source documentation
- MIT license and security/contribution policies

### Improved

- production-oriented CLI messaging
- README and command documentation
- explicit plan verification before apply
