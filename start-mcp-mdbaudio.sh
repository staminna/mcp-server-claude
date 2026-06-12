#!/bin/bash
# MCP server wrapper for the LOCAL mdbaudio Directus (http://localhost:8066)
# Used by Claude Code (.mcp.json in ~/2026/mdbaudio) and Claude Desktop / Cowork

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

set -a
source "$SCRIPT_DIR/.env.mdbaudio"
set +a

exec node "$SCRIPT_DIR/dist/index.js"
