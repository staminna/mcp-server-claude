import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema
} from '@modelcontextprotocol/sdk/types.js';

// Import enhanced components
import { DirectusClient } from './client/directus-client.js';
import { CollectionTools } from './tools/collection-tools.js';
import { UserTools } from './tools/user-tools.js';
import { FileTools } from './tools/file-tools.js';
import { FlowTools } from './tools/flow-tools.js';
import { SchemaTools } from './tools/schema-tools.js';
import { DiagnosticTools } from './tools/diagnostic-tools.js';
import { logger } from './utils/logger.js';
import { DirectusConfig } from './types/directus.js';

export interface ServerDeps {
  directusClient: DirectusClient;
  collectionTools: CollectionTools;
  userTools: UserTools;
  fileTools: FileTools;
  flowTools: FlowTools;
  schemaTools: SchemaTools;
  diagnosticTools: DiagnosticTools;
}

// Configuration - WebSocket disabled to reduce logging noise
export function loadConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DirectusConfig {
  return {
    url: env.DIRECTUS_URL || 'http://localhost:8065',
    token: env.DIRECTUS_TOKEN || env.DIRECTUS_TOKEN!,
    timeout: parseInt(env.DIRECTUS_TIMEOUT || '30000'),
    retries: parseInt(env.DIRECTUS_RETRIES || '3'),
    retryDelay: parseInt(env.DIRECTUS_RETRY_DELAY || '1000'),
    maxRetryDelay: parseInt(env.DIRECTUS_MAX_RETRY_DELAY || '10000'),
    websocket: false, // Disabled to reduce logging noise
    // HTTPS Certificate Configuration
    https: (env.DIRECTUS_HTTPS_CA ||
           env.DIRECTUS_HTTPS_CERT ||
           env.DIRECTUS_HTTPS_KEY ||
           env.DIRECTUS_HTTPS_PFX) ? {
      ...(env.DIRECTUS_HTTPS_CA && { ca: env.DIRECTUS_HTTPS_CA }),
      ...(env.DIRECTUS_HTTPS_CERT && { cert: env.DIRECTUS_HTTPS_CERT }),
      ...(env.DIRECTUS_HTTPS_KEY && { key: env.DIRECTUS_HTTPS_KEY }),
      ...(env.DIRECTUS_HTTPS_PFX && { pfx: env.DIRECTUS_HTTPS_PFX }),
      ...(env.DIRECTUS_HTTPS_PASSPHRASE && { passphrase: env.DIRECTUS_HTTPS_PASSPHRASE }),
      ...(env.DIRECTUS_HTTPS_REJECT_UNAUTHORIZED && {
        rejectUnauthorized: env.DIRECTUS_HTTPS_REJECT_UNAUTHORIZED === 'true'
      }),
      ...(env.DIRECTUS_HTTPS_SERVERNAME && { servername: env.DIRECTUS_HTTPS_SERVERNAME })
    } : undefined
  };
}

// Initialize clients and tools
export function createDeps(config: DirectusConfig): ServerDeps {
  const directusClient = new DirectusClient(config);
  return {
    directusClient,
    collectionTools: new CollectionTools(directusClient),
    userTools: new UserTools(directusClient),
    fileTools: new FileTools(directusClient),
    flowTools: new FlowTools(directusClient),
    schemaTools: new SchemaTools(directusClient),
    diagnosticTools: new DiagnosticTools(directusClient),
  };
}

export const TOOL_DEFINITIONS = [
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
  // Diagnostic Tools
  {
    name: 'diagnose_collection_access',
    description: 'Diagnose collection access issues and permissions',
    inputSchema: {
      type: 'object',
      properties: {
        collection: { type: 'string', description: 'Collection name to diagnose' },
        includePermissions: { type: 'boolean', description: 'Include permission checks' },
        includeFields: { type: 'boolean', description: 'Include field access tests' },
        includeRelations: { type: 'boolean', description: 'Include relation access tests' }
      },
      required: ['collection'],
    },
  },
  {
    name: 'refresh_collection_cache',
    description: 'Refresh Directus collection cache and verify access',
    inputSchema: {
      type: 'object',
      properties: {
        collection: { type: 'string', description: 'Specific collection to verify after refresh' }
      },
    },
  },
  {
    name: 'validate_collection_creation',
    description: 'Validate that a newly created collection is properly accessible',
    inputSchema: {
      type: 'object',
      properties: {
        collection: { type: 'string', description: 'Collection name to validate' },
        waitTime: { type: 'number', description: 'Wait time in milliseconds before retry (default: 2000)' }
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
        status: { type: 'string', enum: ['active', 'inactive'], description: 'Filter by flow status' },
      },
    },
  },
  {
    name: 'get_flow',
    description: 'Get a specific flow by ID with optional operations',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Flow ID' },
        include_operations: { type: 'boolean', description: 'Include flow operations in response' },
      },
      required: ['id'],
    },
  },
  {
    name: 'create_flow',
    description: 'Create a new automation flow',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Flow name' },
        status: { type: 'string', enum: ['active', 'inactive'], description: 'Flow status (default: active)' },
        trigger: { type: 'string', description: 'Trigger type (e.g., manual, schedule, event, webhook)' },
        description: { type: 'string', description: 'Flow description' },
        options: { type: 'object', description: 'Trigger-specific options' },
        operations: {
          type: 'array',
          description: 'Initial operations to create with the flow',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Operation name' },
              key: { type: 'string', description: 'Operation key (unique identifier)' },
              type: { type: 'string', description: 'Operation type' },
              position_x: { type: 'number', description: 'X position in flow editor' },
              position_y: { type: 'number', description: 'Y position in flow editor' },
              options: { type: 'object', description: 'Operation-specific options' },
            },
            required: ['key', 'type', 'position_x', 'position_y'],
          },
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'update_flow',
    description: 'Update an existing flow',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Flow ID' },
        data: {
          type: 'object',
          description: 'Flow data to update',
          properties: {
            name: { type: 'string', description: 'Flow name' },
            status: { type: 'string', enum: ['active', 'inactive'], description: 'Flow status' },
            trigger: { type: 'string', description: 'Trigger type' },
            description: { type: 'string', description: 'Flow description' },
            options: { type: 'object', description: 'Trigger-specific options' },
          },
        },
      },
      required: ['id', 'data'],
    },
  },
  {
    name: 'delete_flow',
    description: 'Delete a flow and all its operations (requires confirmation)',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Flow ID' },
        confirm: { type: 'boolean', description: 'Confirm deletion' },
      },
      required: ['id'],
    },
  },
  {
    name: 'trigger_flow',
    description: 'Manually trigger a flow execution',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Flow ID' },
        data: { type: 'object', description: 'Data to pass to the flow' },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_operations',
    description: 'Get flow operations with optional filtering by flow',
    inputSchema: {
      type: 'object',
      properties: {
        flow_id: { type: 'string', description: 'Filter operations by flow ID' },
        limit: { type: 'number', description: 'Number of operations to return (default: 50)' },
      },
    },
  },
];

export function createHandlers(deps: ServerDeps, env: NodeJS.ProcessEnv = process.env) {
  const {
    directusClient,
    collectionTools,
    userTools,
    fileTools,
    flowTools,
    schemaTools,
    diagnosticTools,
  } = deps;

  // List available tools
  const listTools = async () => {
    return { tools: TOOL_DEFINITIONS };
  };

  // Handle tool calls
  const callTool = async (request: { params: { name: string; arguments?: Record<string, unknown> } }) => {
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

      // Diagnostic Tools
      } else if (name === 'diagnose_collection_access') {
        result = await diagnosticTools.diagnoseCollectionAccess(args as any);
      } else if (name === 'refresh_collection_cache') {
        result = await diagnosticTools.refreshCollectionCache(args as any);
      } else if (name === 'validate_collection_creation') {
        result = await diagnosticTools.validateCollectionCreation(args as any);

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
      } else if (name === 'get_flow') {
        result = await flowTools.getFlow(args as any);
      } else if (name === 'create_flow') {
        result = await flowTools.createFlow(args as any);
      } else if (name === 'update_flow') {
        result = await flowTools.updateFlow(args as any);
      } else if (name === 'delete_flow') {
        result = await flowTools.deleteFlow(args as any);
      } else if (name === 'trigger_flow') {
        result = await flowTools.triggerFlow(args as any);
      } else if (name === 'get_operations') {
        result = await flowTools.getOperations(args as any);

      } else {
        throw new Error(`Unknown tool: ${name}`);
      }

      return {
        content: [
          {
            type: 'text' as const,
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
            type: 'text' as const,
            text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  };

  // Handle prompts/list requests
  const listPrompts = async () => {
    try {
      const promptsEnabled = env.DIRECTUS_PROMPTS_COLLECTION_ENABLED === 'true';
      const promptsCollection = env.DIRECTUS_PROMPTS_COLLECTION || 'ai_prompts';

      if (!promptsEnabled) {
        logger.info('Prompts feature disabled. Set DIRECTUS_PROMPTS_COLLECTION_ENABLED=true to enable');
        return { prompts: [] };
      }

      // Fetch prompts from Directus
      const response = await directusClient.getItems(promptsCollection, {
        filter: { status: { _eq: 'published' } },
        fields: ['id', 'name', 'description', 'arguments'],
        limit: -1 // Get all prompts
      });

      const prompts = (response.data || []).map((prompt: any) => ({
        name: prompt.name || prompt.id,
        description: prompt.description || '',
        arguments: prompt.arguments ? JSON.parse(prompt.arguments) : []
      }));

      logger.info(`Loaded ${prompts.length} prompts from ${promptsCollection}`);

      return { prompts };
    } catch (error) {
      logger.error('Failed to load prompts', { error: error instanceof Error ? error.message : 'Unknown error' });
      return { prompts: [] };
    }
  };

  // Handle prompts/get requests
  const getPrompt = async (request: { params: { name: string; arguments?: Record<string, unknown> } }) => {
    try {
      const promptsEnabled = env.DIRECTUS_PROMPTS_COLLECTION_ENABLED === 'true';
      const promptsCollection = env.DIRECTUS_PROMPTS_COLLECTION || 'ai_prompts';

      if (!promptsEnabled) {
        throw new Error('Prompts feature is disabled. Set DIRECTUS_PROMPTS_COLLECTION_ENABLED=true to enable');
      }

      const { name, arguments: args } = request.params;

      // Fetch specific prompt by name
      const response = await directusClient.getItems(promptsCollection, {
        filter: {
          name: { _eq: name },
          status: { _eq: 'published' }
        },
        limit: 1
      });

      if (!response.data || response.data.length === 0) {
        throw new Error(`Prompt not found: ${name}`);
      }

      const prompt = response.data[0] as any;

      // Parse and process prompt template
      let promptText = prompt.content || prompt.template || '';

      // Replace argument placeholders if provided
      if (args && prompt.arguments) {
        const promptArgs = typeof prompt.arguments === 'string'
          ? JSON.parse(prompt.arguments)
          : prompt.arguments;

        for (const arg of promptArgs) {
          if (args[arg.name] !== undefined) {
            const placeholder = new RegExp(`\\{\\{${arg.name}\\}\\}`, 'g');
            promptText = promptText.replace(placeholder, String(args[arg.name]));
          }
        }
      }

      logger.info(`Retrieved prompt: ${name}`);

      return {
        description: prompt.description || '',
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: promptText
            }
          }
        ]
      };
    } catch (error) {
      logger.error('Failed to get prompt', {
        error: error instanceof Error ? error.message : 'Unknown error',
        name: request.params.name
      });
      throw error;
    }
  };

  // Handle resources/list requests
  const listResources = async () => {
    try {
      const resourcesEnabled = env.DIRECTUS_RESOURCES_ENABLED === 'true';

      if (!resourcesEnabled) {
        logger.info('Resources feature disabled. Set DIRECTUS_RESOURCES_ENABLED=true to enable');
        return { resources: [] };
      }

      // Get all collections
      const collectionsResponse = await directusClient.getCollections();
      const collections = collectionsResponse.data || [];

      // Exclude system collections by default
      const excludeSystem = env.DIRECTUS_RESOURCES_EXCLUDE_SYSTEM !== 'false';

      const resources = collections
        .filter((collection: any) => {
          if (excludeSystem && collection.collection?.startsWith('directus_')) {
            return false;
          }
          return collection.collection && collection.schema;
        })
        .map((collection: any) => ({
          uri: `directus://collection/${collection.collection}`,
          name: collection.meta?.name || collection.collection,
          description: collection.meta?.note || `Directus collection: ${collection.collection}`,
          mimeType: 'application/json'
        }));

      logger.info(`Exposed ${resources.length} collections as resources`);

      return { resources };
    } catch (error) {
      logger.error('Failed to list resources', { error: error instanceof Error ? error.message : 'Unknown error' });
      return { resources: [] };
    }
  };

  // Handle resources/read requests
  const readResource = async (request: { params: { uri: string } }) => {
    try {
      const resourcesEnabled = env.DIRECTUS_RESOURCES_ENABLED === 'true';

      if (!resourcesEnabled) {
        throw new Error('Resources feature is disabled. Set DIRECTUS_RESOURCES_ENABLED=true to enable');
      }

      const { uri } = request.params;

      // Parse URI: directus://collection/{collection_name}
      const match = uri.match(/^directus:\/\/collection\/(.+)$/);
      if (!match) {
        throw new Error(`Invalid resource URI: ${uri}. Expected format: directus://collection/{collection_name}`);
      }

      const collection = match[1];

      // Get collection schema and sample data
      const [schemaResponse, itemsResponse] = await Promise.all([
        directusClient.getCollection(collection),
        directusClient.getItems(collection, { limit: 10 })
      ]);

      const resource = {
        schema: schemaResponse.data,
        items: itemsResponse.data || [],
        meta: itemsResponse.meta || {}
      };

      logger.info(`Retrieved resource: ${collection}`);

      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(resource, null, 2)
          }
        ]
      };
    } catch (error) {
      logger.error('Failed to read resource', {
        error: error instanceof Error ? error.message : 'Unknown error',
        uri: request.params.uri
      });
      throw error;
    }
  };

  return { listTools, callTool, listPrompts, getPrompt, listResources, readResource };
}

// Initialize MCP server
export function createServer(
  config: DirectusConfig,
  deps: ServerDeps = createDeps(config),
  env: NodeJS.ProcessEnv = process.env
): { server: Server; deps: ServerDeps } {
  const server = new Server(
    {
      name: 'directus-mcp-server-enhanced',
      version: '2.0.0',
    },
    {
      capabilities: {
        tools: {},
        prompts: {},
        resources: {},
      },
    }
  );

  const handlers = createHandlers(deps, env);

  server.setRequestHandler(ListToolsRequestSchema, handlers.listTools);
  server.setRequestHandler(CallToolRequestSchema, handlers.callTool);
  server.setRequestHandler(ListPromptsRequestSchema, handlers.listPrompts);
  server.setRequestHandler(GetPromptRequestSchema, handlers.getPrompt);
  server.setRequestHandler(ListResourcesRequestSchema, handlers.listResources);
  server.setRequestHandler(ReadResourceRequestSchema, handlers.readResource);

  return { server, deps };
}
