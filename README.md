# @staminna/directus-mcp-server

**Turn Directus 12 into an AI-operated backend.** Your agent models the data, ships the API, imports your records, wires the automations and debugs the permissions. You just describe the business. Reduce costs

[![npm version](https://badge.fury.io/js/%40staminna%2Fdirectus-mcp-server.svg)](https://www.npmjs.com/package/@staminna/directus-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/staminna/mcp-server-claude/actions/workflows/ci.yml/badge.svg)](https://github.com/staminna/mcp-server-claude/actions/workflows/ci.yml)
[![mcp-server-claude MCP server](https://glama.ai/mcp/servers/staminna/mcp-server-claude/badges/score.svg)](https://glama.ai/mcp/servers/staminna/mcp-server-claude)

[![mcp-server-claude MCP server](https://glama.ai/mcp/servers/staminna/mcp-server-claude/badges/card.svg)](https://glama.ai/mcp/servers/staminna/mcp-server-claude)

### Test Coverage

| Statements | Branches | Functions | Lines |
|------------|----------|-----------|-------|
| ![Statements](https://img.shields.io/badge/statements-98.66%25-brightgreen.svg?style=flat) | ![Branches](https://img.shields.io/badge/branches-98%25-brightgreen.svg?style=flat) | ![Functions](https://img.shields.io/badge/functions-97.31%25-brightgreen.svg?style=flat) | ![Lines](https://img.shields.io/badge/lines-98.65%25-brightgreen.svg?style=flat) |

Coverage badges are generated from `coverage/coverage-summary.json` by `npm run badges` (no external service required). Run `npm run test:coverage` first.

---

## Why this, why now

[Directus](https://directus.io) already gives you a production backend for free: a SQL database you own, instant **REST + GraphQL APIs**, auth, roles and permissions, file storage, Flows (automation) and a no-code admin app for your team. What it doesn't give you is speed of *setup*. Modelling collections, relations, permissions and flows still takes clicks and hours.

This MCP server lets Claude, Cursor or any MCP agent run Directus for you. **34 typed tools** cover collections, fields, relations, items, bulk ops, CSV/JSON import, schema snapshot/diff/apply, flows, users, files and access diagnostics. Each one carries read/write safety annotations, and deletes and schema applies require explicit confirmation.

**What you can stand up in an afternoon:**

- 🛒 **Shop / catalog:** products, categories, variants, stock, images; import the supplier CSV; the API is ready for your storefront.
- 🌐 **Website CMS:** pages, menus, blog, SEO fields, translations; your marketing team edits in the Directus app.
- 🤝 **Lightweight CRM:** leads, companies, deals, activity; a Flow notifies you on every new lead.
- 📅 **Bookings / services:** resources, slots, customers, reservations, with roles for staff and the public.
- 🧰 **Internal back-office:** replace the spreadsheet; keep the data in SQL with an audit trail and permissions.

Then move it between environments with `get_schema_snapshot` → `diff_schema` → `apply_schema`.

---

## Quick start (60 seconds)

1. In Directus, create a user for the agent and generate a **static token** (User → Token).
2. Paste the config below into your agent.
3. Ask: *"List my collections, then create a `products` collection with name, price, stock and a many-to-one `category`."*

Requires **Node.js ≥ 26** · works with **Directus 12.0 – 12.6** ([compatibility notes](DIRECTUS_V12_BREAKING_CHANGES.md)).

## Add it to your agent

One config works for every MCP client:

```json
{
  "mcpServers": {
    "directus": {
      "command": "npx",
      "args": ["-y", "@staminna/directus-mcp-server"],
      "env": {
        "DIRECTUS_URL": "https://your-directus.example.com",
        "DIRECTUS_TOKEN": "your-static-token"
      }
    }
  }
}
```

| Client | Where it goes |
|--------|---------------|
| Claude Code | `claude mcp add directus -e DIRECTUS_URL=https://… -e DIRECTUS_TOKEN=… -- npx -y @staminna/directus-mcp-server` |
| Claude Desktop | `claude_desktop_config.json` (Settings → Developer → Edit Config) |
| Cursor | `~/.cursor/mcp.json` or `.cursor/mcp.json` in the project |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| VS Code / Cline / others | the client's MCP config, using the same `mcpServers` block |

Restart the client after editing. Other ways to run it:
- **From source:** `"command": "node", "args": ["/path/to/mcp-server-claude/dist/index.js"]` (after `npm install && npm run build`)
- **Docker:** `"command": "docker", "args": ["run", "-i", "--rm", "-e", "DIRECTUS_URL", "-e", "DIRECTUS_TOKEN", "directus-mcp"]` (after `docker build -t directus-mcp .`)

---

## Ask for outcomes, not API calls

```
"Create a products catalog: products (name, slug, price, stock, images) with a M2O category and M2M tags."
"Import customers.csv into the customers collection — dry run first."
"Create a flow that runs when an order is created and posts it to my webhook."
"Why can't the Public role read articles? Diagnose it."
"Snapshot the schema of products and categories so I can apply it to production."
"Show me all orders from this week over 100 €, newest first."
```

---

## Tools

#### Collection Management
| Tool | Description |
|------|-------------|
| `list_collections` | List all collections; folders and inactive collections (Directus 12.4) are marked |
| `get_collection_schema` | Get schema for a specific collection |
| `get_collection_items` | Get items from a collection with filtering; `search` also matches related fields on m2m junctions (Directus 12.6.1) |
| `create_collection` | Create a new collection |
| `delete_collection` | Delete a collection (requires `confirm`) |
| `create_item` | Create a new item in a collection |
| `update_item` | Update an existing item, optionally into a draft `version` |
| `delete_items` | Delete items by `ids` or by `query` (see note below) |
| `bulk_operations` | Execute bulk create, update, delete |

#### Schema & Fields
| Tool | Description |
|------|-------------|
| `create_field` | Create a new field in a collection |
| `update_field` | Update an existing field |
| `delete_field` | Delete a field from a collection |
| `create_relationship` | Create relationships (O2O, O2M, M2O, M2M, M2A) |
| `analyze_collection_schema` | Analyze schema with relationship mapping |
| `validate_collection_schema` | Validate schema and relationships |
| `analyze_relationships` | Analyze relationships across collections |
| `get_schema_snapshot` | Read a full or partial snapshot of the data model |
| `diff_schema` | Compare a snapshot against the live schema (`merge` or `mirror`). Directus drops request bodies over ~96 KB, so pass a partial snapshot from `get_schema_snapshot` with `include_collections` on any sizeable data model — see `DIRECTUS_V12_BREAKING_CHANGES.md` |
| `apply_schema` | Apply a diff (requires `confirm`) |

#### Flow Management
| Tool | Description |
|------|-------------|
| `get_flows` | Get all flows, optionally by `folder` (Directus 12.4) |
| `get_flow` | Get a specific flow by ID |
| `create_flow` | Create a new automation flow, optionally inside a `folder` |
| `update_flow` | Update an existing flow |
| `delete_flow` | Delete a flow |
| `trigger_flow` | Manually trigger a flow |
| `get_operations` | Get flow operations |

#### User Management
| Tool | Description |
|------|-------------|
| `get_users` | Get all users with filtering |
| `get_user` | Get a specific user by ID |

#### File Management
| Tool | Description |
|------|-------------|
| `get_files` | Get files with filtering and pagination |
| `import_data` | Import CSV/JSON into one collection, or several at once |

#### Diagnostics
| Tool | Description |
|------|-------------|
| `diagnose_collection_access` | Diagnose collection access issues |
| `refresh_collection_cache` | Refresh collection cache |
| `validate_collection_creation` | Validate newly created collections |

#### Discovery
| Tool | Description |
|------|-------------|
| `search_tools` | Find the tools matching a task description |

#### Built-in safety

- Every tool carries MCP annotations: 17 are read-only, 6 are additive (`destructiveHint: false`), and 11 are destructive (deletes, overwriting updates, `apply_schema`, `import_data`, `trigger_flow`).
- Deletes and `apply_schema` require `confirm: true`. `delete_items` takes **either** `ids` or a `query`, never falls back to deleting everything, and (since Directus 12.4) only reaches items the token can read. To wipe a collection you must ask explicitly: `{ "query": { "limit": -1 }, "confirm": true }`.

---

## Configuration

<details>
<summary>Environment variables</summary>

| Variable | Required | Description |
|----------|----------|-------------|
| `DIRECTUS_URL` | Yes | Your Directus instance URL (e.g., `http://localhost:8065`) |
| `DIRECTUS_TOKEN` | Yes | Static API token with appropriate permissions |
| `DIRECTUS_PROMPTS_COLLECTION_ENABLED` | No | Enable AI prompts collection (`true`/`false`) |
| `DIRECTUS_PROMPTS_COLLECTION` | No | Collection name for AI prompts (default: `ai_prompts`) |
| `DIRECTUS_RESOURCES_ENABLED` | No | Enable resources feature (`true`/`false`) |
| `DIRECTUS_RESOURCES_EXCLUDE_SYSTEM` | No | Exclude system collections from resources (`true`/`false`) |
| `NODE_ENV` | No | Environment mode (`development`/`production`) |
| `DIRECTUS_TIMEOUT` | No | Request timeout in ms (default: `30000`) |
| `DIRECTUS_RETRIES` | No | Retry attempts for network errors, 5xx and 429 (default: `3`) |
| `DIRECTUS_RETRY_DELAY` | No | Base backoff delay in ms (default: `1000`) |
| `DIRECTUS_MAX_RETRY_DELAY` | No | Backoff ceiling in ms (default: `10000`) |
| `DIRECTUS_IMPORT_MAX_FILE_SIZE` | No | Client-side import size ceiling in bytes, mirroring the Directus `IMPORT_MAX_FILE_SIZE` (default: 50 MB) |
| `LOG_LEVEL` | No | `DEBUG`/`INFO`/`WARN`/`ERROR` (default: `INFO`). Logs go to stderr; stdout is reserved for MCP |

</details>

<details>
<summary>TLS / client certificates</summary>

For a private CA or a client certificate. `CA`/`CERT`/`KEY`/`PFX` accept a file path or the PEM/DER content itself.

| Variable | Description |
|

</details>

**Authentication:** a static Directus token over stdio. No OAuth is needed: the MCP spec reserves OAuth for HTTP transports and tells stdio servers to read credentials from the environment. Use a dedicated least-privilege user in production. With a Claude Pro/Max subscription in Claude Code or Desktop you don't need an Anthropic API key either.

---

## Troubleshooting

- **Not connecting:** check `DIRECTUS_URL` is reachable and the token is set, then fully restart the client. Logs go to stderr (`LOG_LEVEL=DEBUG` for more).
- **Permission errors:** run `diagnose_collection_access` on the collection. It tells permissions, inactive collections (12.4+) and folders apart.
- **Timeouts on a remote instance:** raise `DIRECTUS_TIMEOUT` and check firewall/proxy settings.

---

## Development

```bash
npm install && npm run build      # build to dist/
npm run typecheck && npm run lint
npm test                          # unit + integration (vitest)
npm run test:coverage             # enforces 95% thresholds
npm run test:e2e                  # spawns the real server over stdio against a mock Directus
npm run badges                    # refresh the coverage badges above
npm run tdqs                      # tool-definition quality gate (no API key needed)
```

**Live verification:** `tests/live/demo.mjs` drives every tool against a real instance. It reads `DIRECTUS_URL`/`DIRECTUS_TOKEN` from `ENV_FILE` (default `.env.mdbaudio`):

```bash
ENV_FILE=.env npm run test:live                               # read-only + guards
ENV_FILE=.env npm run test:live -- --write                    # + scratch mcp_demo_<stamp> collection, always cleaned up
ENV_FILE=.env npm run test:live -- --write --apply-schema     # + apply_schema, merge mode, scratch only
```

**Tool-definition quality:** the 34 definitions are held to
[TDQS](https://tdqs.dev), the open rubric Glama scores MCP servers with. A
description has to state what the tool does, when to use it instead of its
siblings, the side effects and failure modes an agent cannot infer from the
schema, and what it returns; every parameter carries a `description`.
`npm run tdqs` runs the deterministic stages of that check — no model, no API
key — and fails on errors; `npm run tdqs:report` prints the full findings,
notes and warnings included. CI runs the gate on every push and pull request.

Contributions welcome: fork, branch, open a PR. Start with
[CONTRIBUTING.md](CONTRIBUTING.md); vulnerabilities go through
[SECURITY.md](SECURITY.md), not a public issue.

## License

MIT © [Jorge Domingues Nunes](https://github.com/staminna)

[npm](https://www.npmjs.com/package/@staminna/directus-mcp-server) · [GitHub](https://github.com/staminna/mcp-server-claude) · [Directus docs](https://directus.io/docs) · [MCP spec](https://modelcontextprotocol.io/)
