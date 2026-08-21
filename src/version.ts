// Single source of truth for the MCP server identity.
// Keep SERVER_VERSION in sync with `version` in package.json and server.json
// (see PUBLISHING.md). SERVER_NAME must not change — existing client configs
// reference it.
export const SERVER_NAME = 'directus-mcp-server-enhanced';
export const SERVER_VERSION = '12.3.1';
