# Directus MCP Server

A robust Model Context Protocol (MCP) server for Directus, providing seamless integration between Claude AI and your Directus CMS. This custom implementation offers more features and better reliability than the official Directus MCP package.

## Features

### 📊 Data Access
- **Collection Management**: List and access all Directus collections
- **Item Retrieval**: Fetch items from any collection with customizable limits
- **Smart Filtering**: Built-in support for published content filtering
- **Type Safety**: Proper error handling and data validation

### 🛠️ Schema Management
- **Collection Creation**: Create new collections programmatically
- **Field Management**: Add/remove fields with proper type definitions
- **Relationship Builder**: Create complex many-to-many, one-to-many relationships
- **Schema Inspection**: View current database schema and relationships

### 🤖 AI Prompts Integration
- **Dynamic Prompts**: Store and manage AI prompts in Directus
- **Variable Substitution**: Mustache-style template variables (`{{variable}}`)
- **Prompt Library**: Organized prompt management for different AI workflows

### 🛒 E-commerce Features
- **Product Sync**: Integration with external inventory APIs (Excisaty example included)
- **Customer Management**: Access customer data and order information
- **Inventory Updates**: Automated stock synchronization

## Prerequisites

- **Node.js**: v18+ (v22+ recommended for native fetch support)
- **Directus**: v10+ instance with API access
- **Claude**: Access to Claude with MCP support (Claude Desktop, Cursor, etc.)

## Installation

### 1. Clone or Download

Save the MCP server code as `directus-mcp-server.js`:

```bash
# Create project directory
mkdir directus-mcp-server
cd directus-mcp-server

# Copy the server code (provided separately)
# Save as: directus-mcp-server.js
```

### 2. Install Dependencies

```bash
npm init -y
npm install @modelcontextprotocol/sdk dotenv
```

### 3. Environment Setup

Create a `.env` file in your project directory:

```env
DIRECTUS_URL=https://your-directus-instance.com
DIRECTUS_TOKEN=your-directus-api-token
```

**Important**: Generate a Directus API token with appropriate permissions:
- Read access to collections you want to query
- Admin access for schema management features
- Write access if using sync features

## Configuration

### For Claude Desktop

Edit your Claude Desktop configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "directus": {
      "command": "node",
      "args": ["/path/to/your/directus-mcp-server.js"],
      "env": {
        "DIRECTUS_URL": "https://your-directus-instance.com",
        "DIRECTUS_TOKEN": "your-api-token-here"
      }
    }
  }
}
```

### For Cursor IDE

Edit `.cursor/mcp.json` in your project:

```json
{
  "mcpServers": {
    "directus": {
      "command": "node", 
      "args": ["./directus-mcp-server.js"],
      "env": {
        "DIRECTUS_URL": "https://your-directus-instance.com",
        "DIRECTUS_TOKEN": "your-api-token-here"
      }
    }
  }
}
```

## Available Tools

### Data Access Tools

#### `list_collections`
Lists all available Directus collections (excluding system collections).

```
Example: "Show me all available collections"
```

#### `get_collection_items`
Retrieves items from a specific collection.

```
Parameters:
- collection: Collection name (required)
- limit: Number of items to return (default: 10)

Example: "Get the first 5 products from the products collection"
```

#### `get_products` / `get_customers` / `get_orders`
Specialized shortcuts for common e-commerce collections.

### Schema Management Tools

#### `create_collection`
Creates a new collection with metadata options.

```
Parameters:
- collection: Collection name (required)
- meta: Metadata options (optional)

Example: "Create a new collection called 'testimonials'"
```

#### `create_field` 
Adds a new field to an existing collection.

```
Parameters:
- collection: Target collection (required)
- field: Field name (required) 
- type: Field type (required) - string, integer, text, boolean, datetime, etc.
- meta: Field options (optional)

Example: "Add a 'featured' boolean field to the products collection"
```

#### `create_relation`
Creates relationships between collections.

```
Parameters:
- collection: Source collection (required)
- field: Field name (required)
- related_collection: Target collection (required)
- relation_type: o2m, m2o, or m2m (required)
- junction_field: For m2m relationships (conditional)

Example: "Create a many-to-many relationship between products and categories"
```

### AI Prompts System

The server includes a built-in prompts system for managing AI workflows:

#### Requirements
Create a `prompts` collection in Directus with these fields:
- `name` (string): Unique prompt identifier
- `description` (text): Prompt description
- `system_prompt` (text): System-level prompt content
- `messages` (JSON): Conversation messages array
- `status` (string): published/draft status

#### Usage
```
"List available AI prompts"
"Use the 'product-description' prompt with product_name='Wireless Headphones'"
```

## Troubleshooting

### Common Issues

#### "fetch is not defined" Error
- **Cause**: Node.js version < 18
- **Solution**: Upgrade to Node.js v18+ or add fetch polyfill:
  ```javascript
  import fetch from 'node-fetch';
  globalThis.fetch = fetch;
  ```

#### Empty Results Despite Having Data
- **Cause**: API token permissions
- **Solution**: Ensure your Directus API token has read permissions for the collections
- **Check**: Test API access directly: `curl -H "Authorization: Bearer YOUR_TOKEN" https://your-directus.com/items/your-collection`

#### Connection Not Working
- **Cause**: Configuration file issues
- **Solution**: 
  1. Restart Claude Desktop/Cursor after config changes
  2. Verify file paths are absolute
  3. Check environment variables are set correctly

#### Schema Operations Failing
- **Cause**: Insufficient permissions
- **Solution**: Use an admin-level API token for schema management operations

### Debug Mode

Add debug logging to the `directusAPI` function:

```javascript
async function directusAPI(endpoint, options = {}) {
  const url = `${DIRECTUS_URL}${endpoint}`;
  console.error(`🔍 API Call: ${url}`);
  console.error(`🔑 Token present: ${DIRECTUS_TOKEN ? 'YES' : 'NO'}`);
  
  // ... rest of function
  
  console.error(`📡 Response: ${response.status} ${response.statusText}`);
  console.error(`📊 Data items: ${data.data ? data.data.length : 'no data array'}`);
}
```

## Example Workflows

### Content Management
```
"List all blog posts from the posts collection"
"Create a new 'testimonials' collection with name, content, and author fields"
"Show me the database schema for products and categories"
```

### E-commerce Operations  
```
"Get the latest 10 customer orders"
"Create a relationship between products and categories"
"Sync product inventory from external API"
```

### AI Prompt Management
```
"Show me all available AI prompts"
"Use the product-description prompt with product_name='Gaming Mouse'"
"Create a new prompt for customer service responses"
```

## Extending the Server

### Adding New APIs
The server includes an example Excisaty API integration. Follow the same pattern:

```javascript
// Add API helper
async function yourAPI(endpoint, options = {}) {
  const API_URL = process.env.YOUR_API_URL;
  const API_KEY = process.env.YOUR_API_KEY;
  
  // Implementation
}

// Add tool handlers
async function handleYourTools(toolName, args) {
  switch (toolName) {
    case 'your_tool':
      // Implementation
      break;
  }
}

// Register tools in ListToolsRequestSchema handler
```

### Custom Collection Types
Override the default collection filtering by modifying the `getCollections()` function to include/exclude specific collections.

## Contributing

This MCP server was developed to address limitations in the official Directus MCP package. Contributions are welcome:

1. **Bug Reports**: Issues with specific Directus versions or configurations
2. **Feature Requests**: Additional Directus API endpoints or tools
3. **Extensions**: Integration with other headless CMS or e-commerce platforms
4. **Documentation**: Improvements to setup guides or troubleshooting

## License

MIT License - feel free to modify and distribute for your projects.

## Support

For support:
1. Check the troubleshooting section above
2. Verify your Directus API token permissions
3. Test API connectivity outside of MCP first
4. Enable debug logging to trace issues

---

**Built for the Directus community** 🚀

This custom MCP server provides a more reliable and feature-rich alternative to the official package, with better error handling, more tools, and extensible architecture for your specific needs.