// Library exports for @staminna/directus-mcp-server
// This file provides the main exports when the package is used as a library

export { DirectusClient } from './client/directus-client.js';
export { DirectusWebSocketClient } from './websocket/websocket-client.js';

// Tool classes
export { CollectionTools } from './tools/collection-tools.js';
export { UserTools } from './tools/user-tools.js';
export { FileTools } from './tools/file-tools.js';
export { FlowTools } from './tools/flow-tools.js';
export { SchemaTools } from './tools/schema-tools.js';
export { DiagnosticTools } from './tools/diagnostic-tools.js';

// Utilities
export { logger, Logger } from './utils/logger.js';

// Server factory (testable wiring of the MCP server)
export {
  loadConfigFromEnv,
  createDeps,
  createHandlers,
  createServer,
  TOOL_DEFINITIONS
} from './server.js';
export type { ServerDeps } from './server.js';

// Types
export * from './types/directus.js';

// Re-export commonly used MCP SDK types for convenience
export { Server } from '@modelcontextprotocol/sdk/server/index.js';
export { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
export {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema
} from '@modelcontextprotocol/sdk/types.js';

// Import types for internal use
import { DirectusClient } from './client/directus-client.js';
import { CollectionTools } from './tools/collection-tools.js';
import { UserTools } from './tools/user-tools.js';
import { FileTools } from './tools/file-tools.js';
import { FlowTools } from './tools/flow-tools.js';
import { SchemaTools } from './tools/schema-tools.js';
import { DiagnosticTools } from './tools/diagnostic-tools.js';
import type { DirectusConfig } from './types/directus.js';

// Main server class for programmatic usage
export class DirectusMCPServer {
  private server: any;
  private directusClient: DirectusClient;
  private tools: {
    collection: CollectionTools;
    user: UserTools;
    file: FileTools;
    flow: FlowTools;
    schema: SchemaTools;
    diagnostic: DiagnosticTools;
  };

  constructor(config: DirectusConfig) {
    this.directusClient = new DirectusClient(config);
    this.tools = {
      collection: new CollectionTools(this.directusClient),
      user: new UserTools(this.directusClient),
      file: new FileTools(this.directusClient),
      flow: new FlowTools(this.directusClient),
      schema: new SchemaTools(this.directusClient),
      diagnostic: new DiagnosticTools(this.directusClient)
    };
  }

  /**
   * Get the Directus client instance
   */
  getClient(): DirectusClient {
    return this.directusClient;
  }

  /**
   * Get tool instances
   */
  getTools() {
    return this.tools;
  }

  /**
   * Test connection to Directus server
   */
  async ping(): Promise<boolean> {
    return this.directusClient.ping();
  }
}

// Default export
export default DirectusMCPServer;
