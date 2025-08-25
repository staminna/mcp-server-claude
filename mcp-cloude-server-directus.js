#!/usr/bin/env node
import 'dotenv/config';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// adding polyfill for fetch
import fetch from 'node-fetch';
globalThis.fetch = fetch;

// Configuration
const DIRECTUS_URL = process.env.DIRECTUS_URL || 'https://apidev.romanceinroom.com';
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN;

if (!DIRECTUS_TOKEN) {
  console.error('DIRECTUS_TOKEN environment variable is required');
  process.exit(1);
}

console.error('Fetch available:', typeof fetch !== 'undefined');
console.error('Node version:', process.version);

// Directus API helper
async function directusAPI(endpoint, options = {}) {
  const url = `${DIRECTUS_URL}${endpoint}`;
  console.error(`🔍 API Call: ${url}`);
  console.error(`🔑 Token present: ${DIRECTUS_TOKEN ? 'YES' : 'NO'}`);

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${DIRECTUS_TOKEN}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  console.error(`📡 Response: ${response.status} ${response.statusText}`);

  if (!response.ok) {
    throw new Error(`Directus API error: ${response.status} - ${response.statusText}`);
  }

  const data = await response.json();
  console.error(`📊 Data length: ${data.data ? data.data.length : 'no data array'}`);

  return data;
}

// Excisaty API helper
async function excisatyAPI(endpoint, options = {}) {
  const EXCISATY_API_URL = process.env.EXCISATY_API_URL || 'https://api.excisaty.com';
  const EXCISATY_API_KEY = process.env.EXCISATY_API_KEY;

  if (!EXCISATY_API_KEY) {
    throw new Error('EXCISATY_API_KEY environment variable is required');
  }

  const url = `${EXCISATY_API_URL}${endpoint}`;
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${EXCISATY_API_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  if (!response.ok) {
    throw new Error(`Excisaty API error: ${response.status} - ${response.statusText}`);
  }

  return response.json();
}

// Get all prompts from Directus
async function getPrompts() {
  try {
    const response = await directusAPI('/items/prompts?filter[status][_eq]=published');
    return response.data || [];
  } catch (error) {
    console.error('Error fetching prompts:', error);
    return [];
  }
}

// Get specific prompt by name
async function getPromptByName(name) {
  try {
    const response = await directusAPI(`/items/prompts?filter[name][_eq]=${encodeURIComponent(name)}&limit=1`);
    return response.data?.[0] || null;
  } catch (error) {
    console.error('Error fetching prompt:', error);
    return null;
  }
}

// Get collections from Directus
async function getCollections() {
  try {
    const response = await directusAPI('/collections');
    return response.data || [];
  } catch (error) {
    console.error('Error fetching collections:', error);
    return [];
  }
}

// Get items from a collection
async function getCollectionItems(collection, limit = 10) {
  try {
    const response = await directusAPI(`/items/${collection}?limit=${limit}`);
    return response.data || [];
  } catch (error) {
    console.error(`Error fetching ${collection} items:`, error);
    return [];
  }
}

// Extract variables from prompt text (mustache-style)
function extractVariables(text) {
  if (!text) return [];
  const matches = text.match(/\{\{([^}]+)\}\}/g);
  if (!matches) return [];
  return [...new Set(matches.map(match => match.slice(2, -2).trim()))];
}

// Schema management tools handler
async function handleSchemaTools(toolName, args) {
  switch (toolName) {
    case 'create_field': {
      const { collection, field, type, meta = {} } = args;

      try {
        const response = await directusAPI('/fields/' + collection, {
          method: 'POST',
          body: JSON.stringify({
            field: field,
            type: type,
            meta: {
              interface: getInterfaceForType(type),
              options: {},
              display: 'raw',
              display_options: {},
              readonly: false,
              hidden: false,
              sort: null,
              width: 'full',
              translations: null,
              note: null,
              conditions: null,
              required: false,
              group: null,
              validation: null,
              validation_message: null,
              ...meta
            },
            schema: {
              name: field,
              table: collection,
              data_type: type,
              default_value: null,
              max_length: type === 'string' ? 255 : null,
              numeric_precision: null,
              numeric_scale: null,
              is_nullable: true,
              is_unique: false,
              is_primary_key: false,
              has_auto_increment: false,
              foreign_key_column: null,
              foreign_key_table: null,
              comment: null
            }
          })
        });

        return {
          content: [{
            type: 'text',
            text: `Field '${field}' created successfully in collection '${collection}'`
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `Error creating field: ${error.message}`
          }]
        };
      }
    }

    case 'delete_field': {
      const { collection, field } = args;

      try {
        await directusAPI(`/fields/${collection}/${field}`, {
          method: 'DELETE'
        });

        return {
          content: [{
            type: 'text',
            text: `Field '${field}' deleted from collection '${collection}'`
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `Error deleting field: ${error.message}`
          }]
        };
      }
    }

    case 'create_relation': {
      const { collection, field, related_collection, relation_type, junction_field } = args;

      try {
        let relationData = {
          collection: collection,
          field: field,
          related_collection: related_collection
        };

        if (relation_type === 'm2m') {
          relationData.meta = {
            one_field: field,
            junction_field: junction_field,
            sort_field: null,
            one_deselect_action: 'delete'
          };
        } else if (relation_type === 'm2o') {
          relationData.meta = {
            one_field: null,
            sort_field: null,
            one_deselect_action: 'nullify'
          };
        }

        const response = await directusAPI('/relations', {
          method: 'POST',
          body: JSON.stringify(relationData)
        });

        return {
          content: [{
            type: 'text',
            text: `Relation created: ${collection}.${field} -> ${related_collection} (${relation_type})\n${JSON.stringify(response, null, 2)}`
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `Error creating relation: ${error.message}`
          }]
        };
      }
    }

    case 'list_schema_info': {
      try {
        // Get relations
        const relations = await directusAPI('/relations');

        // Get fields for specific collections
        const collections = ['products', 'categories', 'orders', 'customers', 'brands', 'order_items', 'products_categories'];
        const fieldsData = {};

        for (const collection of collections) {
          try {
            const fields = await directusAPI(`/fields/${collection}`);
            fieldsData[collection] = fields.data || [];
          } catch (error) {
            fieldsData[collection] = [];
          }
        }

        return {
          content: [{
            type: 'text',
            text: `Schema Information:\n\nRelations:\n${JSON.stringify(relations.data, null, 2)}\n\nFields by Collection:\n${JSON.stringify(fieldsData, null, 2)}`
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `Error getting schema info: ${error.message}`
          }]
        };
      }
    }

    case 'create_collection': {
      const { collection, meta = {} } = args;

      try {
        const response = await directusAPI('/collections', {
          method: 'POST',
          body: JSON.stringify({
            collection: collection,
            meta: {
              icon: 'folder',
              note: null,
              display_template: null,
              hidden: false,
              singleton: false,
              translations: null,
              archive_field: 'status',
              archive_app_filter: true,
              archive_value: 'archived',
              unarchive_value: 'draft',
              sort_field: 'sort',
              accountability: 'all',
              color: null,
              item_duplication_fields: null,
              sort: null,
              group: null,
              collapse: 'open',
              preview_url: null,
              versioning: false,
              ...meta
            }
          })
        });

        return {
          content: [{
            type: 'text',
            text: `Collection '${collection}' created successfully`
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `Error creating collection: ${error.message}`
          }]
        };
      }
    }

    case 'fix_products_categories_relation': {
      try {
        let results = [];

        // Step 1: Ensure products_categories junction table has proper structure
        try {
          await directusAPI('/fields/products_categories', {
            method: 'POST',
            body: JSON.stringify({
              field: 'products_id',
              type: 'integer',
              meta: {
                interface: 'select-dropdown-m2o',
                special: ['m2o'],
                required: true,
                hidden: false
              },
              schema: {
                is_nullable: false
              }
            })
          });
          results.push('✅ products_id field created in junction table');
        } catch (error) {
          results.push('ℹ️ products_id field already exists');
        }

        try {
          await directusAPI('/fields/products_categories', {
            method: 'POST',
            body: JSON.stringify({
              field: 'categories_id',
              type: 'integer',
              meta: {
                interface: 'select-dropdown-m2o',
                special: ['m2o'],
                required: true,
                hidden: false
              },
              schema: {
                is_nullable: false
              }
            })
          });
          results.push('✅ categories_id field created in junction table');
        } catch (error) {
          results.push('ℹ️ categories_id field already exists');
        }

        // Step 2: Create the fields in main collections FIRST
        try {
          await directusAPI('/fields/products', {
            method: 'POST',
            body: JSON.stringify({
              field: 'categories',
              type: 'alias',
              meta: {
                interface: 'list-m2m',
                special: ['m2m'],
                required: false,
                hidden: false
              }
            })
          });
          results.push('✅ categories field created in products collection');
        } catch (error) {
          results.push('ℹ️ categories field in products already exists');
        }

        try {
          await directusAPI('/fields/categories', {
            method: 'POST',
            body: JSON.stringify({
              field: 'products',
              type: 'alias',
              meta: {
                interface: 'list-m2m',
                special: ['m2m'],
                required: false,
                hidden: false
              }
            })
          });
          results.push('✅ products field created in categories collection');
        } catch (error) {
          results.push('ℹ️ products field in categories already exists');
        }

        // Step 3: Create the many-to-many relations
        try {
          await directusAPI('/relations', {
            method: 'POST',
            body: JSON.stringify({
              collection: 'products',
              field: 'categories',
              related_collection: 'categories',
              meta: {
                one_field: 'products',
                junction_field: 'categories_id',
                sort_field: null,
                one_deselect_action: 'delete'
              },
              schema: {
                table: 'products_categories',
                column: 'products_id',
                foreign_key_table: 'products',
                foreign_key_column: 'id',
                constraint_name: null,
                on_update: 'NO ACTION',
                on_delete: 'CASCADE'
              }
            })
          });
          results.push('✅ products.categories M2M relation created');
        } catch (error) {
          results.push('ℹ️ products.categories relation already exists');
        }

        try {
          await directusAPI('/relations', {
            method: 'POST',
            body: JSON.stringify({
              collection: 'categories',
              field: 'products',
              related_collection: 'products',
              meta: {
                one_field: 'categories',
                junction_field: 'products_id',
                sort_field: null,
                one_deselect_action: 'delete'
              },
              schema: {
                table: 'products_categories',
                column: 'categories_id',
                foreign_key_table: 'categories',
                foreign_key_column: 'id',
                constraint_name: null,
                on_update: 'NO ACTION',
                on_delete: 'CASCADE'
              }
            })
          });
          results.push('✅ categories.products M2M relation created');
        } catch (error) {
          results.push('ℹ️ categories.products relation already exists');
        }

        return {
          content: [{
            type: 'text',
            text: `Products-Categories M2M relationship fix completed:\n\n${results.join('\n')}`
          }]
        };

      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `Error fixing relation: ${error.message}`
          }]
        };
      }
    }

    default:
      throw new Error(`Unknown schema tool: ${toolName}`);
  }
}

// Helper function to get appropriate interface for field type
function getInterfaceForType(type) {
  const interfaceMap = {
    'integer': 'input',
    'string': 'input',
    'text': 'input-multiline',
    'boolean': 'boolean',
    'datetime': 'datetime',
    'date': 'date',
    'time': 'time',
    'json': 'input-code',
    'uuid': 'input',
    'decimal': 'input',
    'float': 'input'
  };
  return interfaceMap[type] || 'input';
}

// Excisaty tools handler
async function handleExcisatyTools(toolName, args) {
  switch (toolName) {
    case 'sync_excisaty_inventory': {
      const { supplier_id = 1, full_sync = false } = args;

      try {
        // Get all products from Excisaty API
        const inventoryData = await excisatyAPI('/inventory', {
          method: 'GET',
          headers: { 'X-Full-Sync': full_sync.toString() }
        });

        let updated = 0, added = 0, removed = 0;

        // Process each product
        for (const product of inventoryData.products || []) {
          // Skip products with 0 stock
          if (product.stock <= 0) {
            continue;
          }

          // Check if product exists in Directus
          const existingProducts = await directusAPI(`/items/products?filter[supplier_sku][_eq]=${product.sku}&limit=1`);

          if (existingProducts.data && existingProducts.data.length > 0) {
            // Update existing product
            const productId = existingProducts.data[0].id;
            await directusAPI(`/items/products/${productId}`, {
              method: 'PATCH',
              body: JSON.stringify({
                supplier_stock: product.stock,
                supplier_cost: product.wholesale_price,
                price_without_discount: product.retail_price,
                last_stock_sync: new Date().toISOString()
              })
            });
            updated++;
          } else {
            // Create new product
            await directusAPI('/items/products', {
              method: 'POST',
              body: JSON.stringify({
                name: product.name,
                supplier_id: supplier_id,
                supplier_sku: product.sku,
                supplier_stock: product.stock,
                supplier_cost: product.wholesale_price,
                price_without_discount: product.retail_price,
                description: product.description,
                images: product.images,
                weight: product.weight,
                status: 'published',
                last_stock_sync: new Date().toISOString()
              })
            });
            added++;
          }
        }

        return {
          content: [{
            type: 'text',
            text: `Excisaty inventory sync completed:\n- Updated: ${updated} products\n- Added: ${added} products\n- Removed: ${removed} products`
          }]
        };

      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `Sync failed: ${error.message}`
          }]
        };
      }
    }

    case 'get_excisaty_product': {
      const { sku } = args;

      try {
        const product = await excisatyAPI(`/products/${sku}`);

        return {
          content: [{
            type: 'text',
            text: `Product from Excisaty:\n\n${JSON.stringify(product, null, 2)}`
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `Error getting product: ${error.message}`
          }]
        };
      }
    }

    default:
      throw new Error(`Unknown Excisaty tool: ${toolName}`);
  }
}

// Tool definitions
const schemaManagementTools = [
  {
    name: 'create_collection',
    description: 'Create a new collection in Directus',
    inputSchema: {
      type: 'object',
      properties: {
        collection: { type: 'string', description: 'Collection name' },
        meta: { type: 'object', description: 'Collection metadata options' }
      },
      required: ['collection']
    }
  },
  {
    name: 'create_field',
    description: 'Create a new field in a collection',
    inputSchema: {
      type: 'object',
      properties: {
        collection: { type: 'string', description: 'Collection name' },
        field: { type: 'string', description: 'Field name' },
        type: {
          type: 'string',
          enum: ['integer', 'string', 'text', 'boolean', 'datetime', 'date', 'time', 'json', 'uuid', 'decimal', 'float'],
          description: 'Field type'
        },
        meta: { type: 'object', description: 'Field metadata options' }
      },
      required: ['collection', 'field', 'type']
    }
  },
  {
    name: 'delete_field',
    description: 'Delete a field from a collection',
    inputSchema: {
      type: 'object',
      properties: {
        collection: { type: 'string', description: 'Collection name' },
        field: { type: 'string', description: 'Field name to delete' }
      },
      required: ['collection', 'field']
    }
  },
  {
    name: 'create_relation',
    description: 'Create a relationship between collections',
    inputSchema: {
      type: 'object',
      properties: {
        collection: { type: 'string', description: 'Source collection name' },
        field: { type: 'string', description: 'Field name in source collection' },
        related_collection: { type: 'string', description: 'Target collection name' },
        relation_type: {
          type: 'string',
          enum: ['o2m', 'm2o', 'm2m'],
          description: 'Relationship type: o2m (one-to-many), m2o (many-to-one), m2m (many-to-many)'
        },
        junction_field: { type: 'string', description: 'Junction field for m2m relationships' }
      },
      required: ['collection', 'field', 'related_collection', 'relation_type']
    }
  },
  {
    name: 'list_schema_info',
    description: 'List current schema information including relations and fields',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'fix_products_categories_relation',
    description: 'Fix the products-categories many-to-many relationship',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  }
];

const excisatyTools = [
  {
    name: 'sync_excisaty_inventory',
    description: 'Sync product inventory from Excisaty API',
    inputSchema: {
      type: 'object',
      properties: {
        supplier_id: {
          type: 'number',
          description: 'Excisaty supplier ID',
          default: 1
        },
        full_sync: {
          type: 'boolean',
          description: 'Perform full sync or incremental',
          default: false
        }
      }
    }
  },
  {
    name: 'get_excisaty_product',
    description: 'Get product details from Excisaty by SKU',
    inputSchema: {
      type: 'object',
      properties: {
        sku: {
          type: 'string',
          description: 'Product SKU from Excisaty'
        }
      },
      required: ['sku']
    }
  }
];

// Create MCP server
const server = new Server(
  {
    name: 'directus-custom-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
      prompts: {},
    },
  }
);

// List available prompts
server.setRequestHandler(ListPromptsRequestSchema, async () => {
  const prompts = await getPrompts();

  return {
    prompts: prompts.map(prompt => {
      const systemVars = extractVariables(prompt.system_prompt);
      const messageVars = prompt.messages ? extractVariables(JSON.stringify(prompt.messages)) : [];
      const allVars = [...new Set([...systemVars, ...messageVars])];

      return {
        name: prompt.name,
        description: prompt.description || `AI prompt: ${prompt.name}`,
        arguments: allVars.map(variable => ({
          name: variable,
          description: `Value for ${variable}`,
          required: false,
        })),
      };
    }),
  };
});

// Get specific prompt
server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  const prompt = await getPromptByName(name);
  if (!prompt) {
    throw new Error(`Prompt not found: ${name}`);
  }

  let systemPrompt = prompt.system_prompt || '';
  let messages = [];

  // Parse messages if they exist
  if (prompt.messages) {
    try {
      const parsedMessages = typeof prompt.messages === 'string'
        ? JSON.parse(prompt.messages)
        : prompt.messages;

      if (Array.isArray(parsedMessages)) {
        messages = parsedMessages;
      }
    } catch (error) {
      console.error('Error parsing messages:', error);
    }
  }

  // Replace variables in system prompt and messages
  for (const [key, value] of Object.entries(args)) {
    const placeholder = `{{${key}}}`;
    systemPrompt = systemPrompt.replace(new RegExp(placeholder, 'g'), value);

    messages = messages.map(msg => ({
      ...msg,
      content: msg.content ? msg.content.replace(new RegExp(placeholder, 'g'), value) : msg.content,
      text: msg.text ? msg.text.replace(new RegExp(placeholder, 'g'), value) : msg.text,
    }));
  }

  return {
    description: prompt.description || `AI prompt: ${name}`,
    messages: [
      ...(systemPrompt ? [{ role: 'system', content: { type: 'text', text: systemPrompt } }] : []),
      ...messages.map(msg => ({
        role: msg.role || 'user',
        content: { type: 'text', text: msg.content || msg.text || '' }
      }))
    ]
  };
});

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'list_collections',
        description: 'List all available Directus collections',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'get_collection_items',
        description: 'Get items from a Directus collection',
        inputSchema: {
          type: 'object',
          properties: {
            collection: {
              type: 'string',
              description: 'Name of the collection to fetch from',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of items to return (default: 10)',
              default: 10,
            },
          },
          required: ['collection'],
        },
      },
      {
        name: 'get_products',
        description: 'Get products from your e-commerce store',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Maximum number of products to return (default: 10)',
              default: 10,
            },
          },
        },
      },
      {
        name: 'get_customers',
        description: 'Get customer information',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Maximum number of customers to return (default: 10)',
              default: 10,
            },
          },
        },
      },
      {
        name: 'get_orders',
        description: 'Get order information',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Maximum number of orders to return (default: 10)',
              default: 10,
            },
          },
        },
      },
      ...schemaManagementTools,
      ...excisatyTools,
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // Handle schema management tools
  if (['create_collection', 'create_field', 'delete_field', 'create_relation', 'list_schema_info', 'fix_products_categories_relation'].includes(name)) {
    return await handleSchemaTools(name, args);
  }

  // Handle Excisaty tools
  if (['sync_excisaty_inventory', 'get_excisaty_product'].includes(name)) {
    return await handleExcisatyTools(name, args);
  }

  switch (name) {
    case 'list_collections': {
      const collections = await getCollections();
      const nonSystemCollections = collections.filter(c => !c.collection.startsWith('directus_'));

      return {
        content: [
          {
            type: 'text',
            text: `Available collections:\n${nonSystemCollections.map(c => `• ${c.collection}: ${c.meta?.note || 'No description'}`).join('\n')}`,
          },
        ],
      };
    }

    case 'get_collection_items': {
      const { collection, limit = 10 } = args;
      const items = await getCollectionItems(collection, limit);

      return {
        content: [
          {
            type: 'text',
            text: `Items from ${collection} collection:\n\n${JSON.stringify(items, null, 2)}`,
          },
        ],
      };
    }

    case 'get_products': {
      const { limit = 10 } = args;
      const products = await getCollectionItems('products', limit);

      return {
        content: [
          {
            type: 'text',
            text: `Products (${products.length} items):\n\n${JSON.stringify(products, null, 2)}`,
          },
        ],
      };
    }

    case 'get_customers': {
      const { limit = 10 } = args;
      const customers = await getCollectionItems('customers', limit);

      return {
        content: [
          {
            type: 'text',
            text: `Customers (${customers.length} items):\n\n${JSON.stringify(customers, null, 2)}`,
          },
        ],
      };
    }

    case 'get_orders': {
      const { limit = 10 } = args;
      const orders = await getCollectionItems('orders', limit);

      return {
        content: [
          {
            type: 'text',
            text: `Orders (${orders.length} items):\n\n${JSON.stringify(orders, null, 2)}`,
          },
        ],
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

// Start the server
async function main() {
  console.error(`🌍 Environment check:`);
  console.error(`   DIRECTUS_URL: ${DIRECTUS_URL}`);
  console.error(`   DIRECTUS_TOKEN: ${DIRECTUS_TOKEN ? DIRECTUS_TOKEN.substring(0, 10) + '...' : 'MISSING'}`);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Directus Custom MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});