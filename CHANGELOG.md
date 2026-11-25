# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the major version
tracks the Directus major this server supports.

## [Unreleased]

## [12.7.0] - 2026-11-25

### Added

- Structured tool output: all 34 tools declare an `outputSchema` and return
  `structuredContent` shaped `{ status, summary, data }`. `status` says what
  happened (`ok`, `confirmation_required`, `noop`, `rejected`) so an agent no
  longer has to read prose to learn whether a destructive call ran or only
  asked for `confirm`; `data` carries the tool's payload. The server checks
  each payload against its own schema before sending it.

### Fixed

- Tool results are no longer double-wrapped. The text block used to be a
  JSON-encoded `{ "content": [...] }` envelope rather than the tool's own
  text, and a failure reported by a tool class was buried inside it without
  `isError`. Clients now receive the readable text directly, and `isError` is
  set for every failed call, not only for exceptions. A client that parsed the
  old envelope out of the text block should read the text as it is, or use
  `structuredContent`.

### Changed

- `dotenv` 16 → 18. With a `.env` loaded the server still writes nothing but
  JSON-RPC to stdout.
- Development tooling: `vitest` and `@vitest/coverage-v8` 5, `msw` 3,
  `actions/setup-node` 7.

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

[Unreleased]: https://github.com/staminna/mcp-server-claude/compare/v12.7.0...HEAD
[12.7.0]: https://github.com/staminna/mcp-server-claude/compare/v12.6.1...v12.7.0
[12.6.1]: https://github.com/staminna/mcp-server-claude/compare/v12.6.0...v12.6.1
[12.6.0]: https://github.com/staminna/mcp-server-claude/compare/v12.4.1...v12.6.0
[12.4.1]: https://github.com/staminna/mcp-server-claude/compare/v12.4.0...v12.4.1
[12.4.0]: https://github.com/staminna/mcp-server-claude/compare/v12.3.0...v12.4.0
[12.3.3]: https://github.com/staminna/mcp-server-claude/compare/v12.3.0...v12.3.3
[12.3.2]: https://github.com/staminna/mcp-server-claude/compare/v12.3.0...v12.3.2
[12.3.0]: https://github.com/staminna/mcp-server-claude/compare/v12.0.1...v12.3.0
[12.0.1]: https://github.com/staminna/mcp-server-claude/releases/tag/v12.0.1
