#!/usr/bin/env node

import 'dotenv/config';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// Import enhanced components
import { DirectusClient } from './client/directus-client.js';
import { CollectionTools } from './tools/collection-tools.js';
import { UserTools } from './tools/user-tools.js';
import { FileTools } from './tools/file-tools.js';
import { FlowTools } from './tools/flow-tools.js';
import { SchemaTools } from './tools/schema-tools.js';
import { logger } from './utils/logger.js';
import { DirectusConfig } from './types/directus.js';

// Configuration - WebSocket disabled to reduce logging noise
const config: DirectusConfig = {
  url: process.env.DIRECTUS_URL || 'https://apidev.romanceinroom.com',
  token: process.env.DIRECTUS_TOKEN!,
  timeout: parseInt(process.env.DIRECTUS_TIMEOUT || '30000'),
  retries: parseInt(process.env.DIRECTUS_RETRIES || '3'),
  retryDelay: parseInt(process.env.DIRECTUS_RETRY_DELAY || '1000'),
  maxRetryDelay: parseInt(process.env.DIRECTUS_MAX_RETRY_DELAY || '10000'),
  websocket: false // Disabled to reduce logging noise
};

if (!config.token) {
  logger.error('DIRECTUS_TOKEN environment variable is required');
  process.exit(1);
}

// Initialize clients and tools
const directusClient = new DirectusClient(config);
const collectionTools = new CollectionTools(directusClient);
const userTools = new UserTools(directusClient);
const fileTools = new FileTools(directusClient);
const flowTools = new FlowTools(directusClient);
const schemaTools = new SchemaTools(directusClient);

// Initialize MCP server
const server = new Server(
  {
    name: 'directus-mcp-server-enhanced',
    version: '2.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      // Collection Management
      {
        name: 'list_collections',
        description: 'List all collections in the Directus instance',
        inputSchema: {
          type: 'object',
          properties: {
            include_system: { type: 'boolean', description: 'Include system collections' }
          },
        },
      },
      {
        name: 'get_collection_schema',
        description: 'Get the schema for a specific collection',
        inputSchema: {
          type: 'object',
          properties: {
            collection: { type: 'string', description: 'Collection name' },
          },
          required: ['collection'],
        },
      },
      {
        name: 'get_collection_items',
        description: 'Get items from a collection with optional filtering and pagination',
        inputSchema: {
          type: 'object',
          properties: {
            collection: { type: 'string', description: 'Collection name' },
            limit: { type: 'number', description: 'Number of items to return (default: 25)' },
            offset: { type: 'number', description: 'Number of items to skip' },
            filter: { type: 'object', description: 'Filter conditions' },
            sort: { type: 'array', items: { type: 'string' }, description: 'Sort fields' },
            fields: { type: 'array', items: { type: 'string' }, description: 'Fields to return' },
            search: { type: 'string', description: 'Search query' },
          },
          required: ['collection'],
        },
      },
      {
        name: 'create_collection',
        description: 'Create a new collection with optional fields',
        inputSchema: {
          type: 'object',
          properties: {
            collection: { type: 'string', description: 'Collection name' },
            meta: { type: 'object', description: 'Collection metadata' },
            fields: { type: 'array', description: 'Initial fields to create' }
          },
          required: ['collection'],
        },
      },
      {
        name: 'delete_collection',
        description: 'Delete a collection (requires confirmation)',
        inputSchema: {
          type: 'object',
          properties: {
            collection: { type: 'string', description: 'Collection name' },
            confirm: { type: 'boolean', description: 'Confirm deletion' }
          },
          required: ['collection'],
        },
      },
      {
        name: 'create_item',
        description: 'Create a new item in a collection',
        inputSchema: {
          type: 'object',
          properties: {
            collection: { type: 'string', description: 'Collection name' },
            data: { type: 'object', description: 'Item data' }
          },
          required: ['collection', 'data'],
        },
      },
      {
        name: 'update_item',
        description: 'Update an existing item in a collection',
        inputSchema: {
          type: 'object',
          properties: {
            collection: { type: 'string', description: 'Collection name' },
            id: { type: ['string', 'number'], description: 'Item ID' },
            data: { type: 'object', description: 'Updated data' }
          },
          required: ['collection', 'id', 'data'],
        },
      },
      {
        name: 'delete_items',
        description: 'Delete items from a collection with optional cascade',
        inputSchema: {
          type: 'object',
          properties: {
            collection: { type: 'string', description: 'Collection name' },
            ids: { type: 'array', items: { type: ['string', 'number'] }, description: 'Item IDs to delete' },
            confirm: { type: 'boolean', description: 'Confirm deletion' },
            cascadeDelete: { type: 'boolean', description: 'Delete related items' }
          },
          required: ['collection', 'ids'],
        },
      },
      // Field Management
      {
        name: 'create_field',
        description: 'Create a new field in a collection',
        inputSchema: {
          type: 'object',
          properties: {
            collection: { type: 'string', description: 'Collection name' },
            field: { type: 'string', description: 'Field name' },
            type: { type: 'string', description: 'Field type' },
            interface: { type: 'string', description: 'Field interface' },
            required: { type: 'boolean', description: 'Is field required' },
            unique: { type: 'boolean', description: 'Is field unique' },
            default_value: { description: 'Default value' },
            note: { type: 'string', description: 'Field note' },
            validation: { type: 'object', description: 'Validation rules' },
            options: { type: 'object', description: 'Interface options' }
          },
          required: ['collection', 'field', 'type'],
        },
      },
      {
        name: 'update_field',
        description: 'Update an existing field in a collection',
        inputSchema: {
          type: 'object',
          properties: {
            collection: { type: 'string', description: 'Collection name' },
            field: { type: 'string', description: 'Field name' },
            type: { type: 'string', description: 'Field type' },
            interface: { type: 'string', description: 'Field interface' },
            required: { type: 'boolean', description: 'Is field required' },
            unique: { type: 'boolean', description: 'Is field unique' },
            default_value: { description: 'Default value' },
            note: { type: 'string', description: 'Field note' },
            validation: { type: 'object', description: 'Validation rules' },
            options: { type: 'object', description: 'Interface options' }
          },
          required: ['collection', 'field'],
        },
      },
      {
        name: 'delete_field',
        description: 'Delete a field from a collection (requires confirmation)',
        inputSchema: {
          type: 'object',
          properties: {
            collection: { type: 'string', description: 'Collection name' },
            field: { type: 'string', description: 'Field name' },
            confirm: { type: 'boolean', description: 'Confirm deletion' }
          },
          required: ['collection', 'field'],
        },
      },
      {
        name: 'bulk_operations',
        description: 'Execute bulk create, update, and delete operations',
        inputSchema: {
          type: 'object',
          properties: {
            collection: { type: 'string', description: 'Collection name' },
            operations: {
              type: 'object',
              properties: {
                create: { type: 'array', description: 'Items to create' },
                update: { type: 'array', description: 'Items to update' },
                delete: { type: 'array', description: 'Item IDs to delete' }
              }
            },
            validate: { type: 'boolean', description: 'Validate operations before execution' }
          },
          required: ['collection', 'operations'],
        },
      },
      // Schema Analysis and Relationship Management
      {
        name: 'analyze_collection_schema',
        description: 'Analyze collection schema with relationship mapping and validation',
        inputSchema: {
          type: 'object',
          properties: {
            collection: { type: 'string', description: 'Collection name' },
            includeRelations: { type: 'boolean', description: 'Include relationship analysis' },
            validateConstraints: { type: 'boolean', description: 'Validate schema constraints' }
          },
          required: ['collection'],
        },
      },
      {
        name: 'analyze_relationships',
        description: 'Analyze relationships across collections',
        inputSchema: {
          type: 'object',
          properties: {
            collection: { type: 'string', description: 'Specific collection to analyze' },
            includeSystemCollections: { type: 'boolean', description: 'Include system collections' }
          },
        },
      },
      {
        name: 'create_relationship',
        description: 'Create relationships between collections (O2O, O2M, M2O, M2M, M2A)',
        inputSchema: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['o2o', 'o2m', 'm2o', 'm2m', 'm2a'], description: 'Relationship type' },
            collection: { type: 'string', description: 'Source collection' },
            field: { type: 'string', description: 'Source field' },
            related_collection: { type: 'string', description: 'Target collection' },
            related_field: { type: 'string', description: 'Target field' },
            junction_collection: { type: 'string', description: 'Junction collection (M2M only)' },
            junction_field: { type: 'string', description: 'Junction field (M2M only)' },
            related_junction_field: { type: 'string', description: 'Related junction field (M2M only)' },
            allowed_collections: { type: 'array', items: { type: 'string' }, description: 'Allowed collections (M2A only)' },
            collection_field: { type: 'string', description: 'Collection field (M2A only)' },
            primary_key_field: { type: 'string', description: 'Primary key field (M2A only)' },
            sort_field: { type: 'string', description: 'Sort field' },
            on_delete: { type: 'string', enum: ['CASCADE', 'SET NULL', 'RESTRICT'], description: 'On delete action' },
            on_update: { type: 'string', enum: ['CASCADE', 'SET NULL', 'RESTRICT'], description: 'On update action' }
          },
          required: ['type', 'collection', 'field'],
        },
      },
      {
        name: 'validate_collection_schema',
        description: 'Validate collection schema and relationships',
        inputSchema: {
          type: 'object',
          properties: {
            collection: { type: 'string', description: 'Collection name' },
            strict: { type: 'boolean', description: 'Enable strict validation' }
          },
          required: ['collection'],
        },
      },
      // User Management
      {
        name: 'get_users',
        description: 'Get all users with optional filtering and pagination',
        inputSchema: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Number of users to return (default: 25)' },
            offset: { type: 'number', description: 'Number of users to skip' },
            filter: { type: 'object', description: 'Filter conditions' },
            sort: { type: 'array', items: { type: 'string' }, description: 'Sort fields' },
            fields: { type: 'array', items: { type: 'string' }, description: 'Fields to return' },
            search: { type: 'string', description: 'Search query' },
          },
        },
      },
      {
        name: 'get_user',
        description: 'Get a specific user by ID',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'User ID' },
            fields: { type: 'array', items: { type: 'string' }, description: 'Fields to return' },
          },
          required: ['id'],
        },
      },
      // File Management
      {
        name: 'get_files',
        description: 'Get files with optional filtering and pagination',
        inputSchema: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Number of files to return (default: 25)' },
            offset: { type: 'number', description: 'Number of files to skip' },
            filter: { type: 'object', description: 'Filter conditions' },
            sort: { type: 'array', items: { type: 'string' }, description: 'Sort fields' },
            fields: { type: 'array', items: { type: 'string' }, description: 'Fields to return' },
            search: { type: 'string', description: 'Search query' },
          },
        },
      },
      // Flow Management
      {
        name: 'get_flows',
        description: 'Get flows with optional filtering and pagination',
        inputSchema: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Number of flows to return (default: 25)' },
            offset: { type: 'number', description: 'Number of flows to skip' },
            filter: { type: 'object', description: 'Filter conditions' },
            sort: { type: 'array', items: { type: 'string' }, description: 'Sort fields' },
            fields: { type: 'array', items: { type: 'string' }, description: 'Fields to return' },
            search: { type: 'string', description: 'Search query' },
          },
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  try {
    let result: any;

    // Collection Management Tools
    if (name === 'list_collections') {
      result = await collectionTools.listCollections(args);
    } else if (name === 'get_collection_schema') {
      result = await collectionTools.getCollectionSchema(args as any);
    } else if (name === 'get_collection_items') {
      result = await collectionTools.getCollectionItems(args as any);
    } else if (name === 'create_collection') {
      result = await collectionTools.createCollection(args as any);
    } else if (name === 'delete_collection') {
      result = await collectionTools.deleteCollection(args as any);
    } else if (name === 'create_item') {
      result = await collectionTools.createItem(args as any);
    } else if (name === 'update_item') {
      result = await collectionTools.updateItem(args as any);
    } else if (name === 'delete_items') {
      result = await collectionTools.deleteItems(args as any);
    
    // Field Management Tools
    } else if (name === 'create_field') {
      result = await collectionTools.createField(args as any);
    } else if (name === 'update_field') {
      result = await collectionTools.updateField(args as any);
    } else if (name === 'delete_field') {
      result = await collectionTools.deleteField(args as any);
    } else if (name === 'bulk_operations') {
      result = await collectionTools.bulkOperations(args as any);
    
    // Schema Analysis and Relationship Management Tools
    } else if (name === 'analyze_collection_schema') {
      result = await schemaTools.analyzeCollectionSchema(args as any);
    } else if (name === 'analyze_relationships') {
      result = await schemaTools.analyzeRelationships(args as any);
    } else if (name === 'create_relationship') {
      result = await schemaTools.createRelationship(args as any);
    } else if (name === 'validate_collection_schema') {
      result = await schemaTools.validateCollectionSchema(args as any);

    // User Management Tools
    } else if (name === 'get_users') {
      result = await userTools.getUsers(args);
    } else if (name === 'get_user') {
      result = await userTools.getUser(args as any);

    // File Management Tools
    } else if (name === 'get_files') {
      result = await fileTools.getFiles(args);

    // Flow Management Tools
    } else if (name === 'get_flows') {
      result = await flowTools.getFlows(args);

    } else {
      throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    logger.error(`Tool execution failed: ${name}`, { 
      error: error instanceof Error ? error.message : 'Unknown error',
      args 
    });
    
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      ],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  // Test connection to Directus
  try {
    const isHealthy = await directusClient.ping();
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
