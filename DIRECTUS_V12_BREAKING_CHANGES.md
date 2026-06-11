# Directus 12 Breaking Changes — Impact on this MCP Server

Source: https://directus.com/docs/releases/breaking-changes/version-12

This branch (`v12.0.0`) targets Directus 12. Summary of the upstream breaking
changes and how each one affects `@staminna/directus-mcp-server`.

## 1. License enforcement (affects this server at runtime)

Directus 12 actively enforces license tiers. Self-hosted instances default to
the **core tier** with limited functionality. Existing instances above core
limits get a **30-day grace period**; after that, the following APIs are
blocked:

- `/items` endpoints
- GraphQL
- WebSockets
- MCP APIs

**Impact:** every item tool in this server (`get_collection_items`,
`create_item`, `update_item`, `delete_items`, `bulk_operations`) and the
WebSocket subscription layer can start returning license-restriction errors on
an over-entitlement instance. Verify the target instance's tier before
upgrading it to v12.

## 2. `IP_TRUST_PROXY` default changed `true` → `false` (deployment note)

Directus behind a reverse proxy no longer trusts `X-Forwarded-For` by default.
Not a client-side concern for this server, but if the Directus instance this
server talks to sits behind nginx/Traefik, set `IP_TRUST_PROXY=true` on the
Directus side or rate limiting / access policies keyed on client IP will see
the proxy's IP instead.

## 3. Draft publishing workflow (affects item updates)

- Published items in **versioned collections are now read-only** — edits must
  go through a draft version. `update_item` against a published item in a
  versioned collection will be rejected; the update has to target a draft.
- `?version=main` is superseded by `?version=published` (the legacy parameter
  still works for now). This codebase does not currently send a `version`
  query parameter, so no code change was required.
- Collection-level `status` string is replaced with an `archived` boolean for
  new collections.

## 4. Extension/theme changes (no impact)

Removed theme tokens and deprecated app components (`<v-resizeable>`,
`<v-breadcrumb>`, `<v-drawer>` props, `#headline` slot). This server has no
app extension code — no impact.

## Changes made on this branch

- `@directus/sdk` bumped `^20.0.3` → `^22.0.0` (the Directus 12-aligned SDK,
  released 2026-06-10). Note the SDK is currently a dependency only; the HTTP
  client in `src/client/directus-client.ts` is axios-based and unaffected by
  SDK API changes.
- Package version set to `12.0.0` to track the supported Directus major.
- Build and typecheck verified green (`tsc`, Node >= 22 already required).
