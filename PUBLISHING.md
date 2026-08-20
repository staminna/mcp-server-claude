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

First confirm the version is aligned in **all four** places (see §3 — they must be
equal, and `npm publish` will not catch a mismatch):

```bash
# Prints one line if the four agree, more than one if they have drifted.
{ node -p "require('./package.json').version"
  node -p "require('./server.json').version"
  node -p "require('./server.json').packages[0].version"
  sed -n "s/.*SERVER_VERSION = '\([^']*\)'.*/\1/p" src/version.ts
} | sort -u
```

Then:

```bash
npm whoami                 # must be logged in as the @staminna owner
npm run test:all           # full suite must be green
npm pack --dry-run         # sanity-check the tarball contents (dist/, README, LICENSE)
npm publish                # prepublishOnly runs clean + build automatically
npm view @staminna/directus-mcp-server version   # verify the new version is live
```

`npm pack --dry-run` is not a formality: `files` in package.json is what keeps
`.env*` and the test suite out of the tarball. Read the list before publishing.

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

1. Bump `version` in **all four** places, keeping them equal:
   - `package.json` -> `version`
   - `server.json` -> `version`
   - `server.json` -> `packages[0].version`
   - `src/version.ts` -> `SERVER_VERSION` (the identity reported over MCP)
2. `npm run test:all`
3. `npm run badges && git diff --exit-code README.md` — CI fails on stale badges
4. Merge the release branch into the main line **before** tagging, so the tag
   names a commit that is actually on it.
5. Tag the merge commit and push it:
   ```bash
   git tag -a vX.Y.Z -m "vX.Y.Z — summary"
   git push origin vX.Y.Z
   ```
6. `npm publish`
7. `mcp-publisher publish`
