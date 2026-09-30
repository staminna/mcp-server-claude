# Directus 12.0 → 12.4 — Impact on this MCP Server

Sources:
- https://directus.com/docs/releases/breaking-changes/version-12
- https://github.com/directus/directus/releases

This package tracks the Directus major/minor it supports, so `12.3.0` here means
"targets Directus 12.3.0". Below is each upstream change that could affect this
server, and what was done about it.

---

## 12.0 — the major

### 1. License enforcement (runtime risk, not a code change)

Directus 12 actively enforces license tiers. Self-hosted instances default to the
**core tier**; instances above core limits get a **30-day grace period**, after
which these are blocked:

- `/items` endpoints
- GraphQL
- WebSockets
- MCP APIs

**Impact:** every item tool here (`get_collection_items`, `create_item`,
`update_item`, `delete_items`, `bulk_operations`) and the WebSocket layer can
start returning license-restriction errors on an over-entitlement instance.
Check the target instance's tier before treating a failure as a bug in this
server.

### 2. `IP_TRUST_PROXY` default `true` → `false` (deployment note)

Not a client concern, but if the Directus instance sits behind nginx/Traefik,
set `IP_TRUST_PROXY=true` on the Directus side or rate limiting and IP-keyed
access policies will see the proxy's address.

### 3. Draft publishing workflow — **now handled**

- Published items in versioned collections are read-only; edits must go through
  a draft version.
- `?version=main` is superseded by `?version=published`.
- Collection-level `status` string replaced by an `archived` boolean on new
  collections.

**Handled as of 12.3.0:** `QueryOptions` carries `version` / `versionRaw`,
`get_collection_items` accepts `version` and `version_raw`, and `update_item`
accepts a draft `version` and refuses `version: 'published'` locally with an
explanation rather than letting Directus reject it opaquely.

Still out of scope: promoting a draft goes through `/versions/:id/save`, not a
PATCH, so full content-version tools (`saveToContentVersion`,
`promoteContentVersion`) remain a follow-up.

### 4. Extension/theme changes — no impact

Removed theme tokens and deprecated app components. This server has no app
extension code.

---

## 12.1.0

### `/utils/hash/generate` and `/utils/hash/verify` removed — no impact

Confirmed by inspection: this server never called either endpoint. Corroborated
by the SDK, where `generateHash` / `verifyHash` exist in v22 and are gone in v25.

### `GRAPHQL_SINGLE_USE_MUTATIONS`, WebSocket `CORS_ORIGIN` checks — no impact today

This server uses REST only. The bundled `DirectusWebSocketClient` is not wired
into the running server (`websocket: false` is hardcoded), but if it is enabled
later, the Directus instance's `CORS_ORIGIN` will apply to the socket handshake.

---

## 12.2.0

### `schemaDiff` takes object options — **absorbed**

`schemaDiff(snapshot, { force, mode })`. The new `diff_schema` tool is built on
this signature from the start.

### Partial schema snapshots and diff modes — **adopted as new tools**

`includeCollections` / `excludeCollections` on snapshot, `mode: 'merge' |
'mirror'` on diff. Exposed as `get_schema_snapshot` and `diff_schema`.

### Multi-collection flat imports and `IMPORT_MAX_FILE_SIZE` — **adopted**

Imports are now capped (default `50mb`), and a valueless `?background` counts as
true. Exposed as `import_data`, which refuses oversized files before uploading
and names `IMPORT_MAX_FILE_SIZE` when Directus answers 413.

### Restricted `directus_settings` reads for minimal app access — deployment note

New policies grant read access to fewer `directus_settings` fields. Existing
policies are untouched. This server does not read `directus_settings`, but a
least-privilege token created after upgrading will see less than one created
before.

### Manual flows no longer triggerable unauthenticated — no impact

`trigger_flow` always authenticates with the configured static token.

---

## 12.3.0

### "Nothing to target is a no-op" for Update/Delete Items (#27759) — **adopted**

Upstream made its Update/Delete Items operations return `null` instead of
falling back to every item when key and query are both empty, and throw when
given contradictory options.

The same hazard existed here, concretely: `DirectusClient.deleteItems` built
`DELETE /items/{collection}/{ids.join(',')}`, so an empty id list produced
`DELETE /items/articles/`. It now takes keys *or* a query, sends them in the
request body, and returns without issuing a request when nothing is targeted.
`delete_items` rejects `ids` and `query` together, `update_item` no-ops on an
empty payload, and `bulk_operations` no-ops when given no operations. Deleting
everything requires asking: `query: { limit: -1 }`.

### MCP tool annotations (#28090) — **adopted, finer-grained**

Upstream added `readOnlyHint` / `destructiveHint` to its own MCP tools for
connector-marketplace review. All 34 tools here carry annotations. Because these
tools are per-operation rather than coarse, they distinguish additive from
destructive writes instead of marking everything destructive.

Note `destructiveHint` defaults to **true** in the MCP spec, so additive tools
set it to `false` explicitly.

### Search-first tool discovery (#27797) — **adopted additively**

Upstream pins schema as a root tool and makes discovery search-first. Here,
`search_tools` returns matching tool definitions by keyword and always pins
`get_collection_schema`; `tools/list` still returns all 34.

### `ASSETS_TRANSFORM_IMAGE_MAX_OUTPUT_DIMENSION` now 6000px — no impact

This server builds asset URLs but does not request transformations.

### `exists()` throws on lookup failure — no impact

Internal to the storage drivers.

---

## 12.3.1

### SDK realtime fixes (`unsubscribe()` accumulation, heartbeat listener leak) — no impact

Both live in the SDK's realtime client and the server-side WebSocket layer,
neither of which this server wires up (`websocket: false`). Ships as
`@directus/sdk@25.0.1`.

### Public registration verifies the submitted email, not the stored one — no impact

This server never registers users.

---

## 12.4.0

### Item CRUD on inactive collections is blocked (#27792) — **surfaced**

A collection whose `meta.status` is `inactive` now refuses every item read and
write with `403 COLLECTION_INACTIVE` — or a plain `FORBIDDEN` for a token with
no permission on it, so it cannot probe for existence. Schema endpoints keep
working, and reading, filtering or sorting *through* an inactive relation is
rejected too. Before 12.4 the same collection simply answered its items.

The failure reads as a permissions bug, so:

- `list_collections` marks such collections `_(inactive — item access blocked)_`,
  the way it already marks folders.
- `diagnose_collection_access` records the error code of its items probe and,
  when the collection is listed as inactive or the probe answers
  `COLLECTION_INACTIVE`, says so instead of pointing at read permissions.

### Update/delete by query resolve their targets under read permissions (#28143) — documented

`delete_items` with `query` — and any Directus-side update-by-query — now:

- needs read access to the collection's primary key field,
- only reaches the items the token can *read*, regardless of its delete or
  update rights,
- needs read access on the child collection for nested o2m saves.

A least-privilege token with delete-but-not-read on a collection could
`delete_items` by query before; the query now resolves to no readable keys and
deletes nothing. The tool description says so. No code change: this is the
correct behaviour, and a token allowed to delete what it cannot read was always
a configuration smell.

### Flows moved into their own module, with folders (#28206) — **adopted**

`directus_flows` gained a `folder` column and `directus_folders` gained a
`type` (`files` | `flows`), so one folder tree serves the file library and a
separate one serves Flows. The Studio also gained flow import/export and
duplication, a hidden location for manual-trigger buttons, and a From Name on
the email operation. None of those have an API of their own — duplication is a
create — so the API-visible change is the `folder` field.

- `get_flows` accepts `folder` (a folder ID, or `""` for root-level flows only)
  and prints the folder of every flow it is told about.
- `create_flow` accepts `folder`.

Both are opt-in and send nothing extra when omitted, so a pre-12.4 instance —
where the column does not exist and an unknown field fails the request — is
unaffected. For the same reason `folder` is not in `get_flows`'s default field
list.

The folder helpers in `FileTools` (`getFolders`, `createFolder`) are not
registered as MCP tools. If they are ever exposed, filter on `type = files`, or
Flow folders will appear in the file library listing.

### `@directus/sdk` 25 → 26 (#27956, #27970) — **absorbed**

A type-only major: `DirectusRelation.meta` and `.schema`, `DirectusRole.parent`,
`DirectusVersion.hash` and several `directus_access` fields are now nullable;
`DirectusPolicy.ip_access` and `one_allowed_collections` are `string[]`. This
server imports SDK *commands* plus the schema output types and keeps its own
`DirectusRelation`, so nothing needed changing — `tsc` is clean on 26.0.0. The
new nullability matches what the API actually returns.

### MapLibre 6, Unhead 3, Mailtrap transport — no impact

Studio and email-side only.

---

## 12.4.1

### Non-admin reads of `/folders` fixed (#28286) — note

Only relevant if the `FileTools` folder helpers are ever exposed: a non-admin
token could not list folders on 12.4.0.

---

## What changed in this package for 12.4.0

- **`@directus/sdk` `^25.0.0` → `^26.0.0`.** Type-only upgrade, no code change.
- **`list_collections`** marks inactive collections.
- **`diagnose_collection_access`** recognises `COLLECTION_INACTIVE`, from the
  error code or from the collection's `meta.status`.
- **`get_flows` / `create_flow`** understand flow folders, opt-in.
- **`delete_items`** documents the read-permission requirement for deleting by
  query.
- **vitest and @vitest/coverage-v8 `4.1.8` → `4.1.11`** — GHSA-82fw-gwwq-j7x9,
  a path traversal in `@vitest/mocker`. Dev-only, never shipped.

---

## What changed in this package for 12.3.0

- **`@directus/sdk` is actually used.** It had been a declared dependency since
  v12.0.0 with no imports; the client was 100% axios. `DirectusClient` now builds
  requests with SDK commands. Its public surface is unchanged — it is exported
  from `src/lib.ts` as package API.
- **The transport is still axios**, injected as the SDK's `globals.fetch`. Two
  reasons: Node's global fetch takes no `httpsAgent` (so the seven
  `DIRECTUS_HTTPS_*` variables would have stopped working, and undici's `Agent`
  is not importable without a new dependency), and the SDK's `extractData()`
  discards the response envelope's `meta` before any SDK hook can see it — which
  several tools need for pagination counts.
- **Retry moved into the transport** with a per-call attempt counter. The
  previous counter lived on the client instance and was never reset on success,
  so one retry permanently reduced the retry budget of every later request.
- **`@directus/sdk` bumped `^22.0.0` → `^25.0.0`**;
  `@modelcontextprotocol/sdk` `^1.17.4` → `^1.30.0`. `form-data`,
  `@types/form-data` and `csv-parse` dropped — the first is replaced by Node's
  global `FormData`, the last was never imported.

---

## Observed limitation: request bodies over ~96 KB are dropped

Verified against a live Directus **12.0.2** and again after upgrading the same
instance to **12.3.0** — the behaviour is identical on both.

`POST /schema/diff` with a JSON body larger than roughly 96 KB is answered with:

```
400  Invalid payload. No data was included in the body.
```

Not a `413`. The body is silently discarded and Directus reports it as absent.
Bodies up to 96 KB arrive intact — provable because Directus then validates their
*content* (an unknown key is rejected by name) rather than claiming the body is
missing. The cutoff sits between 96 KB and 100 KB.

This is **not** caused by this MCP server, and **not** by the reverse proxy:
`curl` sent directly to the Directus container, bypassing nginx entirely,
reproduces it exactly.

### Why it matters

A full schema snapshot is easily larger than this. On a 19-collection instance
the snapshot was ~214 KB, so `diff_schema` could never run against it.

### Workaround

Use the Directus 12.2 partial-snapshot feature to keep the payload under the
limit, and diff one slice of the data model at a time:

```jsonc
// instead of a full snapshot, take only what you intend to compare
{ "tool": "get_schema_snapshot", "include_collections": ["articles", "authors"] }
```

A partial snapshot reports `version: 2` (a full one is `version: 1`), and
`diff_schema` accepts it unchanged. This is the practical reason to prefer
`include_collections` on any instance with a non-trivial data model.
