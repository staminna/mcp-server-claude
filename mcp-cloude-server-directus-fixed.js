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

// Import and setup fetch polyfill for older Node versions
import fetch from 'node-fetch';
if (!globalThis.fetch) {
  globalThis.fetch = fetch;
  globalThis.Headers = fetch.Headers;
  globalThis.Request = fetch.Request;
  globalThis.Response = fetch.Response;
}

// Configuration
const DIRECTUS_URL = process.env.DIRECTUS_URL || 'https://apidev.romanceinroom.com';
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN;

if (!DIRECTUS_TOKEN) {
  console.error('DIRECTUS_TOKEN environment variable is required');
  process.exit(1);
}

// Clean logging function (no emojis to avoid JSON parsing issues)
function log(message, data = null) {
  const timestamp = new Date().toISOString();
  if (data) {
    console.error(`[${timestamp}] ${message}`, data);
  } else {
    console.error(`[${timestamp}] ${message}`);
  }
}

// Directus API helper with clean logging
async function directusAPI(endpoint, options = {}) {
  const url = `${DIRECTUS_URL}${endpoint}`;
  log(`API Call: ${options.method || 'GET'} ${url}`);
  
  const config = {
    headers: {
      'Authorization': `Bearer ${DIRECTUS_TOKEN}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  };

  try {
    const response = await fetch(url, config);
    log(`Response: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      let errorDetails = '';
      try {
        const errorBody = await response.text();
        errorDetails = errorBody ? `: ${errorBody}` : '';
      } catch (e) {
        // Ignore error reading body
      }
      
      const error = new Error(`Directus API error: ${response.status} - ${response.statusText}${errorDetails}`);
      throw error;
    }

    const data = await response.json();
    
    // Log data info
    let dataLength;
    if (data.data && Array.isArray(data.data)) {
      dataLength = `${data.data.length} items`;
    } else if (data.data) {
      dataLength = 'single object';
    } else if (data && typeof data === 'object') {
      dataLength = `${Object.keys(data).length} properties`;
    } else {
      dataLength = 'no data';
    }
    log(`Data: ${dataLength}`);
    
    return data;
  } catch (error) {
    log(`Request failed: ${error.message}`);
    throw error;
  }
}

// Get all prompts from Directus
async function getPrompts() {
  try {
    const response = await directusAPI('/items/prompts?filter[status][_eq]=published');
    return response.data || [];
  } catch (error) {
    log('Error fetching prompts:', error.message);
    return [];
  }
}

// Get specific prompt by name
async function getPromptByName(name) {
  try {
    const response = await directusAPI(`/items/prompts?filter[name][_eq]=${encodeURIComponent(name)}&limit=1`);
    return response.data?.[0] || null;
  } catch (error) {
    log('Error fetching prompt:', error.message);
    return null;
  }
}

// Get collections from Directus
async function getCollections() {
  try {
    const response = await directusAPI('/collections');
    return response.data || [];
  } catch (error) {
    log('Error fetching collections:', error.message);
    return [];
  }
}

// Get items from a collection
async function getCollectionItems(collection, limit = 10) {
  try {
    const response = await directusAPI(`/items/${collection}?limit=${limit}`);
    return response.data || [];
  } catch (error) {
    log(`Error fetching ${collection} items:`, error.message);
    return [];
  }
}

// Create item in collection
async function createCollectionItem(collection, itemData) {
  try {
    log(`Creating item in collection: ${collection}`);
    
    const response = await directusAPI(`/items/${collection}`, {
      method: 'POST',
      body: JSON.stringify(itemData)
    });

    log(`Item created successfully in ${collection}`);
    return response.data;
  } catch (error) {
    log(`Failed to create item in ${collection}:`, error.message);
    throw error;
  }
}

// Batch create items in collection
async function createBatchItems(collection, itemsArray) {
  try {
    log(`Batch creating ${itemsArray.length} items in collection: ${collection}`);
    
    const response = await directusAPI(`/items/${collection}`, {
      method: 'POST',
      body: JSON.stringify(itemsArray)
    });

    log(`${itemsArray.length} items created successfully in ${collection}`);
    return response.data;
  } catch (error) {
    log(`Failed to batch create items in ${collection}:`, error.message);
    throw error;
  }
}

// Delete items from a collection
async function deleteCollectionItems(collection, itemIds = null) {
  try {
    if (!itemIds) {
      // Get all items first
      const allItems = await directusAPI(`/items/${collection}`);
      if (!allItems.data || allItems.data.length === 0) {
        return { deleted: 0, message: `Collection ${collection} is already empty` };
      }
      itemIds = allItems.data.map(item => item.id);
    }

    // Delete items
    let deleted = 0;
    const errors = [];
    
    for (const id of itemIds) {
      try {
        await directusAPI(`/items/${collection}/${id}`, { method: 'DELETE' });
        deleted++;
        log(`Deleted item ${id} from ${collection}`);
      } catch (error) {
        const errorMsg = `Failed to delete item ${id}: ${error.message}`;
        errors.push(errorMsg);
        log(errorMsg);
      }
    }

    return { 
      deleted, 
      errors: errors.length > 0 ? errors : null,
      message: `Deleted ${deleted} items from ${collection}${errors.length > 0 ? ` with ${errors.length} errors` : ''}`
    };
  } catch (error) {
    throw new Error(`Error deleting items from ${collection}: ${error.message}`);
  }
}

// Extract variables from prompt text (mustache-style)
function extractVariables(text) {
  if (!text) return [];
  const matches = text.match(/\{\{([^}]+)\}\}/g);
  if (!matches) return [];
  return [...new Set(matches.map(match => match.slice(2, -2).trim()))];
}

// Generic item creation handler
async function handleGenericItemCreation(collection, itemData, requiredFields = []) {
  try {
    // Validate required fields
    const missingFields = requiredFields.filter(field => !itemData[field]);
    if (missingFields.length > 0) {
      throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
    }

    // Add timestamps if not provided
    const timestamp = new Date().toISOString();
    const dataWithTimestamps = {
      ...itemData,
      date_created: itemData.date_created || timestamp,
      date_updated: timestamp
    };

    const result = await createCollectionItem(collection, dataWithTimestamps);

    return {
      content: [{
        type: 'text',
        text: `${collection.charAt(0).toUpperCase() + collection.slice(1)} item created successfully!\n\n${JSON.stringify(result, null, 2)}`
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: `Error creating ${collection} item: ${error.message}`
      }]
    };
  }
}

// Schema management tools handler
async function handleSchemaTools(toolName, args) {
  log(`Handling schema tool: ${toolName}`);
  
  switch (toolName) {
    case 'list_schema_info': {
      try {
        // Get relations
        const relations = await directusAPI('/relations');

        // Get collections
        const collections = await directusAPI('/collections');
        const userCollections = collections.data?.filter(c => !c.collection.startsWith('directus_')) || [];

        // Get fields for main collections
        const mainCollections = ['products', 'categories', 'orders', 'customers', 'brands', 'order_items'];
        const fieldsData = {};
        
        for (const collection of mainCollections) {
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
            text: `Schema Information:\n\nCollections: ${userCollections.length}\nRelations: ${relations.data?.length || 0}\n\nUser Collections:\n${JSON.stringify(userCollections.map(c => c.collection), null, 2)}\n\nRelations:\n${JSON.stringify(relations.data, null, 2)}\n\nFields by Collection:\n${JSON.stringify(fieldsData, null, 2)}`
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
        const collectionData = {
          collection: collection,
          meta: {
            icon: 'folder',
            note: meta.note || null,
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
        };

        const response = await directusAPI('/collections', {
          method: 'POST',
          body: JSON.stringify(collectionData)
        });

        return {
          content: [{
            type: 'text',
            text: `Collection '${collection}' created successfully\n\n${JSON.stringify(response, null, 2)}`
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

    case 'create_field': {
      const { collection, field, type = 'string', meta = {} } = args;

      try {
        const fieldData = {
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
        };

        const response = await directusAPI(`/fields/${collection}`, {
          method: 'POST',
          body: JSON.stringify(fieldData)
        });

        return {
          content: [{
            type: 'text',
            text: `Field '${field}' created successfully in collection '${collection}'\n\n${JSON.stringify(response, null, 2)}`
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

    case 'create_relation': {
      const { collection, field, related_collection, relation_type, junction_field } = args;

      try {
        let relationData = {
          collection: collection,
          field: field,
          related_collection: related_collection
        };

        if (relation_type === 'm2m' && junction_field) {
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
            text: `Relation created: ${collection}.${field} -> ${related_collection} (${relation_type})\n\n${JSON.stringify(response, null, 2)}`
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

// Data creation tools handler
async function handleDataCreationTools(toolName, args) {
  log(`Handling data creation tool: ${toolName}`);
  
  switch (toolName) {
    case 'create_item': {
      const { collection, data } = args;
      return await handleGenericItemCreation(collection, data);
    }

    case 'create_batch_items': {
      const { collection, items } = args;
      
      try {
        if (!Array.isArray(items) || items.length === 0) {
          throw new Error('Items must be a non-empty array');
        }

        const timestamp = new Date().toISOString();
        const itemsWithTimestamps = items.map(item => ({
          ...item,
          date_created: item.date_created || timestamp,
          date_updated: timestamp
        }));

        const result = await createBatchItems(collection, itemsWithTimestamps);

        return {
          content: [{
            type: 'text',
            text: `Batch created ${items.length} items in ${collection}!\n\n${JSON.stringify(result, null, 2)}`
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `Error batch creating items in ${collection}: ${error.message}`
          }]
        };
      }
    }

    case 'create_category': {
      const categoryData = {
        name: args.name,
        slug: args.slug || args.name.toLowerCase().replace(/\s+/g, '-'),
        description: args.description || '',
        status: args.status || 'published',
        sort: args.sort || null
      };

      return await handleGenericItemCreation('categories', categoryData, ['name']);
    }

    case 'create_product': {
      const productData = {
        name: args.name,
        slug: args.slug || args.name.toLowerCase().replace(/\s+/g, '-'),
        sku: args.sku,
        price: args.price,
        sale_price: args.sale_price || null,
        description: args.description || '',
        short_description: args.short_description || '',
        category: args.category || null,
        stock_quantity: args.stock_quantity || 0,
        weight: args.weight || null,
        status: args.status || 'published',
        featured: args.featured || false,
        tags: args.tags || []
      };

      return await handleGenericItemCreation('products', productData, ['name', 'sku', 'price']);
    }

    case 'create_customer': {
      const customerData = {
        email: args.email,
        first_name: args.first_name,
        last_name: args.last_name,
        phone: args.phone || null,
        date_of_birth: args.date_of_birth || null,
        gender: args.gender || null,
        billing_address: args.billing_address || null,
        shipping_address: args.shipping_address || null,
        status: args.status || 'active',
        notes: args.notes || ''
      };

      return await handleGenericItemCreation('customers', customerData, ['email', 'first_name', 'last_name']);
    }

    case 'create_order': {
      const orderData = {
        order_number: args.order_number || `ORD-${Date.now()}`,
        customer: args.customer,
        status: args.status || 'pending',
        payment_status: args.payment_status || 'pending',
        subtotal: args.subtotal,
        tax_amount: args.tax_amount || 0,
        shipping_amount: args.shipping_amount || 0,
        discount_amount: args.discount_amount || 0,
        total: args.total,
        currency: args.currency || 'USD',
        billing_address: args.billing_address || null,
        shipping_address: args.shipping_address || null,
        shipping_method: args.shipping_method || '',
        payment_method: args.payment_method || '',
        notes: args.notes || ''
      };

      return await handleGenericItemCreation('orders', orderData, ['customer', 'subtotal', 'total']);
    }

    case 'create_order_item': {
      const orderItemData = {
        order: args.order,
        product: args.product,
        quantity: args.quantity,
        unit_price: args.unit_price,
        total_price: args.total_price,
        product_snapshot: args.product_snapshot || null
      };

      try {
        const result = await createCollectionItem('order_items', orderItemData);
        return {
          content: [{
            type: 'text',
            text: `Order item created successfully!\n\n${JSON.stringify(result, null, 2)}`
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `Error creating order item: ${error.message}`
          }]
        };
      }
    }

    default:
      throw new Error(`Unknown data creation tool: ${toolName}`);
  }
}

// Create MCP server
const server = new Server(
  {
    name: 'directus-custom-mcp',
    version: '2.1.0',
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
      log('Error parsing messages:', error);
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
        name: 'delete_collection_items',
        description: 'Delete items from a Directus collection',
        inputSchema: {
          type: 'object',
          properties: {
            collection: {
              type: 'string',
              description: 'Name of the collection to delete from',
            },
            item_ids: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of item IDs to delete (if not provided, all items will be deleted)',
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
              description: 'Field type',
              default: 'string'
            }
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
        name: 'create_item',
        description: 'Create a new item in any Directus collection',
        inputSchema: {
          type: 'object',
          properties: {
            collection: { type: 'string', description: 'Collection name' },
            data: { type: 'object', description: 'Item data object' }
          },
          required: ['collection', 'data']
        }
      },
      {
        name: 'create_batch_items',
        description: 'Create multiple items in a collection at once',
        inputSchema: {
          type: 'object',
          properties: {
            collection: { type: 'string', description: 'Collection name' },
            items: { 
              type: 'array', 
              items: { type: 'object' },
              description: 'Array of item data objects' 
            }
          },
          required: ['collection', 'items']
        }
      },
      {
        name: 'create_category',
        description: 'Create a new product category',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Category name' },
            slug: { type: 'string', description: 'URL slug (auto-generated if not provided)' },
            description: { type: 'string', description: 'Category description' },
            status: { type: 'string', enum: ['published', 'draft', 'archived'], description: 'Category status' },
            sort: { type: 'number', description: 'Sort order' }
          },
          required: ['name']
        }
      },
      {
        name: 'create_product',
        description: 'Create a new product in the store',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Product name' },
            slug: { type: 'string', description: 'URL slug (auto-generated if not provided)' },
            sku: { type: 'string', description: 'Product SKU' },
            price: { type: 'number', description: 'Product price' },
            sale_price: { type: 'number', description: 'Sale price (optional)' },
            description: { type: 'string', description: 'Product description' },
            short_description: { type: 'string', description: 'Short description' },
            category: { type: 'number', description: 'Category ID' },
            stock_quantity: { type: 'number', description: 'Stock quantity' },
            weight: { type: 'number', description: 'Product weight' },
            status: { type: 'string', enum: ['published', 'draft', 'out_of_stock'], description: 'Product status' },
            featured: { type: 'boolean', description: 'Featured product' },
            tags: { type: 'array', items: { type: 'string' }, description: 'Product tags' }
          },
          required: ['name', 'sku', 'price']
        }
      },
      {
        name: 'create_customer',
        description: 'Create a new customer',
        inputSchema: {
          type: 'object',
          properties: {
            email: { type: 'string', description: 'Customer email' },
            first_name: { type: 'string', description: 'First name' },
            last_name: { type: 'string', description: 'Last name' },
            phone: { type: 'string', description: 'Phone number' },
            date_of_birth: { type: 'string', description: 'Date of birth (YYYY-MM-DD)' },
            gender: { type: 'string', enum: ['male', 'female', 'other', 'not_specified'], description: 'Gender' },
            billing_address: { type: 'object', description: 'Billing address object' },
            shipping_address: { type: 'object', description: 'Shipping address object' },
            status: { type: 'string', enum: ['active', 'inactive', 'banned'], description: 'Customer status' },
            notes: { type: 'string', description: 'Customer notes' }
          },
          required: ['email', 'first_name', 'last_name']
        }
      },
      {
        name: 'create_order',
        description: 'Create a new order',
        inputSchema: {
          type: 'object',
          properties: {
            order_number: { type: 'string', description: 'Order number (auto-generated if not provided)' },
            customer: { type: 'number', description: 'Customer ID' },
            status: { type: 'string', enum: ['pending', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'], description: 'Order status' },
            payment_status: { type: 'string', enum: ['pending', 'paid', 'failed', 'refunded'], description: 'Payment status' },
            subtotal: { type: 'number', description: 'Subtotal amount' },
            tax_amount: { type: 'number', description: 'Tax amount' },
            shipping_amount: { type: 'number', description: 'Shipping amount' },
            discount_amount: { type: 'number', description: 'Discount amount' },
            total: { type: 'number', description: 'Total amount' },
            currency: { type: 'string', description: 'Currency code' },
            billing_address: { type: 'object', description: 'Billing address object' },
            shipping_address: { type: 'object', description: 'Shipping address object' },
            shipping_method: { type: 'string', description: 'Shipping method' },
            payment_method: { type: 'string', description: 'Payment method' },
            notes: { type: 'string', description: 'Order notes' }
          },
          required: ['customer', 'subtotal', 'total']
        }
      },
      {
        name: 'create_order_item',
        description: 'Add an item to an order',
        inputSchema: {
          type: 'object',
          properties: {
            order: { type: 'number', description: 'Order ID' },
            product: { type: 'number', description: 'Product ID' },
            quantity: { type: 'number', description: 'Quantity' },
            unit_price: { type: 'number', description: 'Unit price' },
            total_price: { type: 'number', description: 'Total price' },
            product_snapshot: { type: 'object', description: 'Product details snapshot' }
          },
          required: ['order', 'product', 'quantity', 'unit_price', 'total_price']
        }
      }
    ],
  };
});

// Handle tool calls with enhanced error handling and logging
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  log(`Tool called: ${name}`);

  try {
    // Handle data creation tools
    if (['create_item', 'create_batch_items', 'create_product', 'create_category', 'create_customer', 'create_order', 'create_order_item'].includes(name)) {
      return await handleDataCreationTools(name, args);
    }

    // Handle schema management tools
    if (['create_collection', 'create_field', 'create_relation', 'list_schema_info'].includes(name)) {
      return await handleSchemaTools(name, args);
    }

    // Handle existing tools
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

      case 'delete_collection_items': {
        const { collection, item_ids } = args;
        const result = await deleteCollectionItems(collection, item_ids);

        return {
          content: [
            {
              type: 'text',
              text: result.message + (result.errors ? `\n\nErrors:\n${result.errors.join('\n')}` : ''),
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
  } catch (error) {
    log(`Tool execution failed:`, error.message);
    return {
      content: [
        {
          type: 'text',
          text: `Error executing tool '${name}': ${error.message}`,
        },
      ],
    };
  }
});

// Start the server with enhanced startup logging
async function main() {
  log('Starting Directus Custom MCP Server v2.1.0');
  log(`Node.js version: ${process.version}`);
  log(`Fetch available: ${typeof fetch !== 'undefined'}`);
  log(`DIRECTUS_URL: ${DIRECTUS_URL}`);
  log(`DIRECTUS_TOKEN: ${DIRECTUS_TOKEN ? 'Present' : 'MISSING'}`);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('Directus Custom MCP Server running on stdio');
}

main().catch((error) => {
  log('Fatal error:', error);
  process.exit(1);
});