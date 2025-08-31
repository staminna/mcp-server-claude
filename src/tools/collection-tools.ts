// Enhanced Collection Management Tools with Comprehensive Relationship Support

import { DirectusClient } from '../client/directus-client.js';
import { logger } from '../utils/logger.js';
import { 
  QueryOptions, 
  DirectusField, 
  DirectusRelation, 
  DirectusFieldType, 
  DirectusInterface,
  DirectusRelationConfig 
} from '../types/directus.js';

export class CollectionTools {
  constructor(private client: DirectusClient) {}

  async listCollections(args: { include_system?: boolean } = {}): Promise<any> {
    const operationId = `list_collections_${Date.now()}`;
    logger.startTimer(operationId);

    try {
      logger.toolStart('list_collections', args);

      const response = await this.client.getCollections();
      let collections = response.data || [];

      if (!args.include_system) {
        collections = collections.filter((c: any) => !c.collection.startsWith('directus_'));
      }

      const duration = logger.endTimer(operationId);
      logger.toolEnd('list_collections', duration, true, { count: collections.length });

      return {
        content: [{
          type: 'text',
          text: `Available collections (${collections.length}):\n\n${collections.map((c: any) => 
            `• **${c.collection}** - ${c.meta?.note || 'No description'}`
          ).join('\n')}`
        }]
      };
    } catch (error) {
      const duration = logger.endTimer(operationId);
      logger.toolError('list_collections', error as Error);
      
      return {
        content: [{
          type: 'text',
          text: `Error listing collections: ${(error as Error).message}`
        }]
      };
    }
  }

  async getCollectionSchema(args: { collection: string }): Promise<any> {
    const operationId = `get_collection_schema_${Date.now()}`;
    logger.startTimer(operationId);

    try {
      logger.toolStart('get_collection_schema', args);

      const [collectionResponse, fieldsResponse] = await Promise.all([
        this.client.getCollection(args.collection),
        this.client.getFields(args.collection)
      ]);

      const collection = collectionResponse.data;
      const fields = fieldsResponse.data || [];

      const schema = {
        collection: collection.collection,
        meta: collection.meta,
        schema: collection.schema,
        fields: fields.map((field: any) => ({
          field: field.field,
          type: field.type,
          required: field.meta?.required || false,
          readonly: field.meta?.readonly || false,
          interface: field.meta?.interface,
          note: field.meta?.note
        }))
      };

      const duration = logger.endTimer(operationId);
      logger.toolEnd('get_collection_schema', duration, true, { 
        collection: args.collection,
        fieldCount: fields.length 
      });

      return {
        content: [{
          type: 'text',
          text: `Schema for collection "${args.collection}":\n\n\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\``
        }]
      };
    } catch (error) {
      const duration = logger.endTimer(operationId);
      logger.toolError('get_collection_schema', error as Error, { collection: args.collection });
      
      return {
        content: [{
          type: 'text',
          text: `Error getting schema for collection "${args.collection}": ${(error as Error).message}`
        }]
      };
    }
  }

  async createCollection(args: { 
    collection: string; 
    meta?: Record<string, any>;
    fields?: Array<{
      field: string;
      type: string;
      meta?: Record<string, any>;
      schema?: Record<string, any>;
    }>;
  }): Promise<any> {
    const operationId = `create_collection_${Date.now()}`;
    logger.startTimer(operationId);

    try {
      logger.toolStart('create_collection', args);

      // Create collection
      await this.client.createCollection(args.collection, args.meta || {});

      // Create fields if provided
      if (args.fields && args.fields.length > 0) {
        for (const fieldData of args.fields) {
          await this.client.createField(args.collection, fieldData);
        }
      }

      const duration = logger.endTimer(operationId);
      logger.toolEnd('create_collection', duration, true, { 
        collection: args.collection,
        fieldCount: args.fields?.length || 0
      });

      return {
        content: [{
          type: 'text',
          text: `Collection "${args.collection}" created successfully${args.fields ? ` with ${args.fields.length} fields` : ''}.`
        }]
      };
    } catch (error) {
      const duration = logger.endTimer(operationId);
      logger.toolError('create_collection', error as Error, { collection: args.collection });
      
      return {
        content: [{
          type: 'text',
          text: `Error creating collection "${args.collection}": ${(error as Error).message}`
        }]
      };
    }
  }

  async deleteCollection(args: { collection: string; confirm?: boolean }): Promise<any> {
    const operationId = `delete_collection_${Date.now()}`;
    logger.startTimer(operationId);

    try {
      if (!args.confirm) {
        return {
          content: [{
            type: 'text',
            text: `⚠️ **Warning**: This will permanently delete the collection "${args.collection}" and all its data.\n\nTo proceed, call this tool again with \`confirm: true\`.`
          }]
        };
      }

      logger.toolStart('delete_collection', args);

      await this.client.deleteCollection(args.collection);

      const duration = logger.endTimer(operationId);
      logger.toolEnd('delete_collection', duration, true, { collection: args.collection });

      return {
        content: [{
          type: 'text',
          text: `Collection "${args.collection}" has been deleted successfully.`
        }]
      };
    } catch (error) {
      const duration = logger.endTimer(operationId);
      logger.toolError('delete_collection', error as Error, { collection: args.collection });
      
      return {
        content: [{
          type: 'text',
          text: `Error deleting collection "${args.collection}": ${(error as Error).message}`
        }]
      };
    }
  }

  async getCollectionItems(args: {
    collection: string;
    limit?: number;
    offset?: number;
    filter?: Record<string, any>;
    sort?: string[];
    fields?: string[];
    search?: string;
  }): Promise<any> {
    const operationId = `get_collection_items_${Date.now()}`;
    logger.startTimer(operationId);

    try {
      logger.toolStart('get_collection_items', args);

      const options: QueryOptions = {
        limit: args.limit || 25,
        offset: args.offset,
        ...(args.filter && { filter: args.filter }),
        ...(args.sort && { sort: args.sort }),
        ...(args.fields && { fields: args.fields }),
        ...(args.search && { search: args.search }),
        meta: ['total_count', 'filter_count']
      };

      const response = await this.client.getItems(args.collection, options);
      const items = response.data || [];
      const meta = response.meta;

      const duration = logger.endTimer(operationId);
      logger.toolEnd('get_collection_items', duration, true, { 
        collection: args.collection,
        count: items.length,
        total: meta?.total_count
      });

      return {
        content: [{
          type: 'text',
          text: `Items from "${args.collection}" (${items.length}${meta?.total_count ? ` of ${meta.total_count}` : ''}):\n\n\`\`\`json\n${JSON.stringify(items, null, 2)}\n\`\`\``
        }]
      };
    } catch (error) {
      const duration = logger.endTimer(operationId);
      logger.toolError('get_collection_items', error as Error, { collection: args.collection });
      
      return {
        content: [{
          type: 'text',
          text: `Error getting items from collection "${args.collection}": ${(error as Error).message}`
        }]
      };
    }
  }

  async createItem(args: {
    collection: string;
    data: Record<string, any>;
  }): Promise<any> {
    const operationId = `create_item_${Date.now()}`;
    logger.startTimer(operationId);

    try {
      logger.toolStart('create_item', args);

      const response = await this.client.createItem(args.collection, args.data);
      const item = response.data;

      const duration = logger.endTimer(operationId);
      logger.toolEnd('create_item', duration, true, { 
        collection: args.collection,
        itemId: item?.id
      });

      return {
        content: [{
          type: 'text',
          text: `Item created successfully in "${args.collection}":\n\n\`\`\`json\n${JSON.stringify(item, null, 2)}\n\`\`\``
        }]
      };
    } catch (error) {
      const duration = logger.endTimer(operationId);
      logger.toolError('create_item', error as Error, { collection: args.collection });
      
      return {
        content: [{
          type: 'text',
          text: `Error creating item in collection "${args.collection}": ${(error as Error).message}`
        }]
      };
    }
  }

  async updateItem(args: {
    collection: string;
    id: string | number;
    data: Record<string, any>;
  }): Promise<any> {
    const operationId = `update_item_${Date.now()}`;
    logger.startTimer(operationId);

    try {
      logger.toolStart('update_item', args);

      const response = await this.client.updateItem(args.collection, args.id, args.data);
      const item = response.data;

      const duration = logger.endTimer(operationId);
      logger.toolEnd('update_item', duration, true, { 
        collection: args.collection,
        itemId: args.id
      });

      return {
        content: [{
          type: 'text',
          text: `Item ${args.id} updated successfully in "${args.collection}":\n\n\`\`\`json\n${JSON.stringify(item, null, 2)}\n\`\`\``
        }]
      };
    } catch (error) {
      const duration = logger.endTimer(operationId);
      logger.toolError('update_item', error as Error, { 
        collection: args.collection,
        itemId: args.id
      });
      
      return {
        content: [{
          type: 'text',
          text: `Error updating item ${args.id} in collection "${args.collection}": ${(error as Error).message}`
        }]
      };
    }
  }

  async deleteItems(args: {
    collection: string;
    ids: (string | number)[];
    confirm?: boolean;
    cascadeDelete?: boolean;
  }): Promise<any> {
    const operationId = `delete_items_${Date.now()}`;
    logger.startTimer(operationId);

    try {
      if (!args.confirm) {
        // Check for related items that would be affected
        const relatedInfo = args.cascadeDelete ? await this.checkRelatedItems(args.collection, args.ids) : null;
        
        return {
          content: [{
            type: 'text',
            text: `⚠️ **Warning**: This will permanently delete ${args.ids.length} item(s) from collection "${args.collection}".\n\n` +
                  `Items to delete: ${args.ids.join(', ')}\n\n` +
                  (relatedInfo ? `**Related items that will be affected:**\n${relatedInfo}\n\n` : '') +
                  `To proceed, call this tool again with \`confirm: true\`.`
          }]
        };
      }

      logger.toolStart('delete_items', args);

      if (args.cascadeDelete) {
        await this.cascadeDeleteItems(args.collection, args.ids);
      } else {
        await this.client.deleteItems(args.collection, args.ids);
      }

      const duration = logger.endTimer(operationId);
      logger.toolEnd('delete_items', duration, true, { 
        collection: args.collection,
        count: args.ids.length,
        cascade: args.cascadeDelete
      });

      return {
        content: [{
          type: 'text',
          text: `Successfully deleted ${args.ids.length} item(s) from collection "${args.collection}"${args.cascadeDelete ? ' with cascade' : ''}.`
        }]
      };
    } catch (error) {
      const duration = logger.endTimer(operationId);
      logger.toolError('delete_items', error as Error, { 
        collection: args.collection,
        count: args.ids.length
      });
      
      return {
        content: [{
          type: 'text',
          text: `Error deleting items from collection "${args.collection}": ${(error as Error).message}`
        }]
      };
    }
  }

  async createField(args: {
    collection: string;
    field: string;
    type: DirectusFieldType;
    interface?: DirectusInterface;
    required?: boolean;
    unique?: boolean;
    default_value?: any;
    note?: string;
    validation?: Record<string, any>;
    options?: Record<string, any>;
  }): Promise<any> {
    const operationId = `create_field_${Date.now()}`;
    logger.startTimer(operationId);

    try {
      logger.toolStart('create_field', args);

      const fieldData = {
        field: args.field,
        type: args.type,
        meta: {
          interface: args.interface || this.getDefaultInterface(args.type),
          required: args.required || false,
          note: args.note,
          validation: args.validation,
          options: args.options
        },
        schema: {
          is_nullable: !args.required,
          is_unique: args.unique || false,
          default_value: args.default_value
        }
      };

      await this.client.createField(args.collection, fieldData);

      const duration = logger.endTimer(operationId);
      logger.toolEnd('create_field', duration, true, { 
        collection: args.collection,
        field: args.field,
        type: args.type
      });

      return {
        content: [{
          type: 'text',
          text: `✅ **Field Created**\n\n` +
                `- **Collection**: ${args.collection}\n` +
                `- **Field**: ${args.field}\n` +
                `- **Type**: ${args.type}\n` +
                `- **Interface**: ${args.interface || this.getDefaultInterface(args.type)}\n` +
                `- **Required**: ${args.required ? 'Yes' : 'No'}\n` +
                `- **Unique**: ${args.unique ? 'Yes' : 'No'}`
        }]
      };
    } catch (error) {
      const duration = logger.endTimer(operationId);
      logger.toolError('create_field', error as Error, { 
        collection: args.collection,
        field: args.field
      });
      
      return {
        content: [{
          type: 'text',
          text: `Error creating field "${args.field}" in collection "${args.collection}": ${(error as Error).message}`
        }]
      };
    }
  }

  async updateField(args: {
    collection: string;
    field: string;
    type?: DirectusFieldType;
    interface?: DirectusInterface;
    required?: boolean;
    unique?: boolean;
    default_value?: any;
    note?: string;
    validation?: Record<string, any>;
    options?: Record<string, any>;
  }): Promise<any> {
    const operationId = `update_field_${Date.now()}`;
    logger.startTimer(operationId);

    try {
      logger.toolStart('update_field', args);

      const updateData: any = {};
      
      if (args.type) updateData.type = args.type;
      
      if (args.interface || args.required !== undefined || args.note || args.validation || args.options) {
        updateData.meta = {};
        if (args.interface) updateData.meta.interface = args.interface;
        if (args.required !== undefined) updateData.meta.required = args.required;
        if (args.note) updateData.meta.note = args.note;
        if (args.validation) updateData.meta.validation = args.validation;
        if (args.options) updateData.meta.options = args.options;
      }

      if (args.required !== undefined || args.unique !== undefined || args.default_value !== undefined) {
        updateData.schema = {};
        if (args.required !== undefined) updateData.schema.is_nullable = !args.required;
        if (args.unique !== undefined) updateData.schema.is_unique = args.unique;
        if (args.default_value !== undefined) updateData.schema.default_value = args.default_value;
      }

      await this.client.updateField(args.collection, args.field, updateData);

      const duration = logger.endTimer(operationId);
      logger.toolEnd('update_field', duration, true, { 
        collection: args.collection,
        field: args.field
      });

      return {
        content: [{
          type: 'text',
          text: `✅ **Field Updated**\n\n` +
                `- **Collection**: ${args.collection}\n` +
                `- **Field**: ${args.field}\n` +
                `- **Changes**: ${Object.keys(args).filter(k => k !== 'collection' && k !== 'field').join(', ')}`
        }]
      };
    } catch (error) {
      const duration = logger.endTimer(operationId);
      logger.toolError('update_field', error as Error, { 
        collection: args.collection,
        field: args.field
      });
      
      return {
        content: [{
          type: 'text',
          text: `Error updating field "${args.field}" in collection "${args.collection}": ${(error as Error).message}`
        }]
      };
    }
  }

  async deleteField(args: {
    collection: string;
    field: string;
    confirm?: boolean;
  }): Promise<any> {
    const operationId = `delete_field_${Date.now()}`;
    logger.startTimer(operationId);

    try {
      if (!args.confirm) {
        // Check if field is used in relations
        const relations = await this.client.getRelations();
        const relatedRelations = relations.data?.filter((r: DirectusRelation) => 
          (r.collection === args.collection && r.field === args.field) ||
          (r.related_collection === args.collection && r.meta?.one_field === args.field)
        ) || [];

        return {
          content: [{
            type: 'text',
            text: `⚠️ **Warning**: This will permanently delete field "${args.field}" from collection "${args.collection}".\n\n` +
                  (relatedRelations.length > 0 ? 
                    `**This field is used in ${relatedRelations.length} relation(s):**\n${relatedRelations.map((r: DirectusRelation) => 
                      `- ${r.collection}.${r.field} → ${r.related_collection}`
                    ).join('\n')}\n\n` : '') +
                  `To proceed, call this tool again with \`confirm: true\`.`
          }]
        };
      }

      logger.toolStart('delete_field', args);

      await this.client.deleteField(args.collection, args.field);

      const duration = logger.endTimer(operationId);
      logger.toolEnd('delete_field', duration, true, { 
        collection: args.collection,
        field: args.field
      });

      return {
        content: [{
          type: 'text',
          text: `Field "${args.field}" has been deleted from collection "${args.collection}".`
        }]
      };
    } catch (error) {
      const duration = logger.endTimer(operationId);
      logger.toolError('delete_field', error as Error, { 
        collection: args.collection,
        field: args.field
      });
      
      return {
        content: [{
          type: 'text',
          text: `Error deleting field "${args.field}" from collection "${args.collection}": ${(error as Error).message}`
        }]
      };
    }
  }

  async bulkOperations(args: {
    collection: string;
    operations: {
      create?: Record<string, any>[];
      update?: Array<{ id: string | number } & Record<string, any>>;
      delete?: (string | number)[];
    };
    validate?: boolean;
  }): Promise<any> {
    const operationId = `bulk_operations_${Date.now()}`;
    logger.startTimer(operationId);

    try {
      logger.toolStart('bulk_operations', args);

      const results: any = {
        created: [],
        updated: [],
        deleted: [],
        errors: []
      };

      // Validate operations if requested
      if (args.validate) {
        const validation = await this.validateBulkOperations(args.collection, args.operations);
        if (!validation.isValid) {
          return {
            content: [{
              type: 'text',
              text: `❌ **Validation Failed**\n\n${validation.errors.join('\n')}`
            }]
          };
        }
      }

      // Execute create operations
      if (args.operations.create && args.operations.create.length > 0) {
        try {
          for (const item of args.operations.create) {
            const response = await this.client.createItem(args.collection, item);
            results.created.push(response.data);
          }
        } catch (error) {
          results.errors.push({ operation: 'create', error: (error as Error).message });
        }
      }

      // Execute update operations
      if (args.operations.update && args.operations.update.length > 0) {
        try {
          for (const item of args.operations.update) {
            const { id, ...data } = item;
            const response = await this.client.updateItem(args.collection, id, data);
            results.updated.push(response.data);
          }
        } catch (error) {
          results.errors.push({ operation: 'update', error: (error as Error).message });
        }
      }

      // Execute delete operations
      if (args.operations.delete && args.operations.delete.length > 0) {
        try {
          await this.client.deleteItems(args.collection, args.operations.delete);
          results.deleted = args.operations.delete;
        } catch (error) {
          results.errors.push({ operation: 'delete', error: (error as Error).message });
        }
      }

      const duration = logger.endTimer(operationId);
      logger.toolEnd('bulk_operations', duration, true, { 
        collection: args.collection,
        created: results.created.length,
        updated: results.updated.length,
        deleted: results.deleted.length,
        errors: results.errors.length
      });

      return {
        content: [{
          type: 'text',
          text: `✅ **Bulk Operations Completed**\n\n` +
                `- **Created**: ${results.created.length}\n` +
                `- **Updated**: ${results.updated.length}\n` +
                `- **Deleted**: ${results.deleted.length}\n` +
                `- **Errors**: ${results.errors.length}\n\n` +
                (results.errors.length > 0 ? 
                  `**Errors:**\n${results.errors.map((e: any) => `- ${e.operation}: ${e.error}`).join('\n')}\n\n` : '') +
                `\`\`\`json\n${JSON.stringify(results, null, 2)}\n\`\`\``
        }]
      };
    } catch (error) {
      const duration = logger.endTimer(operationId);
      logger.toolError('bulk_operations', error as Error, { collection: args.collection });
      
      return {
        content: [{
          type: 'text',
          text: `Error executing bulk operations on collection "${args.collection}": ${(error as Error).message}`
        }]
      };
    }
  }

  private async checkRelatedItems(collection: string, ids: (string | number)[]): Promise<string> {
    try {
      const relations = await this.client.getRelations();
      const relatedCollections = relations.data?.filter((r: DirectusRelation) => 
        r.related_collection === collection
      ) || [];

      const relatedInfo: string[] = [];
      
      for (const relation of relatedCollections) {
        for (const id of ids) {
          const filter = { [relation.field]: { _eq: id } };
          const response = await this.client.getItems(relation.collection, { 
            filter, 
            limit: 5,
            meta: ['total_count'] 
          });
          
          if (response.meta?.total_count && response.meta.total_count > 0) {
            relatedInfo.push(`- ${relation.collection}: ${response.meta.total_count} items`);
          }
        }
      }

      return relatedInfo.join('\n') || 'No related items found.';
    } catch (error) {
      return `Error checking related items: ${(error as Error).message}`;
    }
  }

  private async cascadeDeleteItems(collection: string, ids: (string | number)[]): Promise<void> {
    // Get all relations where this collection is referenced
    const relations = await this.client.getRelations();
    const relatedCollections = relations.data?.filter((r: DirectusRelation) => 
      r.related_collection === collection
    ) || [];

    // Delete related items first
    for (const relation of relatedCollections) {
      for (const id of ids) {
        const filter = { [relation.field]: { _eq: id } };
        const response = await this.client.getItems(relation.collection, { filter });
        const relatedIds = response.data?.map((item: any) => item.id) || [];
        
        if (relatedIds.length > 0) {
          await this.client.deleteItems(relation.collection, relatedIds);
        }
      }
    }

    // Finally delete the main items
    await this.client.deleteItems(collection, ids);
  }

  private async validateBulkOperations(
    collection: string, 
    operations: any
  ): Promise<{ isValid: boolean; errors: string[] }> {
    const errors: string[] = [];

    try {
      // Get collection schema
      const fields = await this.client.getFields(collection);
      const fieldMap = new Map(fields.data?.map((f: DirectusField) => [f.field, f]) || []);

      // Validate create operations
      if (operations.create) {
        for (let i = 0; i < operations.create.length; i++) {
          const item = operations.create[i];
          const requiredFields = Array.from(fieldMap.values())
            .filter(f => (f as DirectusField).meta?.required)
            .map(f => (f as DirectusField).field);
          
          for (const requiredField of requiredFields) {
            if (!(requiredField in item)) {
              errors.push(`Create operation ${i}: Missing required field "${requiredField}"`);
            }
          }
        }
      }

      // Validate update operations
      if (operations.update) {
        for (let i = 0; i < operations.update.length; i++) {
          const item = operations.update[i];
          if (!item.id) {
            errors.push(`Update operation ${i}: Missing required "id" field`);
          }
        }
      }

      return {
        isValid: errors.length === 0,
        errors
      };
    } catch (error) {
      return {
        isValid: false,
        errors: [`Validation error: ${(error as Error).message}`]
      };
    }
  }

  private getDefaultInterface(type: DirectusFieldType): DirectusInterface {
    const interfaceMap: Record<DirectusFieldType, DirectusInterface> = {
      'string': 'input',
      'text': 'textarea',
      'boolean': 'toggle',
      'integer': 'input',
      'bigInteger': 'input',
      'float': 'input',
      'decimal': 'input',
      'date': 'datetime',
      'time': 'datetime',
      'dateTime': 'datetime',
      'timestamp': 'datetime',
      'json': 'input-code',
      'csv': 'tags',
      'uuid': 'input',
      'hash': 'input',
      'geometry': 'map',
      'geometry.Point': 'map',
      'geometry.LineString': 'map',
      'geometry.Polygon': 'map',
      'geometry.MultiPoint': 'map',
      'geometry.MultiLineString': 'map',
      'geometry.MultiPolygon': 'map'
    };

    return interfaceMap[type] || 'input';
  }
}
