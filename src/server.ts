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
import { SERVER_NAME, SERVER_VERSION } from './version.js';
import { searchTools, type ToolDefinition } from './tools/tool-search.js';

export interface ServerDeps {
  directusClient: DirectusClient;
  collectionTools: CollectionTools;
  userTools: UserTools;
  fileTools: FileTools;
  flowTools: FlowTools;
  schemaTools: SchemaTools;
  diagnosticTools: DiagnosticTools;
}

// Configuration. Note: `websocket` is currently inert — DirectusWebSocketClient is
// exported from lib.ts for library consumers but is not wired into the MCP server.
export function loadConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DirectusConfig {
  return {
    url: env.DIRECTUS_URL || 'http://localhost:8065',
    token: env.DIRECTUS_TOKEN!,
    timeout: parseInt(env.DIRECTUS_TIMEOUT || '30000'),
    retries: parseInt(env.DIRECTUS_RETRIES || '3'),
    retryDelay: parseInt(env.DIRECTUS_RETRY_DELAY || '1000'),
    maxRetryDelay: parseInt(env.DIRECTUS_MAX_RETRY_DELAY || '10000'),
    websocket: false, // Not consumed by the MCP server; see note above.
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
    annotations: {
      title: "Directus - List Collections",
      readOnlyHint: true,
      openWorldHint: true
    },
    keywords: ["collections", "list", "tables", "browse", "discover"],
    description:
      'Lists every collection in the Directus instance with its metadata, so the data model can be discovered ' +
      'before anything is read or written. Start here when the collection name is unknown; use ' +
      'get_collection_schema for the fields of one collection and get_collection_items to read its rows. ' +
      'Folders (grouping elements with no table behind them) and inactive collections (Directus 12.4 refuses to ' +
      'read or write their contents) are flagged in the result. System collections are omitted unless ' +
      'include_system is true. Returns one entry per collection with its name, metadata and those flags.',
    inputSchema: {
      type: 'object',
      properties: {
        include_system: { type: 'boolean', description: 'Include system collections' }
      },
    },
  },
  {
    name: 'get_collection_schema',
    annotations: {
      title: "Directus - Collection Schema",
      readOnlyHint: true,
      openWorldHint: true
    },
    keywords: ["schema", "fields", "structure", "columns", "describe"],
    description:
      'Returns the field-level schema of one collection: field names, database types, interfaces, required and ' +
      'unique constraints, defaults and relation metadata. Use it before create_item or update_item to learn ' +
      'which fields exist and which are mandatory; use list_collections to find the collection name first, ' +
      'analyze_collection_schema when relationship mapping and constraint checks are also wanted. Read-only. ' +
      'Fails when the collection does not exist or the token cannot read it, and diagnose_collection_access ' +
      'tells those two apart.',
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
    annotations: {
      title: "Directus - Read Items",
      readOnlyHint: true,
      openWorldHint: true
    },
    keywords: ["items", "rows", "read", "query", "filter", "search", "list", "version"],
    description:
      'Reads items (rows) from one collection with Directus filtering, sorting, field selection, full-text ' +
      'search and pagination. This is the read path for content: use get_users, get_files or get_flows for ' +
      'those system collections, and get_collection_schema when the shape rather than the data is wanted. ' +
      'Returns at most 25 items unless limit says otherwise, so paginate with offset over large collections. ' +
      'Results are scoped to what the token may read, so a filter can legitimately return fewer rows than ' +
      'exist. On versioned collections, version reads one draft and version_raw returns the delta instead of ' +
      'the merged item. Since Directus 12.6.1 search also matches related fields through a many-to-many ' +
      'junction.',
    inputSchema: {
      type: 'object',
      properties: {
        collection: { type: 'string', description: 'Collection name' },
        limit: { type: 'number', description: 'Number of items to return (default: 25)' },
        offset: { type: 'number', description: 'Number of items to skip' },
        filter: { type: 'object', description: 'Filter conditions' },
        sort: { type: 'array', items: { type: 'string' }, description: 'Sort fields' },
        fields: { type: 'array', items: { type: 'string' }, description: 'Fields to return' },
        search: {
          type: 'string',
          description:
            'Full-text search across the collection\'s searchable fields. Since Directus 12.6.1 a search on a ' +
            'many-to-many junction also matches the related fields, and a numeric search no longer matches ' +
            'hidden ID fields such as the junction row ID.',
        },
        version: {
          type: 'string',
          description:
            "Content version to read from a versioned collection. Use 'published' for the published " +
            'version, or a version key for a draft.'
        },
        version_raw: {
          type: 'boolean',
          description: 'Return the raw version delta instead of the item merged with its version'
        },
      },
      required: ['collection'],
    },
  },
  {
    name: 'create_collection',
    annotations: {
      title: "Directus - Create Collection",
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true
    },
    keywords: ["collection", "create", "table", "new", "model"],
    description:
      'Creates a collection, either a real database table or a grouping folder. A table gets an auto-increment ' +
      'integer id when no fields are passed; folder: true makes a grouping element, which has no schema and can ' +
      'hold neither items nor fields. Use create_field to add fields afterwards, apply_schema to provision ' +
      'several collections from a snapshot. The table is created immediately and is not rolled back when a ' +
      'later field in the same call fails. A fresh collection can take a moment to become readable: ' +
      'validate_collection_creation confirms it, refresh_collection_cache clears a stale cache. Returns the ' +
      'created collection.',
    inputSchema: {
      type: 'object',
      properties: {
        collection: { type: 'string', description: 'Collection name' },
        meta: { type: 'object', description: 'Collection metadata' },
        fields: { type: 'array', description: 'Initial fields to create' },
        folder: {
          type: 'boolean',
          description:
            'Create a grouping folder instead of a table. A folder has no schema, so it cannot ' +
            'hold items and fields cannot be added to it. Default: false.'
        }
      },
      required: ['collection'],
    },
  },
  {
    name: 'delete_collection',
    annotations: {
      title: "Directus - Delete Collection",
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true
    },
    keywords: ["collection", "delete", "drop", "remove", "destroy"],
    description:
      'Drops a collection and every item in it, permanently. Requires confirm: true; without it nothing is ' +
      'deleted and the call reports what it would have done. Irreversible and not transactional: related items ' +
      'elsewhere may be left orphaned and a RESTRICT foreign key can make the drop fail halfway. Use ' +
      'delete_items to remove rows and keep the collection, delete_field to remove a single field. Take ' +
      'get_schema_snapshot first when the data model may need restoring.',
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
    annotations: {
      title: "Directus - Create Item",
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true
    },
    keywords: ["item", "row", "create", "insert", "add", "record"],
    description:
      'Inserts one item (row) into a collection and returns it, including the generated primary key. Use ' +
      'bulk_operations for many rows in one call, import_data for a CSV or JSON file, update_item to change a ' +
      'row that exists. Directus validates the payload, so a missing required field or a failed validation rule ' +
      'comes back as a tool error and nothing is written. Fields the token may not write are rejected rather ' +
      'than silently dropped. The payload may include relational fields, which Directus resolves against the ' +
      'related collection.',
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
    annotations: {
      title: "Directus - Update Item",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true
    },
    keywords: ["item", "row", "update", "edit", "patch", "modify", "version", "draft"],
    description:
      'Updates fields of one item by primary key and leaves fields absent from data untouched: a PATCH, not a ' +
      'replace. Use create_item for a new row, bulk_operations for many rows, delete_items to remove them. In ' +
      'versioned collections the published item is read-only, so pass version with a draft key to write into a ' +
      'draft; without it Directus refuses the write. Overwrites whatever the field held, so read it with ' +
      'get_collection_items first when the previous value matters. Returns the updated item.',
    inputSchema: {
      type: 'object',
      properties: {
        collection: { type: 'string', description: 'Collection name' },
        id: { type: ['string', 'number'], description: 'Item ID' },
        data: { type: 'object', description: 'Updated data' },
        version: {
          type: 'string',
          description:
            'Draft version key to write into. Published items in versioned collections cannot be ' +
            'edited directly.'
        }
      },
      required: ['collection', 'id', 'data'],
    },
  },
  {
    name: 'delete_items',
    annotations: {
      title: "Directus - Delete Items",
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true
    },
    keywords: ["items", "rows", "delete", "remove", "destroy", "bulk"],
    description:
      'Deletes items from a collection, by explicit ids or by a Directus query, permanently. Requires confirm: ' +
      'true, and passing neither ids nor query deletes nothing. ids and query are mutually exclusive. Since ' +
      'Directus 12.4 a query resolves its targets under the read permissions of the token: read access to the ' +
      'primary key is required and only readable items are deleted, so the deleted count can be lower than the ' +
      'matching count. Use { \"limit\": -1 } in query to deliberately target every item. cascadeDelete also ' +
      'removes related items and works only with ids. Use delete_collection to drop the whole collection ' +
      'instead.',
    inputSchema: {
      type: 'object',
      properties: {
        collection: { type: 'string', description: 'Collection name' },
        ids: { type: 'array', items: { type: ['string', 'number'] }, description: 'Explicit item IDs to delete' },
        query: {
          type: 'object',
          description:
            'Directus query selecting the items to delete, e.g. { "filter": { "status": { "_eq": "archived" } } }. ' +
            'Mutually exclusive with ids. Use { "limit": -1 } to deliberately target every item.'
        },
        confirm: { type: 'boolean', description: 'Confirm deletion' },
        cascadeDelete: { type: 'boolean', description: 'Delete related items (requires ids)' }
      },
      required: ['collection'],
    },
  },
  // Field Management
  {
    name: 'create_field',
    annotations: {
      title: "Directus - Create Field",
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true
    },
    keywords: ["field", "column", "create", "add", "schema"],
    description:
      'Adds a field to an existing collection: a database column plus its Directus interface metadata. Use ' +
      'create_relationship for relational fields, since this tool creates a plain column and no foreign key, ' +
      'and update_field for a field that already exists. The column is added immediately; on a non-empty table ' +
      'a required field without default_value can fail or leave existing rows invalid, so add it optional first ' +
      'and backfill. type is the Directus type (string, integer, boolean, dateTime, json, uuid and so on) while ' +
      'interface only affects how the admin app renders it. Returns the created field definition.',
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
    annotations: {
      title: "Directus - Update Field",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true
    },
    keywords: ["field", "column", "update", "edit", "alter", "schema"],
    description:
      'Changes an existing field, either its Directus metadata (interface, note, validation, options) or its ' +
      'database schema (type, required, unique, default_value). Metadata changes are safe; a type change ' +
      'rewrites the column and can fail or lose precision on existing data, and turning on required or unique ' +
      'fails on rows that already violate it. Idempotent: the same body applied twice leaves the same result. ' +
      'Use create_field to add a field, delete_field to remove one, and update_field with a hidden interface to ' +
      'retire a field without destroying data. Returns the updated field definition.',
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
    annotations: {
      title: "Directus - Delete Field",
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true
    },
    keywords: ["field", "column", "delete", "drop", "remove"],
    description:
      'Drops one field and its column from a collection, discarding the data in it permanently. Requires ' +
      'confirm: true. Relations pointing at the field can be left dangling, so check analyze_relationships ' +
      'first; use update_field to hide a field in the admin app instead of destroying it, delete_collection to ' +
      'drop the whole table. Not reversible, so take get_schema_snapshot beforehand when the model may need ' +
      'restoring.',
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
    annotations: {
      title: "Directus - Bulk Operations",
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true
    },
    keywords: ["bulk", "batch", "mass", "create", "update", "delete"],
    description:
      'Applies many writes to one collection in a single call: creates, updates and deletes together. Prefer it ' +
      'to repeated create_item or update_item calls when the row count is high; use import_data for a CSV or ' +
      'JSON file and delete_items when deleting by query rather than by id. Not a transaction: the phases run ' +
      'in order (create, update, delete) and a failure partway leaves earlier writes committed, so the result ' +
      'reports what succeeded per phase. validate: true checks the payload against the collection schema before ' +
      'anything is written. This tool writes data and has nothing to do with analyze_relationships, which only ' +
      'inspects the data model.',
    inputSchema: {
      type: 'object',
      properties: {
        collection: { type: 'string', description: 'Collection name' },
        operations: {
          type: 'object',
          description:
            'The writes to apply, grouped by phase. Phases run in order: create, then update, then ' +
            'delete. Omit a phase to skip it.',
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
    annotations: {
      title: "Directus - Analyze Schema",
      readOnlyHint: true,
      openWorldHint: true
    },
    keywords: ["analyze", "schema", "inspect", "relations", "audit"],
    description:
      'Inspects one collection and reports its fields with types and constraints, optionally mapped against its ' +
      'relationships and checked for schema problems. Use it when deciding how to query or extend a collection; ' +
      'get_collection_schema returns the raw field list alone, validate_collection_schema returns only the ' +
      'problems, analyze_relationships gives the cross-collection view. Read-only. includeRelations adds ' +
      'inbound and outbound relations and validateConstraints adds constraint findings; each costs extra ' +
      'requests against Directus, so leave them off for a quick look.',
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
    annotations: {
      title: "Directus - Analyze Relationships",
      readOnlyHint: true,
      openWorldHint: true
    },
    keywords: ["relationships", "relations", "foreign", "key", "graph", "analyze"],
    description:
      'Maps relationships across the instance: which collections point at which, through which fields, and of ' +
      'which type (o2o, o2m, m2o, m2m, m2a). Pass collection to narrow it to one collection and its neighbours, ' +
      'or omit it for the whole graph. Use it before create_relationship, before deleting a field or ' +
      'collection, or when a nested query returns an unexpected shape; analyze_collection_schema covers one ' +
      'collection in depth. Read-only, and it reads the data model only, never items. System collections are ' +
      'excluded unless includeSystemCollections is true.',
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
    annotations: {
      title: "Directus - Create Relationship",
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true
    },
    keywords: ["relationship", "relation", "o2m", "m2o", "m2m", "m2a", "link"],
    description:
      'Creates a relationship between collections together with the schema it needs: a m2o or o2o foreign key, ' +
      'an o2m reverse field, a m2m junction collection, or a m2a any-collection link. Use create_field for a ' +
      'plain non-relational column and analyze_relationships to see what already exists. Which parameters are ' +
      'required depends on type: m2m needs junction_collection and both junction fields, m2a needs ' +
      'allowed_collections and collection_field. Creates real tables and constraints and does not roll back ' +
      'when a later step fails, so a half-created m2m may need manual cleanup. on_delete and on_update set the ' +
      'referential actions, where CASCADE means deleting a parent deletes its children.',
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
    annotations: {
      title: "Directus - Validate Schema",
      readOnlyHint: true,
      openWorldHint: true
    },
    keywords: ["validate", "schema", "check", "lint", "constraints"],
    description:
      'Checks one collection for schema problems and returns the findings: missing primary key, one-sided or ' +
      'broken relations, a database type that disagrees with its interface, constraints the stored data ' +
      'violates. Read-only, and it reports rather than repairs. Use it after create_collection or apply_schema, ' +
      'or when writes fail for no obvious reason; use diagnose_collection_access when permissions rather than ' +
      'schema are the suspicion. strict: true also reports conventions and warnings instead of errors alone.',
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
    annotations: {
      title: "Directus - Diagnose Access",
      readOnlyHint: true,
      openWorldHint: true
    },
    keywords: ["diagnose", "access", "permissions", "troubleshoot", "debug"],
    description:
      'Explains why a collection cannot be read or written with the current token: whether it exists, whether ' +
      'it is active, whether the token holds item, field and relation permissions, and which of those is the ' +
      'blocker. Read-only and safe against production. Reach for it first when a tool returns an empty result ' +
      'or a forbidden error, before concluding the data is missing; validate_collection_schema covers a suspect ' +
      'schema and refresh_collection_cache a collection that was just created. Each include flag adds targeted ' +
      'probe requests against Directus.',
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
    annotations: {
      title: "Directus - Refresh Cache",
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true
    },
    keywords: ["cache", "refresh", "clear", "reload", "invalidate"],
    description:
      'Flushes the Directus server cache so recent schema changes become visible, then optionally verifies that ' +
      'one collection is readable. Use it after create_collection, create_field or apply_schema when a ' +
      'collection or field is reported as missing; validate_collection_creation answers the narrower question ' +
      'of whether a new collection is ready. Mutating but not destructive: it discards cached data, never ' +
      'stored data, though the next requests are slower while the cache refills. Needs a token allowed to flush ' +
      'the cache, and it affects every client of the instance, not just this session.',
    inputSchema: {
      type: 'object',
      properties: {
        collection: { type: 'string', description: 'Specific collection to verify after refresh' }
      },
    },
  },
  {
    name: 'validate_collection_creation',
    annotations: {
      title: "Directus - Validate Creation",
      readOnlyHint: true,
      openWorldHint: true
    },
    keywords: ["validate", "verify", "collection", "created", "check"],
    description:
      'Confirms that a newly created collection is usable: present in the schema, active, and readable with the ' +
      'current token, retrying once after waitTime milliseconds (default 2000) because Directus can lag a ' +
      'moment behind a create. Read-only. Use it right after create_collection and before writing items; ' +
      'refresh_collection_cache when it still reports the collection as missing, diagnose_collection_access for ' +
      'the full permission breakdown.',
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
    annotations: {
      title: "Directus - List Users",
      readOnlyHint: true,
      openWorldHint: true
    },
    keywords: ["users", "list", "accounts", "people", "directory"],
    description:
      'Lists Directus users (directus_users) with filtering, sorting, field selection, search and pagination. ' +
      'Use get_user to fetch one user when the id is known. Returns at most 25 users unless limit says ' +
      'otherwise. Results are scoped to the permissions of the token, so a token without access to ' +
      'directus_users gets an empty list rather than an error. Directus never returns password hashes or static ' +
      'tokens; pass fields to keep responses small.',
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
    annotations: {
      title: "Directus - Read User",
      readOnlyHint: true,
      openWorldHint: true
    },
    keywords: ["user", "account", "profile", "fetch", "lookup"],
    description:
      'Fetches one Directus user by id, with optional field selection. Use get_users to search or list when the ' +
      'id is unknown. Read-only. Fails when the id does not exist or the token cannot read directus_users. The ' +
      'password hash and static token are never returned. The shorthand id me is not resolved here, so pass the ' +
      'actual user id.',
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
    annotations: {
      title: "Directus - List Files",
      readOnlyHint: true,
      openWorldHint: true
    },
    keywords: ["files", "assets", "media", "uploads", "list"],
    description:
      'Lists files in the Directus file library (directus_files) with filtering, sorting, field selection, ' +
      'search and pagination, returning their metadata rather than their binary contents. Use import_data to ' +
      'load rows from a CSV or JSON file, and get_collection_items for files referenced from a content ' +
      'collection. Returns at most 25 files unless limit says otherwise. Each entry carries the file id, ' +
      'filename, type, size and storage location, which is what an asset URL is built from.',
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
    annotations: {
      title: "Directus - List Flows",
      readOnlyHint: true,
      openWorldHint: true
    },
    keywords: ["flows", "automation", "workflows", "list"],
    description:
      'Lists Directus automation flows with filtering, sorting, search and pagination. Use get_flow for one ' +
      'flow and its operations, get_operations for operations across flows, trigger_flow to run one. status ' +
      'narrows to active or inactive flows; folder (Directus 12.4+) narrows to one flow folder, where an empty ' +
      'string means root-level flows. Returns at most 25 flows unless limit says otherwise, and flow metadata ' +
      'only: operations are omitted unless get_flow asks for them.',
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
        folder: {
          type: 'string',
          description: 'Directus 12.4+: only flows in this folder (folder ID); pass "" for root-level flows'
        },
      },
    },
  },
  {
    name: 'get_flow',
    annotations: {
      title: "Directus - Read Flow",
      readOnlyHint: true,
      openWorldHint: true
    },
    keywords: ["flow", "automation", "workflow", "detail", "operations"],
    description:
      'Fetches one automation flow by id, optionally with its operations expanded so the whole pipeline can be ' +
      'read in a single call. Use get_flows to find the id and get_operations to list operations across several ' +
      'flows. Read-only: reading a flow never runs it, trigger_flow does that. include_operations costs an ' +
      'extra request and makes the response large on long flows.',
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
    annotations: {
      title: "Directus - Create Flow",
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true
    },
    keywords: ["flow", "automation", "workflow", "create", "trigger"],
    description:
      'Creates an automation flow and, optionally, its first operations in the same call. trigger selects what ' +
      'starts the flow (manual, schedule, event, webhook) and options carries the trigger-specific ' +
      'configuration, so a schedule flow needs its cron expression in options. A flow created with status ' +
      'active starts reacting immediately, events included, so create it inactive when that is not wanted. Each ' +
      'operations entry needs key, type and editor coordinates; operations are created but not chained, so wire ' +
      'the resolve and reject paths with update_flow or in the admin app. Use update_flow to change a flow and ' +
      'trigger_flow to run one.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Flow name' },
        status: { type: 'string', enum: ['active', 'inactive'], description: 'Flow status (default: active)' },
        trigger: { type: 'string', description: 'Trigger type (e.g., manual, schedule, event, webhook)' },
        description: { type: 'string', description: 'Flow description' },
        folder: { type: 'string', description: 'Directus 12.4+: flow folder ID to file the flow under (omit for root)' },
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
    annotations: {
      title: "Directus - Update Flow",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true
    },
    keywords: ["flow", "automation", "workflow", "update", "edit"],
    description:
      'Updates one flow by id: name, status, trigger, description or trigger options. Idempotent, and it ' +
      'replaces the keys present in data while leaving the rest alone. Switching status to active makes the ' +
      'flow start reacting to its trigger at once, and changing trigger or options can leave the flow ' +
      'inconsistent with operations built for the old trigger. Operations themselves are not edited here, so ' +
      'read them with get_flow or get_operations. This tool writes an automation and has nothing to do with ' +
      'analyze_relationships, which inspects the data model.',
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
    annotations: {
      title: "Directus - Delete Flow",
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true
    },
    keywords: ["flow", "automation", "workflow", "delete", "remove"],
    description:
      'Deletes a flow and all of its operations, permanently. Requires confirm: true. Whatever depended on the ' +
      'flow stops working, including a webhook URL that pointed at it, its schedule and any flow that triggered ' +
      'it, and the run history goes with it. Use update_flow with status inactive to switch a flow off and keep ' +
      'it. Not reversible.',
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
    annotations: {
      title: "Directus - Trigger Flow",
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true
    },
    keywords: ["flow", "trigger", "run", "execute", "webhook", "automation"],
    description:
      'Runs one flow now and returns whatever its last operation produced. The side effects are whatever the ' +
      'flow does, which can mean writing items, sending mail or calling external services, so treat it as ' +
      'destructive unless the flow is known to be read-only. Flows with a manual trigger accept this reliably; ' +
      'others may refuse it or ignore the payload. data becomes the trigger payload and must match what the ' +
      'flow expects. Read the flow with get_flow before running it.',
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
    annotations: {
      title: "Directus - List Operations",
      readOnlyHint: true,
      openWorldHint: true
    },
    keywords: ["operations", "flow", "steps", "automation", "list"],
    description:
      'Lists the operations (steps) that make up flows, optionally narrowed to one flow with flow_id. Use ' +
      'get_flow with include_operations for the whole pipeline of a single flow, and this tool to scan across ' +
      'flows, for example to find every step of a given type. Read-only: listing an operation never runs it. ' +
      'Returns at most 50 operations unless limit says otherwise, each with its key, type, editor position and ' +
      'options.',
    inputSchema: {
      type: 'object',
      properties: {
        flow_id: { type: 'string', description: 'Filter operations by flow ID' },
        limit: { type: 'number', description: 'Number of operations to return (default: 50)' },
      },
    },
  },
  // Schema snapshot / diff / apply (Directus 12.2+)
  {
    name: 'get_schema_snapshot',
    annotations: {
      title: "Directus - Schema Snapshot",
      readOnlyHint: true,
      openWorldHint: true
    },
    keywords: ["schema", "snapshot", "export", "data", "model", "backup", "migration"],
    description:
      'Exports the data model (collections, fields and relations, with no item data) as a snapshot object that ' +
      'diff_schema and apply_schema accept. Use it to back up the model before a destructive change, to move a ' +
      'model between environments, or to version it in git. Read-only. include_collections and ' +
      'exclude_collections are mutually exclusive and produce a partial snapshot, which on apply can read as a ' +
      'request to delete everything left out, so prefer a full snapshot for migrations.',
    inputSchema: {
      type: 'object',
      properties: {
        include_collections: {
          type: 'array',
          items: { type: 'string' },
          description: 'Restrict the snapshot to these collections. Mutually exclusive with exclude_collections.'
        },
        exclude_collections: {
          type: 'array',
          items: { type: 'string' },
          description: 'Exclude these collections. Mutually exclusive with include_collections.'
        },
      },
    },
  },
  {
    name: 'diff_schema',
    annotations: {
      title: "Directus - Schema Diff",
      readOnlyHint: true,
      openWorldHint: true
    },
    keywords: ["schema", "diff", "compare", "changes", "migration", "preview"],
    description:
      'Compares a snapshot against the live data model and reports the operations that applying it would ' +
      'perform. Read-only, nothing is modified, which makes it the safe way to preview a migration before ' +
      'apply_schema, the tool that consumes the { hash, diff } object returned here. mode mirror (default) ' +
      'includes deletions so the live model would end up matching the snapshot exactly; merge drops them for a ' +
      'strictly additive diff. force bypasses the Directus version and database vendor checks and risks ' +
      'producing a diff that cannot be applied. An empty diff means the model already matches.',
    inputSchema: {
      type: 'object',
      properties: {
        snapshot: { type: 'object', description: 'A snapshot as returned by get_schema_snapshot' },
        mode: {
          type: 'string',
          enum: ['merge', 'mirror'],
          description:
            "'mirror' (default) reports every operation including deletions; 'merge' excludes " +
            'deletions for an additive diff.'
        },
        force: { type: 'boolean', description: 'Bypass the Directus version and database vendor checks' },
      },
      required: ['snapshot'],
    },
  },
  {
    name: 'apply_schema',
    annotations: {
      title: "Directus - Apply Schema",
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true
    },
    keywords: ["schema", "apply", "migrate", "deploy", "sync", "data", "model"],
    description:
      'Applies a diff from diff_schema to the live data model, creating, altering and dropping collections and ' +
      'fields. Requires confirm: true. Destructive and not transactional: a mirror-mode diff drops whatever is ' +
      'missing from the snapshot, and a failure partway leaves the model half-migrated. The hash ties the diff ' +
      'to the model it was computed against and the call is refused when the model has moved since; force ' +
      'bypasses that check and can corrupt the model. Always run diff_schema first and keep a ' +
      'get_schema_snapshot backup.',
    inputSchema: {
      type: 'object',
      properties: {
        diff: { type: 'object', description: 'The { hash, diff } object returned by diff_schema' },
        force: { type: 'boolean', description: 'Bypass the hash and version safety check' },
        confirm: { type: 'boolean', description: 'Confirm application' },
      },
      required: ['diff'],
    },
  },
  // Data import (Directus 12.2+ multi-collection flat imports)
  {
    name: 'import_data',
    annotations: {
      title: "Directus - Import Data",
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true
    },
    keywords: ["import", "csv", "json", "upload", "seed", "bulk", "load", "migrate"],
    description:
      'Imports rows from a CSV or JSON file into one collection, or into several related collections at once ' +
      'from a flat multi-collection file. Use it when the data is in a file; bulk_operations takes payloads ' +
      'already in memory and create_item a single row. Subject to the Directus IMPORT_MAX_FILE_SIZE limit (50mb ' +
      'by default).\n\nSingle-collection: pass collection, and the file is a plain array of rows.\nBatch ' +
      '(Directus 12.2+): omit collection, and the file MUST be a JSON array of { \"collection\": string, ' +
      '\"items\": object[] } entries, ' +
      'e.g.\n[{\"collection\":\"authors\",\"items\":[{\"name\":\"Ann\"}]},{\"collection\":\"articles\",\"items\":[{\"title\":\"Hi\",\"author\":1}]}]\n\nWrites ' +
      'immediately and is not a transaction, so a failure partway leaves earlier rows imported. mode merge ' +
      'upserts instead of inserting, dry_run reports the changes without writing, and only ' +
      'dangerously_allow_delete together with confirm lets rows absent from the file be deleted.',
    inputSchema: {
      type: 'object',
      properties: {
        collection: {
          type: 'string',
          description:
            'Target collection. Omit for a multi-collection batch import, in which case the ' +
            'file must be an array of { collection, items } entries rather than a bare row array.'
        },
        file_path: { type: 'string', description: 'Path to a local .csv or .json file' },
        file_data: { type: 'string', description: 'Base64-encoded file contents (alternative to file_path)' },
        filename: {
          type: 'string',
          description: 'Filename for the upload; its extension selects the parser (.csv or .json)'
        },
        mode: {
          type: 'string',
          enum: ['add', 'merge'],
          description: "Batch import only. 'add' inserts, 'merge' upserts. Default: add."
        },
        dry_run: { type: 'boolean', description: 'Batch import only. Report the changes without writing.' },
        dangerously_allow_delete: {
          type: 'boolean',
          description: 'Batch import only. Permit deletion of rows absent from the file. Requires confirm.'
        },
        confirm: { type: 'boolean', description: 'Confirm a destructive import' },
      },
    },
  },
  // Tool discovery
  {
    name: 'search_tools',
    annotations: {
      title: "Directus - Search Tools",
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false
    },
    keywords: ["search", "find", "discover", "tools", "help", "capabilities"],
    description:
      'Finds the tools on this server that match a task description and returns their full definitions, so the ' +
      'right one can be called straight away. Use it first when unsure which tool fits, rather than guessing a ' +
      'name. Read-only and local: it searches the definitions this server already advertises, reaches Directus ' +
      'not at all, and so costs nothing against the instance. Matching runs over tool names, descriptions and ' +
      'keywords. Returns up to 10 tools unless limit says otherwise, best match first.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Free-text task description, e.g. "delete rows" or "change the data model"'
        },
        limit: { type: 'number', description: 'Maximum number of tools to return (default: 10)' },
      },
      required: ['query'],
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
      } else if (name === 'search_tools') {
        result = searchTools(TOOL_DEFINITIONS as ToolDefinition[], args as any);
      } else if (name === 'get_schema_snapshot') {
        result = await schemaTools.getSchemaSnapshot(args as any);
      } else if (name === 'diff_schema') {
        result = await schemaTools.diffSchema(args as any);
      } else if (name === 'apply_schema') {
        result = await schemaTools.applySchema(args as any);
      } else if (name === 'import_data') {
        result = await fileTools.importData(args as any);
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
      name: SERVER_NAME,
      version: SERVER_VERSION,
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
