// Enhanced Schema Management Tools with Comprehensive Relationship Support

import { DirectusClient } from '../client/directus-client.js';
import { logger } from '../utils/logger.js';
import { 
  DirectusField, 
  DirectusRelation, 
  DirectusCollection,
  DirectusRelationConfig,
  DirectusFieldType,
  DirectusInterface,
  OneToManyRelation,
  ManyToOneRelation,
  ManyToManyRelation,
  OneToOneRelation,
  ManyToAnyRelation
} from '../types/directus.js';

export interface CollectionSchema {
  collection: DirectusCollection;
  fields: DirectusField[];
  relations: DirectusRelation[];
  relationshipMap: RelationshipMap;
  validation: SchemaValidation;
}

export interface RelationshipMap {
  oneToMany: OneToManyRelation[];
  manyToOne: ManyToOneRelation[];
  manyToMany: ManyToManyRelation[];
  oneToOne: OneToOneRelation[];
  manyToAny: ManyToAnyRelation[];
}

export interface SchemaValidation {
  isValid: boolean;
  errors: SchemaError[];
  warnings: SchemaWarning[];
}

export interface SchemaError {
  type: 'missing_field' | 'invalid_relation' | 'circular_dependency' | 'constraint_violation' | 'type_mismatch';
  message: string;
  collection?: string;
  field?: string;
  relation?: string;
  severity: 'error' | 'warning';
}

export interface SchemaWarning extends SchemaError {
  severity: 'warning';
}

export interface RelationshipAnalysis {
  collection: string;
  totalRelations: number;
  incomingRelations: DirectusRelation[];
  outgoingRelations: DirectusRelation[];
  circularDependencies: string[];
  orphanedFields: string[];
  missingConstraints: string[];
}

export class SchemaTools {
  constructor(private client: DirectusClient) {}

  async analyzeCollectionSchema(args: { 
    collection: string;
    includeRelations?: boolean;
    validateConstraints?: boolean;
  }): Promise<any> {
    const operationId = `analyze_collection_schema_${Date.now()}`;
    logger.startTimer(operationId);

    try {
      logger.toolStart('analyze_collection_schema', args);

      const [collectionData, fieldsData, relationsData] = await Promise.all([
        this.client.getCollection(args.collection),
        this.client.getFields(args.collection),
        args.includeRelations ? this.client.getRelations() : Promise.resolve({ data: [] })
      ]);

      const collection = collectionData.data;
      const fields = fieldsData.data || [];
      const allRelations = relationsData.data || [];
      
      // Filter relations for this collection
      const relations = allRelations.filter((r: DirectusRelation) => 
        r.collection === args.collection || r.related_collection === args.collection
      );

      // Build relationship map
      const relationshipMap = this.buildRelationshipMap(relations, args.collection);
      
      // Validate schema
      const validation = await this.validateSchema(collection, fields, relations, args.validateConstraints);

      const schema: CollectionSchema = {
        collection,
        fields,
        relations,
        relationshipMap,
        validation
      };

      const duration = logger.endTimer(operationId);
      logger.toolEnd('analyze_collection_schema', duration, true, { 
        collection: args.collection,
        fieldCount: fields.length,
        relationCount: relations.length,
        isValid: validation.isValid
      });

      return {
        content: [{
          type: 'text',
          text: `# Schema Analysis for "${args.collection}"\n\n` +
                `## Collection Info\n` +
                `- **Name**: ${collection.collection}\n` +
                `- **Fields**: ${fields.length}\n` +
                `- **Relations**: ${relations.length}\n` +
                `- **Valid**: ${validation.isValid ? '✅' : '❌'}\n\n` +
                `## Fields\n${this.formatFields(fields)}\n\n` +
                `## Relationships\n${this.formatRelationshipMap(relationshipMap)}\n\n` +
                `## Validation\n${this.formatValidation(validation)}\n\n` +
                `\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\``
        }]
      };
    } catch (error) {
      const duration = logger.endTimer(operationId);
      logger.toolError('analyze_collection_schema', error as Error, { collection: args.collection });
      
      return {
        content: [{
          type: 'text',
          text: `Error analyzing schema for collection "${args.collection}": ${(error as Error).message}`
        }]
      };
    }
  }

  async analyzeRelationships(args: { 
    collection?: string;
    includeSystemCollections?: boolean;
  }): Promise<any> {
    const operationId = `analyze_relationships_${Date.now()}`;
    logger.startTimer(operationId);

    try {
      logger.toolStart('analyze_relationships', args);

      const [collectionsData, relationsData] = await Promise.all([
        this.client.getCollections(),
        this.client.getRelations()
      ]);

      let collections = collectionsData.data || [];
      const relations = relationsData.data || [];

      if (!args.includeSystemCollections) {
        collections = collections.filter((c: any) => !c.collection.startsWith('directus_'));
      }

      if (args.collection) {
        collections = collections.filter((c: any) => c.collection === args.collection);
      }

      const analyses: RelationshipAnalysis[] = [];
      
      for (const collection of collections) {
        const analysis = await this.analyzeCollectionRelationships(collection.collection, relations);
        analyses.push(analysis);
      }

      const duration = logger.endTimer(operationId);
      logger.toolEnd('analyze_relationships', duration, true, { 
        collectionCount: collections.length,
        totalRelations: relations.length
      });

      return {
        content: [{
          type: 'text',
          text: `# Relationship Analysis\n\n` +
                `${analyses.map(a => this.formatRelationshipAnalysis(a)).join('\n\n')}\n\n` +
                `\`\`\`json\n${JSON.stringify(analyses, null, 2)}\n\`\`\``
        }]
      };
    } catch (error) {
      const duration = logger.endTimer(operationId);
      logger.toolError('analyze_relationships', error as Error);
      
      return {
        content: [{
          type: 'text',
          text: `Error analyzing relationships: ${(error as Error).message}`
        }]
      };
    }
  }

  async createRelationship(args: DirectusRelationConfig): Promise<any> {
    const operationId = `create_relationship_${Date.now()}`;
    logger.startTimer(operationId);

    try {
      logger.toolStart('create_relationship', args);

      let result: any;

      switch (args.type) {
        case 'o2m':
          result = await this.createOneToManyRelation(args);
          break;
        case 'm2o':
          result = await this.createManyToOneRelation(args);
          break;
        case 'm2m':
          result = await this.createManyToManyRelation(args);
          break;
        case 'o2o':
          result = await this.createOneToOneRelation(args);
          break;
        case 'm2a':
          result = await this.createManyToAnyRelation(args);
          break;
        default:
          throw new Error(`Unsupported relationship type: ${(args as any).type}`);
      }

      const duration = logger.endTimer(operationId);
      logger.toolEnd('create_relationship', duration, true, { 
        type: args.type,
        collection: args.collection
      });

      return {
        content: [{
          type: 'text',
          text: `✅ **${args.type.toUpperCase()} Relationship Created**\n\n` +
                `- **Collection**: ${args.collection}\n` +
                `- **Field**: ${args.field}\n` +
                `- **Related Collection**: ${'related_collection' in args ? args.related_collection : 'N/A'}\n\n` +
                `${result.details || ''}`
        }]
      };
    } catch (error) {
      const duration = logger.endTimer(operationId);
      logger.toolError('create_relationship', error as Error, { type: args.type });
      
      return {
        content: [{
          type: 'text',
          text: `Error creating ${args.type} relationship: ${(error as Error).message}`
        }]
      };
    }
  }

  async validateCollectionSchema(args: { 
    collection: string;
    strict?: boolean;
  }): Promise<any> {
    const operationId = `validate_collection_schema_${Date.now()}`;
    logger.startTimer(operationId);

    try {
      logger.toolStart('validate_collection_schema', args);

      const [collectionData, fieldsData, relationsData] = await Promise.all([
        this.client.getCollection(args.collection),
        this.client.getFields(args.collection),
        this.client.getRelations()
      ]);

      const collection = collectionData.data;
      const fields = fieldsData.data || [];
      const allRelations = relationsData.data || [];
      
      const relations = allRelations.filter((r: DirectusRelation) => 
        r.collection === args.collection || r.related_collection === args.collection
      );

      const validation = await this.validateSchema(collection, fields, relations, args.strict);

      const duration = logger.endTimer(operationId);
      logger.toolEnd('validate_collection_schema', duration, true, { 
        collection: args.collection,
        isValid: validation.isValid,
        errorCount: validation.errors.length
      });

      return {
        content: [{
          type: 'text',
          text: `# Schema Validation for "${args.collection}"\n\n` +
                `**Status**: ${validation.isValid ? '✅ Valid' : '❌ Invalid'}\n\n` +
                `**Errors**: ${validation.errors.length}\n` +
                `**Warnings**: ${validation.warnings.length}\n\n` +
                `${this.formatValidation(validation)}`
        }]
      };
    } catch (error) {
      const duration = logger.endTimer(operationId);
      logger.toolError('validate_collection_schema', error as Error, { collection: args.collection });
      
      return {
        content: [{
          type: 'text',
          text: `Error validating schema for collection "${args.collection}": ${(error as Error).message}`
        }]
      };
    }
  }

  private buildRelationshipMap(relations: DirectusRelation[], collection: string): RelationshipMap {
    const map: RelationshipMap = {
      oneToMany: [],
      manyToOne: [],
      manyToMany: [],
      oneToOne: [],
      manyToAny: []
    };

    for (const relation of relations) {
      if (!relation.meta) continue;

      // Determine relationship type based on Directus relation structure
      if (relation.meta.junction_field) {
        // Many-to-Many
        map.manyToMany.push({
          type: 'm2m',
          collection: relation.meta.many_collection,
          field: relation.meta.many_field,
          related_collection: relation.meta.one_collection || '',
          junction_collection: relation.collection,
          junction_field: relation.meta.junction_field,
          related_junction_field: relation.meta.one_field || '',
          sort_field: relation.meta.sort_field
        });
      } else if (relation.meta.one_allowed_collections && relation.meta.one_allowed_collections.length > 1) {
        // Many-to-Any
        map.manyToAny.push({
          type: 'm2a',
          collection: relation.meta.many_collection,
          field: relation.meta.many_field,
          allowed_collections: relation.meta.one_allowed_collections,
          collection_field: relation.meta.one_collection_field || '',
          primary_key_field: relation.meta.one_field || 'id'
        });
      } else if (relation.collection === collection) {
        // Many-to-One (this collection has foreign key)
        map.manyToOne.push({
          type: 'm2o',
          collection: relation.collection,
          field: relation.field,
          related_collection: relation.related_collection || '',
          related_field: relation.meta.one_field
        });
      } else if (relation.related_collection === collection) {
        // One-to-Many (this collection is referenced)
        map.oneToMany.push({
          type: 'o2m',
          collection: relation.related_collection,
          field: relation.meta.one_field || '',
          related_collection: relation.collection,
          related_field: relation.field,
          sort_field: relation.meta.sort_field
        });
      }
    }

    return map;
  }

  private async validateSchema(
    collection: DirectusCollection, 
    fields: DirectusField[], 
    relations: DirectusRelation[],
    strict?: boolean
  ): Promise<SchemaValidation> {
    // Use strict parameter for enhanced validation if needed
    const enhancedValidation = strict || false;
    const errors: SchemaError[] = [];
    const warnings: SchemaWarning[] = [];

    // Validate required fields
    const requiredFields = fields.filter(f => f.meta?.required);
    for (const field of requiredFields) {
      if (!field.schema || field.schema.is_nullable) {
        errors.push({
          type: 'constraint_violation',
          message: `Required field "${field.field}" allows null values`,
          collection: collection.collection,
          field: field.field,
          severity: 'error'
        });
      }
    }

    // Validate relationships
    for (const relation of relations) {
      if (relation.related_collection) {
        try {
          await this.client.getCollection(relation.related_collection);
        } catch {
          errors.push({
            type: 'invalid_relation',
            message: `Related collection "${relation.related_collection}" does not exist`,
            collection: collection.collection,
            relation: `${relation.collection}.${relation.field}`,
            severity: 'error'
          });
        }
      }
    }

    // Check for circular dependencies
    const circularDeps = await this.detectCircularDependencies(collection.collection, relations);
    for (const dep of circularDeps) {
      warnings.push({
        type: 'circular_dependency',
        message: `Circular dependency detected: ${dep}`,
        collection: collection.collection,
        severity: 'warning'
      });
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  private async analyzeCollectionRelationships(
    collection: string, 
    allRelations: DirectusRelation[]
  ): Promise<RelationshipAnalysis> {
    const incomingRelations = allRelations.filter(r => r.related_collection === collection);
    const outgoingRelations = allRelations.filter(r => r.collection === collection);
    
    const circularDependencies = await this.detectCircularDependencies(collection, allRelations);
    
    return {
      collection,
      totalRelations: incomingRelations.length + outgoingRelations.length,
      incomingRelations,
      outgoingRelations,
      circularDependencies,
      orphanedFields: [], // TODO: Implement orphaned field detection
      missingConstraints: [] // TODO: Implement constraint validation
    };
  }

  private async detectCircularDependencies(
    collection: string, 
    relations: DirectusRelation[]
  ): Promise<string[]> {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const cycles: string[] = [];

    const dfs = (current: string, path: string[]): void => {
      if (recursionStack.has(current)) {
        const cycleStart = path.indexOf(current);
        cycles.push(path.slice(cycleStart).concat(current).join(' -> '));
        return;
      }

      if (visited.has(current)) return;

      visited.add(current);
      recursionStack.add(current);

      const relatedCollections = relations
        .filter(r => r.collection === current && r.related_collection)
        .map(r => r.related_collection!);

      for (const related of relatedCollections) {
        dfs(related, [...path, current]);
      }

      recursionStack.delete(current);
    };

    dfs(collection, []);
    return cycles;
  }

  private async createOneToManyRelation(config: OneToManyRelation): Promise<any> {
    // Create foreign key field in child collection
    const fieldData = {
      field: config.related_field,
      type: 'uuid' as DirectusFieldType,
      meta: {
        interface: 'select-dropdown-m2o' as DirectusInterface,
        special: ['m2o'],
        options: {
          template: '{{id}}'
        }
      },
      schema: {
        foreign_key_table: config.collection,
        foreign_key_column: 'id'
      }
    };

    await this.client.createField(config.related_collection, fieldData);

    // Create relation
    const relationData = {
      collection: config.related_collection,
      field: config.related_field,
      related_collection: config.collection,
      meta: {
        many_collection: config.related_collection,
        many_field: config.related_field,
        one_collection: config.collection,
        one_field: config.field,
        sort_field: config.sort_field,
        one_deselect_action: config.on_delete === 'SET NULL' ? 'nullify' : 'delete'
      },
      schema: {
        on_delete: config.on_delete || 'SET NULL',
        on_update: config.on_update || 'CASCADE'
      }
    };

    await this.client.createRelation(relationData);

    return {
      details: `Created O2M relation: ${config.collection}.${config.field} -> ${config.related_collection}.${config.related_field}`
    };
  }

  private async createManyToOneRelation(config: ManyToOneRelation): Promise<any> {
    // Create foreign key field
    const fieldData = {
      field: config.field,
      type: 'uuid' as DirectusFieldType,
      meta: {
        interface: 'select-dropdown-m2o' as DirectusInterface,
        special: ['m2o']
      },
      schema: {
        foreign_key_table: config.related_collection,
        foreign_key_column: config.related_field || 'id'
      }
    };

    await this.client.createField(config.collection, fieldData);

    // Create relation
    const relationData = {
      collection: config.collection,
      field: config.field,
      related_collection: config.related_collection,
      schema: {
        on_delete: config.on_delete || 'SET NULL',
        on_update: config.on_update || 'CASCADE'
      }
    };

    await this.client.createRelation(relationData);

    return {
      details: `Created M2O relation: ${config.collection}.${config.field} -> ${config.related_collection}`
    };
  }

  private async createManyToManyRelation(config: ManyToManyRelation): Promise<any> {
    // Create junction collection if it doesn't exist
    try {
      await this.client.getCollection(config.junction_collection);
    } catch {
      await this.client.createCollection(config.junction_collection, {
        hidden: true,
        icon: 'import_export'
      });
    }

    // Create junction fields
    const field1Data = {
      field: config.junction_field,
      type: 'uuid' as DirectusFieldType,
      meta: {
        interface: 'select-dropdown-m2o' as DirectusInterface,
        special: ['m2o']
      }
    };

    const field2Data = {
      field: config.related_junction_field,
      type: 'uuid' as DirectusFieldType,
      meta: {
        interface: 'select-dropdown-m2o' as DirectusInterface,
        special: ['m2o']
      }
    };

    await Promise.all([
      this.client.createField(config.junction_collection, field1Data),
      this.client.createField(config.junction_collection, field2Data)
    ]);

    // Create relations
    const relation1Data = {
      collection: config.junction_collection,
      field: config.junction_field,
      related_collection: config.collection
    };

    const relation2Data = {
      collection: config.junction_collection,
      field: config.related_junction_field,
      related_collection: config.related_collection
    };

    await Promise.all([
      this.client.createRelation(relation1Data),
      this.client.createRelation(relation2Data)
    ]);

    return {
      details: `Created M2M relation via junction table: ${config.collection} <-> ${config.junction_collection} <-> ${config.related_collection}`
    };
  }

  private async createOneToOneRelation(config: OneToOneRelation): Promise<any> {
    // Create foreign key field with unique constraint
    const fieldData = {
      field: config.related_field,
      type: 'uuid' as DirectusFieldType,
      meta: {
        interface: 'select-dropdown-m2o' as DirectusInterface,
        special: ['m2o']
      },
      schema: {
        is_unique: true,
        foreign_key_table: config.collection,
        foreign_key_column: 'id'
      }
    };

    await this.client.createField(config.related_collection, fieldData);

    // Create relation
    const relationData = {
      collection: config.related_collection,
      field: config.related_field,
      related_collection: config.collection,
      schema: {
        on_delete: config.on_delete || 'CASCADE',
        on_update: config.on_update || 'CASCADE'
      }
    };

    await this.client.createRelation(relationData);

    return {
      details: `Created O2O relation: ${config.collection}.${config.field} <-> ${config.related_collection}.${config.related_field}`
    };
  }

  private async createManyToAnyRelation(config: ManyToAnyRelation): Promise<any> {
    // Create collection field
    const collectionFieldData = {
      field: config.collection_field,
      type: 'string' as DirectusFieldType,
      meta: {
        interface: 'select-dropdown' as DirectusInterface,
        options: {
          choices: config.allowed_collections.map(c => ({ text: c, value: c }))
        }
      }
    };

    // Create primary key field
    const pkFieldData = {
      field: config.primary_key_field,
      type: 'string' as DirectusFieldType,
      meta: {
        interface: 'input' as DirectusInterface
      }
    };

    await Promise.all([
      this.client.createField(config.collection, collectionFieldData),
      this.client.createField(config.collection, pkFieldData)
    ]);

    return {
      details: `Created M2A relation: ${config.collection}.${config.field} -> [${config.allowed_collections.join(', ')}]`
    };
  }

  private formatFields(fields: DirectusField[]): string {
    return fields.map(f => 
      `- **${f.field}** (${f.type}) ${f.meta?.required ? '⚠️ Required' : ''} ${f.meta?.readonly ? '🔒 Readonly' : ''}`
    ).join('\n');
  }

  private formatRelationshipMap(map: RelationshipMap): string {
    const sections = [];
    
    if (map.oneToMany.length > 0) {
      sections.push(`### One-to-Many (${map.oneToMany.length})\n${map.oneToMany.map(r => 
        `- ${r.collection}.${r.field} → ${r.related_collection}.${r.related_field}`
      ).join('\n')}`);
    }

    if (map.manyToOne.length > 0) {
      sections.push(`### Many-to-One (${map.manyToOne.length})\n${map.manyToOne.map(r => 
        `- ${r.collection}.${r.field} → ${r.related_collection}`
      ).join('\n')}`);
    }

    if (map.manyToMany.length > 0) {
      sections.push(`### Many-to-Many (${map.manyToMany.length})\n${map.manyToMany.map(r => 
        `- ${r.collection} ↔ ${r.related_collection} (via ${r.junction_collection})`
      ).join('\n')}`);
    }

    if (map.oneToOne.length > 0) {
      sections.push(`### One-to-One (${map.oneToOne.length})\n${map.oneToOne.map(r => 
        `- ${r.collection}.${r.field} ↔ ${r.related_collection}.${r.related_field}`
      ).join('\n')}`);
    }

    if (map.manyToAny.length > 0) {
      sections.push(`### Many-to-Any (${map.manyToAny.length})\n${map.manyToAny.map(r => 
        `- ${r.collection}.${r.field} → [${r.allowed_collections.join(', ')}]`
      ).join('\n')}`);
    }

    return sections.join('\n\n') || 'No relationships found.';
  }

  private formatValidation(validation: SchemaValidation): string {
    const sections = [];

    if (validation.errors.length > 0) {
      sections.push(`### ❌ Errors (${validation.errors.length})\n${validation.errors.map(e => 
        `- **${e.type}**: ${e.message}${e.collection ? ` (${e.collection}${e.field ? `.${e.field}` : ''})` : ''}`
      ).join('\n')}`);
    }

    if (validation.warnings.length > 0) {
      sections.push(`### ⚠️ Warnings (${validation.warnings.length})\n${validation.warnings.map(w => 
        `- **${w.type}**: ${w.message}${w.collection ? ` (${w.collection}${w.field ? `.${w.field}` : ''})` : ''}`
      ).join('\n')}`);
    }

    if (validation.isValid) {
      sections.push('### ✅ Schema is valid');
    }

    return sections.join('\n\n') || 'No validation issues found.';
  }

  private formatRelationshipAnalysis(analysis: RelationshipAnalysis): string {
    return `## ${analysis.collection}\n` +
           `- **Total Relations**: ${analysis.totalRelations}\n` +
           `- **Incoming**: ${analysis.incomingRelations.length}\n` +
           `- **Outgoing**: ${analysis.outgoingRelations.length}\n` +
           `- **Circular Dependencies**: ${analysis.circularDependencies.length}\n` +
           (analysis.circularDependencies.length > 0 ? 
             `  - ${analysis.circularDependencies.join('\n  - ')}\n` : '');
  }
}
