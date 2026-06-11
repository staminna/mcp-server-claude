#!/usr/bin/env node

import 'dotenv/config';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { loadConfigFromEnv, createServer } from './server.js';
import { logger } from './utils/logger.js';

const config = loadConfigFromEnv();

if (!config.token) {
  logger.error('DIRECTUS_TOKEN or DIRECTUS_TOKEN environment variable is required');
  process.exit(1);
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
  // Test connection to Directus
  try {
    const isHealthy = await deps.directusClient.ping();
    if (!isHealthy) {
      throw new Error('Server health check failed');
    }
    logger.info('Directus server connection verified');
  } catch (error) {
    logger.error('Failed to connect to Directus server', { error: (error as Error).message });
    process.exit(1);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info('Enhanced Directus MCP Server running on stdio (WebSocket disabled for clean logging)');
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
