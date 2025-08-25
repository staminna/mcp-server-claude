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

// Configuration
const DIRECTUS_URL = process.env.DIRECTUS_URL || 'https://apidev.romanceinroom.com';
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN;

if (!DIRECTUS_TOKEN) {
  console.error('DIRECTUS_TOKEN environment variable is required');
  process.exit(1);
}

// Directus API helper
async function directusAPI(endpoint, options = {}) {
  const url = `${DIRECTUS_URL}${endpoint}`;
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${DIRECTUS_TOKEN}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  if (!response.ok) {
    throw new Error(`Directus API error: ${response.status} - ${response.statusText}`);
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
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'list_collections': {
      const collections = await getCollections();
      // const nonSystemCollections = collections.filter(c => !c.collection.startsWith('directus_'));
      
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

// Add these tools to your existing MCP server

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

// Add to your ListToolsRequestSchema handler
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
          description: 'Product SKU from Excisaty',
          required: true
        }
      },
      required: ['sku']
    }
  },
  {
    name: 'create_dropship_order',
    description: 'Create dropshipping order with Excisaty',
    inputSchema: {
      type: 'object',
      properties: {
        order_id: {
          type: 'number',
          description: 'Internal order ID',
          required: true
        },
        customer_data: {
          type: 'object',
          description: 'Customer information for shipping'
        }
      },
      required: ['order_id']
    }
  },
  {
    name: 'check_order_status',
    description: 'Check status of dropship order with Excisaty',
    inputSchema: {
      type: 'object',
      properties: {
        supplier_order_number: {
          type: 'string',
          description: 'Excisaty order reference number',
          required: true
        }
      },
      required: ['supplier_order_number']
    }
  }
];

// Add to your CallToolRequestSchema handler
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
        for (const product of inventoryData.products) {
          // Skip products with 0 stock (as you mentioned)
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

        // Log the sync
        await directusAPI('/items/inventory_sync_log', {
          method: 'POST',
          body: JSON.stringify({
            supplier_id: supplier_id,
            sync_type: full_sync ? 'full' : 'incremental',
            products_updated: updated,
            products_added: added,
            products_removed: removed,
            sync_status: 'success',
            sync_date: new Date().toISOString()
          })
        });

        return {
          content: [{
            type: 'text',
            text: `Excisaty inventory sync completed:\n- Updated: ${updated} products\n- Added: ${added} products\n- Removed: ${removed} products`
          }]
        };

      } catch (error) {
        console.error('Sync error:', error);

        // Log failed sync
        await directusAPI('/items/inventory_sync_log', {
          method: 'POST',
          body: JSON.stringify({
            supplier_id: supplier_id,
            sync_type: full_sync ? 'full' : 'incremental',
            sync_status: 'failed',
            error_message: error.message,
            sync_date: new Date().toISOString()
          })
        });

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

    case 'create_dropship_order': {
      const { order_id, customer_data } = args;

      try {
        // Get order details from Directus
        const order = await directusAPI(`/items/orders/${order_id}?fields=*,order_items.*`);
        const orderData = order.data;

        // Prepare order for Excisaty
        const excisatyOrder = {
          order_reference: orderData.order_number,
          customer: {
            name: `${orderData.shipping_address?.name || customer_data?.name}`,
            email: customer_data?.email,
            phone: customer_data?.phone,
            address: orderData.shipping_address
          },
          items: orderData.order_items.map(item => ({
            sku: item.product_id, // You'll need to get supplier_sku
            quantity: item.quantity
          }))
        };

        // Send order to Excisaty
        const response = await excisatyAPI('/orders/dropship', {
          method: 'POST',
          body: JSON.stringify(excisatyOrder)
        });

        // Create supplier order record
        await directusAPI('/items/supplier_orders', {
          method: 'POST',
          body: JSON.stringify({
            order_id: order_id,
            supplier_id: 1, // Excisaty
            supplier_order_number: response.order_number,
            status: 'sent_to_supplier',
            total_cost: response.total_cost,
            api_response: response
          })
        });

        return {
          content: [{
            type: 'text',
            text: `Dropship order created successfully!\nExcisaty Order: ${response.order_number}\nStatus: ${response.status}`
          }]
        };

      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `Error creating dropship order: ${error.message}`
          }]
        };
      }
    }

    case 'check_order_status': {
      const { supplier_order_number } = args;

      try {
        const status = await excisatyAPI(`/orders/${supplier_order_number}/status`);

        // Update supplier order in Directus
        const supplierOrder = await directusAPI(`/items/supplier_orders?filter[supplier_order_number][_eq]=${supplier_order_number}&limit=1`);

        if (supplierOrder.data && supplierOrder.data.length > 0) {
          await directusAPI(`/items/supplier_orders/${supplierOrder.data[0].id}`, {
            method: 'PATCH',
            body: JSON.stringify({
              status: status.status.toLowerCase(),
              tracking_number: status.tracking_number,
              tracking_url: status.tracking_url,
              estimated_delivery: status.estimated_delivery
            })
          });
        }

        return {
          content: [{
            type: 'text',
            text: `Order Status for ${supplier_order_number}:\n\n${JSON.stringify(status, null, 2)}`
          }]
        };

      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `Error checking order status: ${error.message}`
          }]
        };
      }
    }
  }
}

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Directus Custom MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
