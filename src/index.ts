#!/usr/bin/env node

import 'dotenv/config';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { loadConfigFromEnv, createServer } from './server.js';
import { logger } from './utils/logger.js';

const config = loadConfigFromEnv();

// Missing credentials are not a startup failure. A client (or a registry probe
// such as Glama's) must be able to spawn the server and complete the
// initialize/tools-list handshake before any Directus credentials exist; the
// individual tool calls are what need a token, and they report the 401
// themselves. Exiting here made the server unintrospectable.
if (!config.token) {
  logger.warn(
    'DIRECTUS_TOKEN is not set — serving tool metadata only; tool calls will fail until it is configured'
  );
}

// Debug logging
logger.info('Configuration loaded', {
  url: config.url,
  tokenPresent: !!config.token,
  tokenLength: config.token?.length || 0
});

const { server, deps } = createServer(config);

// Start the server
async function main() {
  // Connect the transport before touching the network. The health check below
  // can take tens of seconds against an unreachable host (four endpoints, each
  // retried with backoff), and introspection must not wait on it.
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info('Directus MCP Server running on stdio');

  if (!config.token) return;

  // Connectivity is reported, not enforced: a Directus instance that is down at
  // spawn time may well be up by the first tool call.
  try {
    const isHealthy = await deps.directusClient.ping();
    if (!isHealthy) {
      throw new Error('Server health check failed');
    }
    logger.info('Directus server connection verified');
  } catch (error) {
    logger.warn('Could not verify the Directus connection at startup', {
      error: (error as Error).message
    });
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Shutting down Directus MCP Server...');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Shutting down Directus MCP Server...');
  process.exit(0);
});

main().catch((error) => {
  logger.error('Failed to start server', { error: error.message });
  process.exit(1);
});
