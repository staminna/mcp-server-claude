# Publishing Guide

## Why not the Directus Marketplace?

The Directus Marketplace only lists **Directus extensions** — packages with a
`directus:extension` manifest that run *inside* a Directus instance (and API
extensions must be sandboxed to be listed). A standalone MCP server cannot
appear there. The correct public venue for this package is the **official MCP
Registry** (https://registry.modelcontextprotocol.io), which is what Claude
Desktop/Code, Cursor, VS Code and other MCP clients use for discovery.

The registry prep is already done in this repo:

- `package.json` has `"mcpName": "io.github.staminna/directus-mcp-server"`
  (the registry verifies npm ownership through this field).
- `server.json` describes the server (stdio transport, npm package, env vars).

## 1. Publish to npm

```bash
npm whoami                 # must be logged in as the @staminna owner
npm run test:all           # full suite must be green
npm pack --dry-run         # sanity-check the tarball contents (dist/, README, LICENSE)
npm publish                # prepublishOnly runs clean + build automatically
npm view @staminna/directus-mcp-server version   # verify 12.0.0
```

## 2. Publish to the MCP Registry (when ready)

```bash
# Install the publisher CLI (macOS)
brew install mcp-publisher
# (or download a release binary from
#  https://github.com/modelcontextprotocol/registry/releases)

# Authenticate — GitHub OAuth proves ownership of the io.github.staminna/* namespace
mcp-publisher login github

# Publish (reads ./server.json; npm package must already be live with mcpName)
mcp-publisher publish
```

Verify at: https://registry.modelcontextprotocol.io/v0/servers?search=directus

## 3. Each future release

1. Bump `version` in **both** `package.json` and `server.json` (keep them equal).
2. `npm run test:all`
3. `npm publish`
4. `mcp-publisher publish`
