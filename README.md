# @staminna/directus-mcp-server

Enhanced MCP (Model Context Protocol) server for Directus v12.0.0 with TypeScript, WebSocket support, and full API coverage.

[![npm version](https://badge.fury.io/js/%40staminna%2Fdirectus-mcp-server.svg)](https://www.npmjs.com/package/@staminna/directus-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/staminna/mcp-server-claude/actions/workflows/ci.yml/badge.svg)](https://github.com/staminna/mcp-server-claude/actions/workflows/ci.yml)

### Test Coverage

| Statements | Branches | Functions | Lines |
|------------|----------|-----------|-------|
| ![Statements](https://img.shields.io/badge/statements-98.37%25-brightgreen.svg?style=flat) | ![Branches](https://img.shields.io/badge/branches-95.05%25-brightgreen.svg?style=flat) | ![Functions](https://img.shields.io/badge/functions-96.61%25-brightgreen.svg?style=flat) | ![Lines](https://img.shields.io/badge/lines-98.38%25-brightgreen.svg?style=flat) |

Coverage badges are generated from `coverage/coverage-summary.json` by `npm run badges` (no external service required). Run `npm run test:coverage` first.

## Features

- 🔐 **Full Authentication** - Token-based authentication with Directus
- 📦 **Collection Management** - CRUD operations for collections and items
- 📁 **File Operations** - Upload, download, and manage files
- 🔄 **Flow Management** - Create, update, trigger, and manage Directus Flows
- 👥 **User Management** - User CRUD and role management
- 🔍 **Schema Tools** - Analyze and validate collection schemas
- 🩺 **Diagnostics** - Collection access diagnostics and troubleshooting
- ⚡ **WebSocket Support** - Real-time subscriptions (coming soon)

## Installation

### Via npm (Recommended)

```bash
npm install -g @staminna/directus-mcp-server
```

### From Source

```bash
git clone https://github.com/staminna/mcp-server-claude.git
cd mcp-server-claude
npm install
npm run build
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DIRECTUS_URL` | Yes | Your Directus instance URL (e.g., `http://localhost:8065`) |
| `DIRECTUS_TOKEN` | Yes | Static API token with appropriate permissions |
| `DIRECTUS_PROMPTS_COLLECTION_ENABLED` | No | Enable AI prompts collection (`true`/`false`) |
| `DIRECTUS_PROMPTS_COLLECTION` | No | Collection name for AI prompts (default: `ai_prompts`) |
| `DIRECTUS_RESOURCES_ENABLED` | No | Enable resources feature (`true`/`false`) |
| `DIRECTUS_RESOURCES_EXCLUDE_SYSTEM` | No | Exclude system collections from resources (`true`/`false`) |
| `NODE_ENV` | No | Environment mode (`development`/`production`) |

---

## Authentication — no OAuth required

This server uses a **static Directus access token** (`DIRECTUS_TOKEN`) and runs over **stdio transport**. OAuth is *not* required, by design:

- The MCP specification only defines OAuth 2.1 authorization for **HTTP-based transports**. For stdio servers the spec says implementations *"SHOULD NOT"* use it and should instead retrieve credentials from the environment — exactly what this server does.
- **Directus 12 fully supports static access tokens.** The OAuth 2.1 support Directus added (mid-2026) applies to its own built-in *remote* MCP endpoint and is optional; there are no breaking changes to token authentication in Directus 12 (see `DIRECTUS_V12_BREAKING_CHANGES.md`).
- OAuth only becomes relevant if you expose an MCP server **remotely over HTTP** (Streamable HTTP/SSE). As a local stdio subprocess of Claude Desktop, Claude Code, Cursor, etc., this server needs only the env token.

Generate the token in Directus under **User Settings → Token** (use a dedicated user with least-privilege role for production).

### Using with a Claude subscription (Max/Pro) — no API key needed

MCP servers do not consume Anthropic API tokens themselves; only the AI client's model calls do. If you use this server inside **Claude Code or Claude Desktop with a Claude Max (or Pro) subscription**, the model usage is covered by the subscription — you do **not** need an Anthropic API key. An API key is only required when driving Claude programmatically via the Claude API (e.g. the remote MCP connector).

---

## IDE Configuration

### 🟣 Cursor

1. Open Cursor Settings: `Cmd+,` (macOS) or `Ctrl+,` (Windows/Linux)
2. Search for **"MCP"** or navigate to **Features → MCP Servers**
3. Click **"Edit in settings.json"**
4. Add the following configuration:

```json
{
  "mcpServers": {
    "directus": {
      "command": "npx",
      "args": [
        "-y",
        "@staminna/directus-mcp-server"
      ],
      "env": {
        "DIRECTUS_URL": "http://localhost:8065",
        "DIRECTUS_TOKEN": "your-directus-token-here"
      }
    }
  }
}
```

**Or if installed locally:**

```json
{
  "mcpServers": {
    "directus": {
      "command": "node",
      "args": [
        "/path/to/mcp-server-claude/dist/index.js"
      ],
      "env": {
        "DIRECTUS_URL": "http://localhost:8065",
        "DIRECTUS_TOKEN": "your-directus-token-here"
      }
    }
  }
}
```

5. Save the file and restart Cursor

---

### 🌊 Windsurf

1. Open Windsurf Settings: `Cmd+,` (macOS) or `Ctrl+,` (Windows/Linux)
2. Search for **"MCP Servers"**
3. Click **"Edit in settings.json"**
4. Add the following configuration:

```json
{
  "mcpServers": {
    "directus": {
      "command": "npx",
      "args": [
        "-y",
        "@staminna/directus-mcp-server"
      ],
      "env": {
        "DIRECTUS_URL": "http://localhost:8065",
        "DIRECTUS_TOKEN": "your-directus-token-here",
        "DIRECTUS_PROMPTS_COLLECTION_ENABLED": "true",
        "DIRECTUS_PROMPTS_COLLECTION": "ai_prompts",
        "DIRECTUS_RESOURCES_ENABLED": "true",
        "DIRECTUS_RESOURCES_EXCLUDE_SYSTEM": "true",
        "NODE_ENV": "production"
      }
    }
  }
}
```

**Or if installed locally:**

```json
{
  "mcpServers": {
    "directus": {
      "command": "node",
      "args": [
        "/path/to/mcp-server-claude/dist/index.js"
      ],
      "env": {
        "DIRECTUS_URL": "http://localhost:8065",
        "DIRECTUS_TOKEN": "your-directus-token-here"
      }
    }
  }
}
```

5. Save the file
6. **Quit Windsurf completely** (`Cmd+Q` or `Ctrl+Q`)
7. Reopen Windsurf and wait ~10 seconds for MCP to initialize

---

### 🤖 Claude Desktop

1. Locate your Claude Desktop config file:
   - **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
   - **Linux**: `~/.config/Claude/claude_desktop_config.json`

2. Create or edit the config file:

```json
{
  "mcpServers": {
    "directus": {
      "command": "npx",
      "args": [
        "-y",
        "@staminna/directus-mcp-server"
      ],
      "env": {
        "DIRECTUS_URL": "http://localhost:8065",
        "DIRECTUS_TOKEN": "your-directus-token-here"
      }
    }
  }
}
```

**Or if installed locally:**

```json
{
  "mcpServers": {
    "directus": {
      "command": "node",
      "args": [
        "/path/to/mcp-server-claude/dist/index.js"
      ],
      "env": {
        "DIRECTUS_URL": "http://localhost:8065",
        "DIRECTUS_TOKEN": "your-directus-token-here"
      }
    }
  }
}
```

3. Save the file and restart Claude Desktop

---

### 🔮 Claude.ai (Web with MCP)

For Claude.ai web interface with MCP support:

1. Navigate to Claude.ai settings
2. Find the MCP configuration section
3. Add a new MCP server with:

```json
{
  "name": "directus",
  "command": "npx",
  "args": ["-y", "@staminna/directus-mcp-server"],
  "env": {
    "DIRECTUS_URL": "http://localhost:8065",
    "DIRECTUS_TOKEN": "your-directus-token-here"
  }
}
```

> **Note**: Claude.ai MCP support may require a Pro subscription and specific browser extensions.

---

## Available Tools

### Collection Management
| Tool | Description |
|------|-------------|
| `list_collections` | List all collections in Directus |
| `get_collection_schema` | Get schema for a specific collection |
| `get_collection_items` | Get items from a collection with filtering |
| `create_collection` | Create a new collection |
| `create_item` | Create a new item in a collection |
| `update_item` | Update an existing item |
| `delete_items` | Delete items from a collection |
| `bulk_operations` | Execute bulk create, update, delete |

### Schema & Fields
| Tool | Description |
|------|-------------|
| `create_field` | Create a new field in a collection |
| `update_field` | Update an existing field |
| `delete_field` | Delete a field from a collection |
| `create_relationship` | Create relationships (O2O, O2M, M2O, M2M, M2A) |
| `analyze_collection_schema` | Analyze schema with relationship mapping |
| `validate_collection_schema` | Validate schema and relationships |
| `analyze_relationships` | Analyze relationships across collections |

### Flow Management
| Tool | Description |
|------|-------------|
| `get_flows` | Get all flows with optional filtering |
| `get_flow` | Get a specific flow by ID |
| `create_flow` | Create a new automation flow |
| `update_flow` | Update an existing flow |
| `delete_flow` | Delete a flow |
| `trigger_flow` | Manually trigger a flow |
| `get_operations` | Get flow operations |

### User Management
| Tool | Description |
|------|-------------|
| `get_users` | Get all users with filtering |
| `get_user` | Get a specific user by ID |

### File Management
| Tool | Description |
|------|-------------|
| `get_files` | Get files with filtering and pagination |

### Diagnostics
| Tool | Description |
|------|-------------|
| `diagnose_collection_access` | Diagnose collection access issues |
| `refresh_collection_cache` | Refresh collection cache |
| `validate_collection_creation` | Validate newly created collections |

---

## Usage Examples

Once configured, you can interact with Directus through your AI assistant:

```
"List all collections in my Directus instance"

"Create a new collection called 'blog_posts' with title, content, and published fields"

"Get all items from the 'products' collection where status is 'published'"

"Create a new flow that triggers on item creation in the 'orders' collection"

"Analyze the schema of the 'users' collection including relationships"
```

---

## Troubleshooting

### MCP Server Not Connecting

1. **Verify Directus is running**: Ensure your Directus instance is accessible at the configured URL
2. **Check token permissions**: The API token needs appropriate permissions for the operations you want to perform
3. **Restart IDE**: After changing MCP configuration, fully restart your IDE
4. **Check logs**: Look for MCP-related errors in your IDE's developer console

### Permission Errors

Ensure your Directus token has the required permissions:
- Admin token for full access
- Or configure specific role permissions for collections you need to access

### Connection Timeout

If using a remote Directus instance:
- Verify the URL is correct and accessible
- Check firewall/network settings
- Ensure CORS is properly configured on Directus

---

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Watch mode
npm run dev

# Run server
npm start

# Type check
npm run typecheck

# Lint
npm run lint
```

### Testing

The project ships unit, integration and end-to-end suites (vitest). Coverage thresholds (90% statements/lines/functions, 85% branches) are enforced — the test run fails below them.

```bash
# Unit + integration tests
npm test

# With coverage report (coverage/ — text, html, lcov, json-summary)
npm run test:coverage

# End-to-end: builds, then spawns the real server over stdio against a mock Directus
npm run test:e2e

# Everything
npm run test:all

# Refresh the README coverage badges from the last coverage run
npm run badges
```

The e2e suite uses the official MCP SDK client (`StdioClientTransport`) to spawn `dist/index.js` as a subprocess, talking to an in-process mock Directus on an ephemeral port — no real Directus instance or network access needed.

---

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## License

MIT © [Jorge Domingues Nunes](https://github.com/staminna)

---

## Links

- [npm Package](https://www.npmjs.com/package/@staminna/directus-mcp-server)
- [GitHub Repository](https://github.com/staminna/mcp-server-claude)
- [Directus Documentation](https://docs.directus.io/)
- [MCP Protocol Specification](https://modelcontextprotocol.io/)
