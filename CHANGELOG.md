# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the major version
tracks the Directus major this server supports.

## [Unreleased]

## [12.6.1] - 2026-11-09

### Changed

- Every one of the 34 tool definitions now states what the tool does, when to
  use it instead of its siblings, the side effects and failure modes an agent
  cannot infer from the schema, and what it returns — scored against
  [TDQS](https://tdqs.dev).
- `bulk_operations` documents its `operations` parameter, bringing parameter
  description coverage to 100% across every tool.

### Added

- `npm run tdqs` — a deterministic tool-definition quality gate (no API key, no
  model), run in CI after the end-to-end tests.
- `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, issue and pull-request
  templates, and a Dependabot policy for npm and GitHub Actions.

## [12.6.0] - 2026-11-08

### Added

- Directus 12.6 support: SDK 27, Node 26, and `get_collection_items` documents
  that `search` now matches related fields through a many-to-many junction.

## [12.4.1] - 2026-10-13

### Fixed

- Tool failures are returned with `isError` set, so clients stop reading an
  error payload as a successful result.

## [12.4.0] - 2026-09-30

### Added

- Directus 12.4 support: SDK 26, inactive collections flagged in
  `list_collections`, and flow folders in `get_flows` and `create_flow`.

## [12.3.3] - 2026-08-21

### Fixed

- `SERVER_VERSION` is kept in step with the package version.

## [12.3.2] - 2026-08-21

### Added

- A `Dockerfile`, and the server now starts without credentials so a client can
  list tools before one is configured.

### Removed

- WebSocket support claims the server never wired up.

## [12.3.0] - 2026-08-20

### Added

- Schema snapshot, diff and apply (`get_schema_snapshot`, `diff_schema`,
  `apply_schema`), multi-collection `import_data`, and `search_tools`.

## [12.0.1] - 2026-07-23

### Added

- First published release: 34 tools over Directus 12 collections, fields,
  relations, items, flows, users, files and access diagnostics.

[Unreleased]: https://github.com/staminna/mcp-server-claude/compare/v12.6.1...HEAD
[12.6.1]: https://github.com/staminna/mcp-server-claude/compare/v12.6.0...v12.6.1
[12.6.0]: https://github.com/staminna/mcp-server-claude/compare/v12.4.1...v12.6.0
[12.4.1]: https://github.com/staminna/mcp-server-claude/compare/v12.4.0...v12.4.1
[12.4.0]: https://github.com/staminna/mcp-server-claude/compare/v12.3.0...v12.4.0
[12.3.3]: https://github.com/staminna/mcp-server-claude/compare/v12.3.0...v12.3.3
[12.3.2]: https://github.com/staminna/mcp-server-claude/compare/v12.3.0...v12.3.2
[12.3.0]: https://github.com/staminna/mcp-server-claude/compare/v12.0.1...v12.3.0
[12.0.1]: https://github.com/staminna/mcp-server-claude/releases/tag/v12.0.1
