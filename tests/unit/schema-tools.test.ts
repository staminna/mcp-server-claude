// Unit tests for src/tools/schema-tools.ts using the DirectusClient stub.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SchemaTools } from '../../src/tools/schema-tools.js';
import { makeClientStub, type ClientStub } from '../helpers/stubs.js';
import { COLLECTIONS, FIELDS_ARTICLES, RELATIONS, envelope } from '../helpers/fixtures.js';
import type { DirectusClient } from '../../src/client/directus-client.js';
import type { DirectusRelationConfig } from '../../src/types/directus.js';

const ARTICLES_COLLECTION = COLLECTIONS[0]; // { collection: 'articles', ... }

function text(result: any): string {
  expect(result.content[0].type).toBe('text');
  return result.content[0].text as string;
}

describe('SchemaTools', () => {
  let stub: ClientStub & DirectusClient;
  let tools: SchemaTools;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Logger is a module singleton writing JSON lines to stderr; silence it.
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true) as any;
    stub = makeClientStub();
    tools = new SchemaTools(stub);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  describe('analyzeCollectionSchema', () => {
    it('categorizes m2o, m2m, m2a and o2m relations and skips meta-less relations', async () => {
      stub.getCollection.mockResolvedValue(envelope(ARTICLES_COLLECTION));
      stub.getFields.mockResolvedValue(envelope(FIELDS_ARTICLES));

      const relations = [
        ...RELATIONS,
        // o2m: comments.article -> articles (this collection is referenced)
        {
          collection: 'comments',
          field: 'article',
          related_collection: 'articles',
          meta: {
            many_collection: 'comments',
            many_field: 'article',
            one_collection: 'articles',
            one_field: 'comments',
            sort_field: 'sort',
          },
        },
        // m2a anchored on articles (one_allowed_collections with length > 1)
        {
          collection: 'articles',
          field: 'item',
          meta: {
            many_collection: 'articles',
            many_field: 'item',
            one_allowed_collections: ['tags', 'authors'],
          },
        },
        // one_allowed_collections of length 1 falls through to the m2o branch
        {
          collection: 'articles',
          field: 'single_poly',
          related_collection: 'tags',
          meta: {
            many_collection: 'articles',
            many_field: 'single_poly',
            one_allowed_collections: ['tags'],
          },
        },
        // relation without meta — skipped by buildRelationshipMap entirely
        { collection: 'articles', field: 'legacy', related_collection: 'authors' },
      ];
      stub.getRelations.mockResolvedValue(envelope(relations));

      const result = await tools.analyzeCollectionSchema({
        collection: 'articles',
        includeRelations: true,
        validateConstraints: true,
      });

      const out = text(result);
      expect(out).toContain('# Schema Analysis for "articles"');
      // 6 relations touch articles (m2o fixture, m2m fixture, o2m, m2a, single_poly, legacy)
      expect(out).toContain('**Relations**: 6');
      // m2o: articles.author and articles.single_poly
      expect(out).toContain('Many-to-One (2)');
      expect(out).toContain('- articles.author → authors');
      expect(out).toContain('- articles.single_poly → tags');
      // m2m via junction_field
      expect(out).toContain('Many-to-Many (1)');
      expect(out).toContain('(via articles_tags)');
      // m2a
      expect(out).toContain('Many-to-Any (1)');
      expect(out).toContain('- articles.item → [tags, authors]');
      // o2m (this collection referenced by comments.article)
      expect(out).toContain('One-to-Many (1)');
      expect(out).toContain('- articles.comments → comments.article');
      // fields formatting (required marker)
      expect(out).toContain('- **title** (string) ⚠️ Required');
      // valid schema
      expect(out).toContain('### ✅ Schema is valid');
      expect(out).not.toContain('No relationships found.');
      expect(stub.getRelations).toHaveBeenCalledTimes(1);
    });

    it('skips fetching relations when includeRelations is false', async () => {
      stub.getCollection.mockResolvedValue(envelope(ARTICLES_COLLECTION));
      stub.getFields.mockResolvedValue(envelope(FIELDS_ARTICLES));

      const result = await tools.analyzeCollectionSchema({ collection: 'articles' });

      const out = text(result);
      expect(out).toContain('**Relations**: 0');
      expect(out).toContain('No relationships found.');
      expect(stub.getRelations).not.toHaveBeenCalled();
    });

    it('flags required nullable fields, schema-less fields and missing related collections', async () => {
      stub.getCollection.mockImplementation(async (name: string) => {
        if (name === 'ghost_collection') throw new Error('not found');
        return envelope(ARTICLES_COLLECTION);
      });
      stub.getFields.mockResolvedValue(
        envelope([
          ...FIELDS_ARTICLES,
          {
            collection: 'articles',
            field: 'subtitle',
            type: 'string',
            meta: { interface: 'input', required: true },
            schema: { name: 'subtitle', is_nullable: true },
          },
          // required field with no schema object at all
          {
            collection: 'articles',
            field: 'ghost_field',
            type: 'string',
            meta: { interface: 'input', required: true, readonly: true },
          },
        ])
      );
      stub.getRelations.mockResolvedValue(
        envelope([
          {
            collection: 'articles',
            field: 'ref',
            related_collection: 'ghost_collection',
            meta: { many_collection: 'articles', many_field: 'ref' },
          },
        ])
      );

      const result = await tools.analyzeCollectionSchema({
        collection: 'articles',
        includeRelations: true,
        validateConstraints: true,
      });

      const out = text(result);
      expect(out).toContain('**Valid**: ❌');
      expect(out).toContain('### ❌ Errors (3)');
      expect(out).toContain('Required field "subtitle" allows null values');
      expect(out).toContain('Required field "ghost_field" allows null values');
      expect(out).toContain('**invalid_relation**: Related collection "ghost_collection" does not exist');
      // readonly field marker in field formatting
      expect(out).toContain('🔒 Readonly');
    });

    it('reports circular dependencies as warnings', async () => {
      stub.getCollection.mockResolvedValue(envelope(ARTICLES_COLLECTION));
      stub.getFields.mockResolvedValue(envelope(FIELDS_ARTICLES));
      stub.getRelations.mockResolvedValue(
        envelope([
          {
            collection: 'articles',
            field: 'author',
            related_collection: 'authors',
            meta: { many_collection: 'articles', many_field: 'author', one_collection: 'authors' },
          },
          {
            collection: 'authors',
            field: 'featured_article',
            related_collection: 'articles',
            meta: { many_collection: 'authors', many_field: 'featured_article', one_collection: 'articles' },
          },
        ])
      );

      const result = await tools.analyzeCollectionSchema({
        collection: 'articles',
        includeRelations: true,
      });

      const out = text(result);
      expect(out).toContain('### ⚠️ Warnings');
      expect(out).toContain('**circular_dependency**: Circular dependency detected: articles -> authors -> articles');
      // warnings alone do not invalidate the schema
      expect(out).toContain('**Valid**: ✅');
      expect(out).toContain('### ✅ Schema is valid');
    });

    it('uses explicit m2a collection_field/primary_key_field and tolerates missing data arrays', async () => {
      stub.getCollection.mockResolvedValue(envelope(COLLECTIONS[4])); // comments
      stub.getFields.mockResolvedValue({} as any); // no data -> [] fallback
      stub.getRelations.mockResolvedValue(
        envelope([
          {
            collection: 'comments',
            field: 'item',
            related_collection: null,
            meta: {
              many_collection: 'comments',
              many_field: 'item',
              one_allowed_collections: ['articles', 'authors'],
              one_collection_field: 'collection',
              one_field: 'item_pk',
            },
          },
        ])
      );

      const result = await tools.analyzeCollectionSchema({
        collection: 'comments',
        includeRelations: true,
      });

      const out = text(result);
      expect(out).toContain('**Fields**: 0');
      expect(out).toContain('Many-to-Any (1)');
      expect(out).toContain('"collection_field": "collection"');
      expect(out).toContain('"primary_key_field": "item_pk"');
    });

    it('falls back to an empty relation list when the relations payload has no data', async () => {
      stub.getCollection.mockResolvedValue(envelope(ARTICLES_COLLECTION));
      stub.getFields.mockResolvedValue(envelope(FIELDS_ARTICLES));
      stub.getRelations.mockResolvedValue({} as any);

      const result = await tools.analyzeCollectionSchema({
        collection: 'articles',
        includeRelations: true,
      });

      expect(text(result)).toContain('No relationships found.');
    });

    it('returns an error message when the client rejects', async () => {
      stub.getCollection.mockRejectedValue(new Error('boom'));

      const result = await tools.analyzeCollectionSchema({ collection: 'articles' });

      expect(text(result)).toContain('Error analyzing schema for collection "articles": boom');
    });
  });

  describe('formatRelationshipMap (one-to-one section)', () => {
    // buildRelationshipMap never categorizes a relation as o2o, so the o2o
    // formatter section is exercised directly through the private method.
    it('renders the one-to-one section', () => {
      const out = (tools as any).formatRelationshipMap({
        oneToMany: [],
        manyToOne: [],
        manyToMany: [],
        oneToOne: [
          {
            type: 'o2o',
            collection: 'users_c',
            field: 'profile',
            related_collection: 'profiles',
            related_field: 'user',
          },
        ],
        manyToAny: [],
      });

      expect(out).toContain('### One-to-One (1)');
      expect(out).toContain('- users_c.profile ↔ profiles.user');
    });
  });

  describe('analyzeRelationships', () => {
    it('analyzes all collections, excluding system collections by default', async () => {
      stub.getCollections.mockResolvedValue(envelope(COLLECTIONS));
      stub.getRelations.mockResolvedValue(envelope(RELATIONS));

      const result = await tools.analyzeRelationships({});

      const out = text(result);
      expect(out).toContain('# Relationship Analysis');
      expect(out).toContain('## articles');
      expect(out).toContain('## authors');
      expect(out).toContain('## tags');
      expect(out).not.toContain('## directus_users');
      // articles: outgoing articles.author, incoming articles_tags.articles_id
      expect(out).toContain('**Total Relations**: 2');
    });

    it('includes system collections when includeSystemCollections is true', async () => {
      stub.getCollections.mockResolvedValue(envelope(COLLECTIONS));
      stub.getRelations.mockResolvedValue(envelope(RELATIONS));

      const result = await tools.analyzeRelationships({ includeSystemCollections: true });

      expect(text(result)).toContain('## directus_users');
    });

    it('filters the analysis to a single collection with incoming/outgoing counts', async () => {
      stub.getCollections.mockResolvedValue(envelope(COLLECTIONS));
      stub.getRelations.mockResolvedValue(envelope(RELATIONS));

      const result = await tools.analyzeRelationships({ collection: 'authors' });

      const out = text(result);
      expect(out).toContain('## authors');
      expect(out).not.toContain('## articles');
      // incoming: articles.author -> authors; outgoing: none
      expect(out).toContain('**Incoming**: 1');
      expect(out).toContain('**Outgoing**: 0');
      expect(out).toContain('**Total Relations**: 1');
    });

    it('detects and lists circular dependencies', async () => {
      stub.getCollections.mockResolvedValue(envelope(COLLECTIONS));
      stub.getRelations.mockResolvedValue(
        envelope([
          {
            collection: 'articles',
            field: 'author',
            related_collection: 'authors',
            meta: { many_collection: 'articles', many_field: 'author' },
          },
          {
            collection: 'authors',
            field: 'featured_article',
            related_collection: 'articles',
            meta: { many_collection: 'authors', many_field: 'featured_article' },
          },
        ])
      );

      const result = await tools.analyzeRelationships({ collection: 'articles' });

      const out = text(result);
      expect(out).toContain('**Circular Dependencies**: 1');
      expect(out).toContain('articles -> authors -> articles');
    });

    it('returns an error message when the client rejects', async () => {
      stub.getCollections.mockRejectedValue(new Error('nope'));

      const result = await tools.analyzeRelationships({});

      expect(text(result)).toContain('Error analyzing relationships: nope');
    });
  });

  describe('createRelationship', () => {
    const headerCases: Array<[string, DirectusRelationConfig]> = [
      [
        'o2m',
        {
          type: 'o2m',
          collection: 'authors',
          field: 'articles',
          related_collection: 'articles',
          related_field: 'author',
        },
      ],
      [
        'm2o',
        {
          type: 'm2o',
          collection: 'articles',
          field: 'author',
          related_collection: 'authors',
          related_field: 'code',
          on_delete: 'CASCADE',
          on_update: 'RESTRICT',
        },
      ],
      [
        'm2m',
        {
          type: 'm2m',
          collection: 'articles',
          field: 'tags',
          related_collection: 'tags',
          junction_collection: 'articles_tags',
          junction_field: 'articles_id',
          related_junction_field: 'tags_id',
        },
      ],
      [
        'o2o',
        {
          type: 'o2o',
          collection: 'users_c',
          field: 'profile',
          related_collection: 'profiles',
          related_field: 'user',
          on_delete: 'RESTRICT',
          on_update: 'RESTRICT',
        },
      ],
      [
        'm2a',
        {
          type: 'm2a',
          collection: 'comments',
          field: 'item',
          allowed_collections: ['articles', 'authors'],
          collection_field: 'collection',
          primary_key_field: 'item_id',
        },
      ],
    ];

    it.each(headerCases)('creates a %s relationship and reports success', async (type, config) => {
      const result = await tools.createRelationship(config);

      const out = text(result);
      expect(out).toContain(`✅ **${type.toUpperCase()} Relationship Created**`);
      expect(out).toContain(`- **Collection**: ${config.collection}`);
      expect(out).toContain(`- **Field**: ${config.field}`);
    });

    it('o2m: creates FK field in child collection and maps SET NULL to nullify', async () => {
      const result = await tools.createRelationship({
        type: 'o2m',
        collection: 'authors',
        field: 'articles',
        related_collection: 'articles',
        related_field: 'author',
        sort_field: 'sort',
        on_delete: 'SET NULL',
        on_update: 'RESTRICT',
      });

      expect(stub.createField).toHaveBeenCalledWith(
        'articles',
        expect.objectContaining({
          field: 'author',
          type: 'uuid',
          schema: { foreign_key_table: 'authors', foreign_key_column: 'id' },
        })
      );
      expect(stub.createRelation).toHaveBeenCalledTimes(1);
      const relation = stub.createRelation.mock.calls[0][0];
      expect(relation.collection).toBe('articles');
      expect(relation.field).toBe('author');
      expect(relation.related_collection).toBe('authors');
      expect(relation.meta.one_collection).toBe('authors');
      expect(relation.meta.one_field).toBe('articles');
      expect(relation.meta.sort_field).toBe('sort');
      expect(relation.meta.one_deselect_action).toBe('nullify');
      expect(relation.schema).toEqual({ on_delete: 'SET NULL', on_update: 'RESTRICT' });

      expect(text(result)).toContain('Created O2M relation: authors.articles -> articles.author');
    });

    it('o2m: defaults on_delete/on_update and uses delete deselect action', async () => {
      await tools.createRelationship({
        type: 'o2m',
        collection: 'authors',
        field: 'articles',
        related_collection: 'articles',
        related_field: 'author',
      });

      const relation = stub.createRelation.mock.calls[0][0];
      expect(relation.meta.one_deselect_action).toBe('delete');
      expect(relation.schema).toEqual({ on_delete: 'SET NULL', on_update: 'CASCADE' });
    });

    it('m2o: creates FK field on the child collection with default column id', async () => {
      const result = await tools.createRelationship({
        type: 'm2o',
        collection: 'articles',
        field: 'author',
        related_collection: 'authors',
      });

      expect(stub.createField).toHaveBeenCalledWith(
        'articles',
        expect.objectContaining({
          field: 'author',
          type: 'uuid',
          schema: { foreign_key_table: 'authors', foreign_key_column: 'id' },
        })
      );
      const relation = stub.createRelation.mock.calls[0][0];
      expect(relation).toEqual({
        collection: 'articles',
        field: 'author',
        related_collection: 'authors',
        schema: { on_delete: 'SET NULL', on_update: 'CASCADE' },
      });

      expect(text(result)).toContain('Created M2O relation: articles.author -> authors');
    });

    it('m2o: honors explicit related_field and on_delete/on_update', async () => {
      await tools.createRelationship({
        type: 'm2o',
        collection: 'articles',
        field: 'author',
        related_collection: 'authors',
        related_field: 'code',
        on_delete: 'CASCADE',
        on_update: 'RESTRICT',
      });

      const fieldData = stub.createField.mock.calls[0][1];
      expect(fieldData.schema.foreign_key_column).toBe('code');
      const relation = stub.createRelation.mock.calls[0][0];
      expect(relation.schema).toEqual({ on_delete: 'CASCADE', on_update: 'RESTRICT' });
    });

    it('m2m: reuses an existing junction collection', async () => {
      stub.getCollection.mockResolvedValue(envelope(COLLECTIONS[2])); // articles_tags exists

      const result = await tools.createRelationship({
        type: 'm2m',
        collection: 'articles',
        field: 'tags',
        related_collection: 'tags',
        junction_collection: 'articles_tags',
        junction_field: 'articles_id',
        related_junction_field: 'tags_id',
      });

      expect(stub.createCollection).not.toHaveBeenCalled();
      expect(stub.createField).toHaveBeenCalledTimes(2);
      expect(stub.createField).toHaveBeenCalledWith(
        'articles_tags',
        expect.objectContaining({ field: 'articles_id', type: 'uuid' })
      );
      expect(stub.createField).toHaveBeenCalledWith(
        'articles_tags',
        expect.objectContaining({ field: 'tags_id', type: 'uuid' })
      );
      expect(stub.createRelation).toHaveBeenCalledTimes(2);
      expect(stub.createRelation).toHaveBeenCalledWith({
        collection: 'articles_tags',
        field: 'articles_id',
        related_collection: 'articles',
      });
      expect(stub.createRelation).toHaveBeenCalledWith({
        collection: 'articles_tags',
        field: 'tags_id',
        related_collection: 'tags',
      });

      expect(text(result)).toContain(
        'Created M2M relation via junction table: articles <-> articles_tags <-> tags'
      );
    });

    it('m2m: creates the junction collection when it does not exist', async () => {
      stub.getCollection.mockRejectedValue(new Error('not found'));

      const result = await tools.createRelationship({
        type: 'm2m',
        collection: 'articles',
        field: 'tags',
        related_collection: 'tags',
        junction_collection: 'articles_tags',
        junction_field: 'articles_id',
        related_junction_field: 'tags_id',
      });

      expect(stub.createCollection).toHaveBeenCalledWith('articles_tags', {
        hidden: true,
        icon: 'import_export',
      });
      expect(stub.createField).toHaveBeenCalledTimes(2);
      expect(stub.createRelation).toHaveBeenCalledTimes(2);
      expect(text(result)).toContain('✅ **M2M Relationship Created**');
    });

    it('o2o: creates a unique FK field and defaults on_delete to CASCADE', async () => {
      const result = await tools.createRelationship({
        type: 'o2o',
        collection: 'users_c',
        field: 'profile',
        related_collection: 'profiles',
        related_field: 'user',
      });

      expect(stub.createField).toHaveBeenCalledWith(
        'profiles',
        expect.objectContaining({
          field: 'user',
          type: 'uuid',
          schema: { is_unique: true, foreign_key_table: 'users_c', foreign_key_column: 'id' },
        })
      );
      const relation = stub.createRelation.mock.calls[0][0];
      expect(relation).toEqual({
        collection: 'profiles',
        field: 'user',
        related_collection: 'users_c',
        schema: { on_delete: 'CASCADE', on_update: 'CASCADE' },
      });

      expect(text(result)).toContain('Created O2O relation: users_c.profile <-> profiles.user');
    });

    it('m2a: creates collection and primary key fields without a relation', async () => {
      const result = await tools.createRelationship({
        type: 'm2a',
        collection: 'comments',
        field: 'item',
        allowed_collections: ['articles', 'authors'],
        collection_field: 'collection',
        primary_key_field: 'item_id',
      });

      expect(stub.createField).toHaveBeenCalledTimes(2);
      expect(stub.createField).toHaveBeenCalledWith(
        'comments',
        expect.objectContaining({
          field: 'collection',
          type: 'string',
          meta: expect.objectContaining({
            interface: 'select-dropdown',
            options: {
              choices: [
                { text: 'articles', value: 'articles' },
                { text: 'authors', value: 'authors' },
              ],
            },
          }),
        })
      );
      expect(stub.createField).toHaveBeenCalledWith(
        'comments',
        expect.objectContaining({ field: 'item_id', type: 'string' })
      );
      expect(stub.createRelation).not.toHaveBeenCalled();

      const out = text(result);
      expect(out).toContain('Created M2A relation: comments.item -> [articles, authors]');
      // m2a config has no related_collection
      expect(out).toContain('- **Related Collection**: N/A');
    });

    it('returns an error for an unsupported relationship type', async () => {
      const result = await tools.createRelationship({
        type: 'x2x',
        collection: 'articles',
        field: 'whatever',
      } as any);

      expect(text(result)).toContain('Error creating x2x relationship: Unsupported relationship type: x2x');
      expect(stub.createField).not.toHaveBeenCalled();
      expect(stub.createRelation).not.toHaveBeenCalled();
    });

    it('returns an error message when field creation fails', async () => {
      stub.createField.mockRejectedValue(new Error('field exists'));

      const result = await tools.createRelationship({
        type: 'o2m',
        collection: 'authors',
        field: 'articles',
        related_collection: 'articles',
        related_field: 'author',
      });

      expect(text(result)).toContain('Error creating o2m relationship: field exists');
      expect(stub.createRelation).not.toHaveBeenCalled();
    });
  });

  describe('validateCollectionSchema', () => {
    it('reports a valid schema', async () => {
      stub.getCollection.mockResolvedValue(envelope(ARTICLES_COLLECTION));
      stub.getFields.mockResolvedValue(envelope(FIELDS_ARTICLES));
      stub.getRelations.mockResolvedValue(envelope(RELATIONS));

      const result = await tools.validateCollectionSchema({ collection: 'articles' });

      const out = text(result);
      expect(out).toContain('# Schema Validation for "articles"');
      expect(out).toContain('**Status**: ✅ Valid');
      expect(out).toContain('**Errors**: 0');
      expect(out).toContain('**Warnings**: 0');
      expect(out).toContain('### ✅ Schema is valid');
    });

    it('flags required fields that allow null values (strict mode)', async () => {
      stub.getCollection.mockResolvedValue(envelope(ARTICLES_COLLECTION));
      stub.getFields.mockResolvedValue(
        envelope([
          {
            collection: 'articles',
            field: 'subtitle',
            type: 'string',
            meta: { interface: 'input', required: true },
            schema: { name: 'subtitle', is_nullable: true },
          },
        ])
      );
      stub.getRelations.mockResolvedValue(envelope([]));

      const result = await tools.validateCollectionSchema({ collection: 'articles', strict: true });

      const out = text(result);
      expect(out).toContain('**Status**: ❌ Invalid');
      expect(out).toContain('**Errors**: 1');
      expect(out).toContain('**constraint_violation**: Required field "subtitle" allows null values');
      expect(out).toContain('(articles.subtitle)');
    });

    it('flags relations pointing at missing collections', async () => {
      stub.getCollection.mockImplementation(async (name: string) => {
        if (name === 'ghost') throw new Error('not found');
        return envelope(ARTICLES_COLLECTION);
      });
      stub.getFields.mockResolvedValue(envelope(FIELDS_ARTICLES));
      stub.getRelations.mockResolvedValue(
        envelope([
          {
            collection: 'articles',
            field: 'ref',
            related_collection: 'ghost',
            meta: { many_collection: 'articles', many_field: 'ref' },
          },
        ])
      );

      const result = await tools.validateCollectionSchema({ collection: 'articles' });

      const out = text(result);
      expect(out).toContain('**Status**: ❌ Invalid');
      expect(out).toContain('**invalid_relation**: Related collection "ghost" does not exist');
    });

    it('returns an error message when the client rejects', async () => {
      stub.getFields.mockRejectedValue(new Error('db down'));

      const result = await tools.validateCollectionSchema({ collection: 'articles' });

      expect(text(result)).toContain('Error validating schema for collection "articles": db down');
    });
  });
});
