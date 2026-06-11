// Unit tests for src/tools/collection-tools.ts using a constructor-injected
// DirectusClient stub. Every public method's happy path, error (catch) branch,
// confirm guard and option-assembly branch is exercised.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CollectionTools } from '../../src/tools/collection-tools.js';
import { makeClientStub } from '../helpers/stubs.js';
import {
  COLLECTIONS,
  FIELDS_ARTICLES,
  RELATIONS,
  ITEMS_ARTICLES,
  envelope,
} from '../helpers/fixtures.js';

function text(result: any): string {
  return result.content[0].text;
}

let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true) as any;
});

afterEach(() => {
  stderrSpy.mockRestore();
});

describe('CollectionTools', () => {
  describe('listCollections', () => {
    it('filters out directus_* system collections by default', async () => {
      const stub = makeClientStub();
      stub.getCollections.mockResolvedValue(envelope(COLLECTIONS));
      const tools = new CollectionTools(stub);

      const result = await tools.listCollections();
      const out = text(result);

      expect(out).toContain('Available collections (6)');
      expect(out).toContain('**articles**');
      expect(out).toContain('Blog articles');
      expect(out).not.toContain('directus_users');
      // collections without a meta.note fall back to "No description"
      expect(out).toContain('**tags** - No description');
    });

    it('includes system collections when include_system is true', async () => {
      const stub = makeClientStub();
      stub.getCollections.mockResolvedValue(envelope(COLLECTIONS));
      const tools = new CollectionTools(stub);

      const result = await tools.listCollections({ include_system: true });
      const out = text(result);

      expect(out).toContain('Available collections (7)');
      expect(out).toContain('directus_users');
    });

    it('treats a missing data array as empty', async () => {
      const stub = makeClientStub();
      stub.getCollections.mockResolvedValue(envelope(null));
      const tools = new CollectionTools(stub);

      const result = await tools.listCollections();
      expect(text(result)).toContain('Available collections (0)');
    });

    it('returns an error message when the client rejects', async () => {
      const stub = makeClientStub();
      stub.getCollections.mockRejectedValue(new Error('list boom'));
      const tools = new CollectionTools(stub);

      const result = await tools.listCollections();
      expect(text(result)).toContain('Error listing collections: list boom');
    });
  });

  describe('getCollectionSchema', () => {
    it('maps fields including required/readonly defaults when meta is missing', async () => {
      const stub = makeClientStub();
      stub.getCollection.mockResolvedValue(envelope(COLLECTIONS[0]));
      stub.getFields.mockResolvedValue(
        envelope([
          ...FIELDS_ARTICLES,
          // field with no meta at all -> required||false, readonly||false branch
          { collection: 'articles', field: 'raw', type: 'string' },
        ])
      );
      const tools = new CollectionTools(stub);

      const result = await tools.getCollectionSchema({ collection: 'articles' });
      const out = text(result);

      expect(out).toContain('Schema for collection "articles"');
      const parsed = JSON.parse(out.match(/```json\n([\s\S]*)\n```/)![1]);
      expect(parsed.collection).toBe('articles');
      expect(parsed.fields).toHaveLength(5);
      const title = parsed.fields.find((f: any) => f.field === 'title');
      expect(title.required).toBe(true);
      expect(title.interface).toBe('input');
      expect(title.note).toBe('Article title');
      const raw = parsed.fields.find((f: any) => f.field === 'raw');
      expect(raw.required).toBe(false);
      expect(raw.readonly).toBe(false);
      const status = parsed.fields.find((f: any) => f.field === 'status');
      expect(status.required).toBe(false);
      expect(stub.getCollection).toHaveBeenCalledWith('articles');
      expect(stub.getFields).toHaveBeenCalledWith('articles');
    });

    it('handles a missing fields array', async () => {
      const stub = makeClientStub();
      stub.getCollection.mockResolvedValue(envelope(COLLECTIONS[1]));
      stub.getFields.mockResolvedValue(envelope(null));
      const tools = new CollectionTools(stub);

      const result = await tools.getCollectionSchema({ collection: 'authors' });
      expect(text(result)).toContain('Schema for collection "authors"');
      expect(text(result)).toContain('"fields": []');
    });

    it('returns an error message when the client rejects', async () => {
      const stub = makeClientStub();
      stub.getCollection.mockRejectedValue(new Error('schema boom'));
      const tools = new CollectionTools(stub);

      const result = await tools.getCollectionSchema({ collection: 'articles' });
      expect(text(result)).toContain('Error getting schema for collection "articles": schema boom');
    });
  });

  describe('createCollection', () => {
    it('creates a collection without fields', async () => {
      const stub = makeClientStub();
      const tools = new CollectionTools(stub);

      const result = await tools.createCollection({ collection: 'events' });
      const out = text(result);

      expect(out).toContain('Collection "events" created successfully');
      expect(out).not.toContain('with');
      expect(stub.createCollection).toHaveBeenCalledWith('events', {});
      expect(stub.createField).not.toHaveBeenCalled();
    });

    it('creates a collection and each provided field', async () => {
      const stub = makeClientStub();
      const tools = new CollectionTools(stub);
      const fields = [
        { field: 'name', type: 'string' },
        { field: 'count', type: 'integer', meta: { hidden: false } },
      ];

      const result = await tools.createCollection({
        collection: 'events',
        meta: { note: 'Events' },
        fields,
      });

      expect(text(result)).toContain('Collection "events" created successfully with 2 fields');
      expect(stub.createCollection).toHaveBeenCalledWith('events', { note: 'Events' });
      expect(stub.createField).toHaveBeenCalledTimes(2);
      expect(stub.createField).toHaveBeenNthCalledWith(1, 'events', fields[0]);
      expect(stub.createField).toHaveBeenNthCalledWith(2, 'events', fields[1]);
    });

    it('returns an error message when the client rejects', async () => {
      const stub = makeClientStub();
      stub.createCollection.mockRejectedValue(new Error('create boom'));
      const tools = new CollectionTools(stub);

      const result = await tools.createCollection({ collection: 'events' });
      expect(text(result)).toContain('Error creating collection "events": create boom');
    });
  });

  describe('deleteCollection', () => {
    it('returns a warning and does not call the client without confirm', async () => {
      const stub = makeClientStub();
      const tools = new CollectionTools(stub);

      const result = await tools.deleteCollection({ collection: 'articles' });
      const out = text(result);

      expect(out).toContain('Warning');
      expect(out).toContain('permanently delete the collection "articles"');
      expect(out).toContain('confirm: true');
      expect(stub.deleteCollection).not.toHaveBeenCalled();
    });

    it('deletes the collection when confirm is true', async () => {
      const stub = makeClientStub();
      const tools = new CollectionTools(stub);

      const result = await tools.deleteCollection({ collection: 'articles', confirm: true });

      expect(text(result)).toContain('Collection "articles" has been deleted successfully');
      expect(stub.deleteCollection).toHaveBeenCalledWith('articles');
    });

    it('returns an error message when the client rejects', async () => {
      const stub = makeClientStub();
      stub.deleteCollection.mockRejectedValue(new Error('delete boom'));
      const tools = new CollectionTools(stub);

      const result = await tools.deleteCollection({ collection: 'articles', confirm: true });
      expect(text(result)).toContain('Error deleting collection "articles": delete boom');
    });
  });

  describe('getCollectionItems', () => {
    it('passes all provided query options through to getItems', async () => {
      const stub = makeClientStub();
      stub.getItems.mockResolvedValue(envelope(ITEMS_ARTICLES, { total_count: 30, filter_count: 3 }));
      const tools = new CollectionTools(stub);

      const result = await tools.getCollectionItems({
        collection: 'articles',
        limit: 5,
        offset: 10,
        filter: { status: { _eq: 'published' } },
        sort: ['-id'],
        fields: ['id', 'title'],
        search: 'directus',
      });

      expect(stub.getItems).toHaveBeenCalledWith('articles', {
        limit: 5,
        offset: 10,
        filter: { status: { _eq: 'published' } },
        sort: ['-id'],
        fields: ['id', 'title'],
        search: 'directus',
        meta: ['total_count', 'filter_count'],
      });
      const out = text(result);
      expect(out).toContain('Items from "articles" (3 of 30)');
      expect(out).toContain('Hello Directus');
    });

    it('defaults limit to 25 and omits total when meta is missing', async () => {
      const stub = makeClientStub();
      stub.getItems.mockResolvedValue(envelope([ITEMS_ARTICLES[0]]));
      const tools = new CollectionTools(stub);

      const result = await tools.getCollectionItems({ collection: 'articles' });

      expect(stub.getItems).toHaveBeenCalledWith('articles', {
        limit: 25,
        offset: undefined,
        meta: ['total_count', 'filter_count'],
      });
      expect(text(result)).toContain('Items from "articles" (1)');
      expect(text(result)).not.toContain(' of ');
    });

    it('treats a null items payload as empty', async () => {
      const stub = makeClientStub();
      stub.getItems.mockResolvedValue(envelope(null));
      const tools = new CollectionTools(stub);

      const result = await tools.getCollectionItems({ collection: 'articles' });
      expect(text(result)).toContain('Items from "articles" (0)');
    });

    it('returns an error message when the client rejects', async () => {
      const stub = makeClientStub();
      stub.getItems.mockRejectedValue(new Error('items boom'));
      const tools = new CollectionTools(stub);

      const result = await tools.getCollectionItems({ collection: 'articles' });
      expect(text(result)).toContain('Error getting items from collection "articles": items boom');
    });
  });

  describe('createItem', () => {
    it('creates an item and returns its data', async () => {
      const stub = makeClientStub();
      stub.createItem.mockResolvedValue(envelope({ id: 42, title: 'New' }));
      const tools = new CollectionTools(stub);

      const result = await tools.createItem({ collection: 'articles', data: { title: 'New' } });

      expect(stub.createItem).toHaveBeenCalledWith('articles', { title: 'New' });
      expect(text(result)).toContain('Item created successfully in "articles"');
      expect(text(result)).toContain('"id": 42');
    });

    it('returns an error message when the client rejects', async () => {
      const stub = makeClientStub();
      stub.createItem.mockRejectedValue(new Error('item boom'));
      const tools = new CollectionTools(stub);

      const result = await tools.createItem({ collection: 'articles', data: {} });
      expect(text(result)).toContain('Error creating item in collection "articles": item boom');
    });
  });

  describe('updateItem', () => {
    it('updates an item and returns its data', async () => {
      const stub = makeClientStub();
      stub.updateItem.mockResolvedValue(envelope({ id: 7, title: 'Edited' }));
      const tools = new CollectionTools(stub);

      const result = await tools.updateItem({ collection: 'articles', id: 7, data: { title: 'Edited' } });

      expect(stub.updateItem).toHaveBeenCalledWith('articles', 7, { title: 'Edited' });
      expect(text(result)).toContain('Item 7 updated successfully in "articles"');
      expect(text(result)).toContain('"title": "Edited"');
    });

    it('returns an error message when the client rejects', async () => {
      const stub = makeClientStub();
      stub.updateItem.mockRejectedValue(new Error('update boom'));
      const tools = new CollectionTools(stub);

      const result = await tools.updateItem({ collection: 'articles', id: 7, data: {} });
      expect(text(result)).toContain('Error updating item 7 in collection "articles": update boom');
    });
  });

  describe('deleteItems', () => {
    it('returns a warning without confirm and does not delete', async () => {
      const stub = makeClientStub();
      const tools = new CollectionTools(stub);

      const result = await tools.deleteItems({ collection: 'articles', ids: [1, 2] });
      const out = text(result);

      expect(out).toContain('permanently delete 2 item(s) from collection "articles"');
      expect(out).toContain('Items to delete: 1, 2');
      expect(out).not.toContain('Related items that will be affected');
      expect(out).toContain('confirm: true');
      expect(stub.deleteItems).not.toHaveBeenCalled();
    });

    it('lists related items in the warning when cascadeDelete is requested', async () => {
      const stub = makeClientStub();
      stub.getRelations.mockResolvedValue(envelope(RELATIONS));
      stub.getItems.mockResolvedValue(envelope([], { total_count: 4 }));
      const tools = new CollectionTools(stub);

      const result = await tools.deleteItems({ collection: 'articles', ids: [1], cascadeDelete: true });
      const out = text(result);

      expect(out).toContain('Related items that will be affected');
      expect(out).toContain('- articles_tags: 4 items');
      expect(stub.getItems).toHaveBeenCalledWith('articles_tags', {
        filter: { articles_id: { _eq: 1 } },
        limit: 5,
        meta: ['total_count'],
      });
      expect(stub.deleteItems).not.toHaveBeenCalled();
    });

    it('reports no related items when counts are zero', async () => {
      const stub = makeClientStub();
      stub.getRelations.mockResolvedValue(envelope(RELATIONS));
      stub.getItems.mockResolvedValue(envelope([])); // no meta -> total_count undefined
      const tools = new CollectionTools(stub);

      const result = await tools.deleteItems({ collection: 'articles', ids: [1], cascadeDelete: true });
      expect(text(result)).toContain('No related items found.');
    });

    it('reports no related items when the relations payload has no data', async () => {
      const stub = makeClientStub();
      stub.getRelations.mockResolvedValue(envelope(null));
      const tools = new CollectionTools(stub);

      const result = await tools.deleteItems({ collection: 'articles', ids: [1], cascadeDelete: true });
      expect(text(result)).toContain('No related items found.');
      expect(stub.getItems).not.toHaveBeenCalled();
    });

    it('embeds an error string when the related-items check fails', async () => {
      const stub = makeClientStub();
      stub.getRelations.mockRejectedValue(new Error('relations boom'));
      const tools = new CollectionTools(stub);

      const result = await tools.deleteItems({ collection: 'articles', ids: [1], cascadeDelete: true });
      expect(text(result)).toContain('Error checking related items: relations boom');
    });

    it('deletes items directly when confirmed without cascade', async () => {
      const stub = makeClientStub();
      const tools = new CollectionTools(stub);

      const result = await tools.deleteItems({ collection: 'articles', ids: [1, 2], confirm: true });

      expect(stub.deleteItems).toHaveBeenCalledTimes(1);
      expect(stub.deleteItems).toHaveBeenCalledWith('articles', [1, 2]);
      expect(text(result)).toContain('Successfully deleted 2 item(s) from collection "articles"');
      expect(text(result)).not.toContain('with cascade');
    });

    it('cascade deletes related child items before the main items', async () => {
      const stub = makeClientStub();
      stub.getRelations.mockResolvedValue(envelope(RELATIONS));
      stub.getItems.mockResolvedValue(envelope([{ id: 10 }, { id: 11 }]));
      const tools = new CollectionTools(stub);

      const result = await tools.deleteItems({
        collection: 'articles',
        ids: [1],
        confirm: true,
        cascadeDelete: true,
      });

      expect(stub.getItems).toHaveBeenCalledWith('articles_tags', {
        filter: { articles_id: { _eq: 1 } },
      });
      expect(stub.deleteItems.mock.calls[0]).toEqual(['articles_tags', [10, 11]]);
      expect(stub.deleteItems.mock.calls.at(-1)).toEqual(['articles', [1]]);
      expect(text(result)).toContain('Successfully deleted 1 item(s) from collection "articles" with cascade');
    });

    it('skips child deletes during cascade when no related items exist', async () => {
      const stub = makeClientStub();
      stub.getRelations.mockResolvedValue(envelope(RELATIONS));
      stub.getItems.mockResolvedValue(envelope([]));
      const tools = new CollectionTools(stub);

      await tools.deleteItems({ collection: 'articles', ids: [1], confirm: true, cascadeDelete: true });

      expect(stub.deleteItems).toHaveBeenCalledTimes(1);
      expect(stub.deleteItems).toHaveBeenCalledWith('articles', [1]);
    });

    it('cascades safely when relations or related data payloads are null', async () => {
      const stub = makeClientStub();
      stub.getRelations.mockResolvedValue(envelope(RELATIONS));
      stub.getItems.mockResolvedValue(envelope(null)); // data null -> relatedIds []
      const tools = new CollectionTools(stub);

      await tools.deleteItems({ collection: 'articles', ids: [1], confirm: true, cascadeDelete: true });
      expect(stub.deleteItems).toHaveBeenCalledTimes(1);
      expect(stub.deleteItems).toHaveBeenCalledWith('articles', [1]);

      // relations data null -> no related collections at all
      stub.getRelations.mockResolvedValue(envelope(null));
      stub.deleteItems.mockClear();
      await tools.deleteItems({ collection: 'articles', ids: [2], confirm: true, cascadeDelete: true });
      expect(stub.deleteItems).toHaveBeenCalledTimes(1);
      expect(stub.deleteItems).toHaveBeenCalledWith('articles', [2]);
    });

    it('returns an error message when the delete rejects', async () => {
      const stub = makeClientStub();
      stub.deleteItems.mockRejectedValue(new Error('del boom'));
      const tools = new CollectionTools(stub);

      const result = await tools.deleteItems({ collection: 'articles', ids: [1], confirm: true });
      expect(text(result)).toContain('Error deleting items from collection "articles": del boom');
    });
  });

  describe('createField', () => {
    it.each([
      ['string', 'input'],
      ['text', 'textarea'],
      ['boolean', 'toggle'],
      ['integer', 'input'],
      ['float', 'input'],
      ['date', 'datetime'],
      ['dateTime', 'datetime'],
      ['json', 'input-code'],
      ['csv', 'tags'],
      ['uuid', 'input'],
      ['geometry', 'map'],
      ['geometry.Point', 'map'],
    ] as const)('maps type %s to default interface %s', async (type, expectedInterface) => {
      const stub = makeClientStub();
      const tools = new CollectionTools(stub);

      const result = await tools.createField({ collection: 'articles', field: 'f1', type: type as any });

      expect(text(result)).toContain(`**Interface**: ${expectedInterface}`);
      const fieldData = stub.createField.mock.calls[0][1];
      expect(fieldData.meta.interface).toBe(expectedInterface);
    });

    it('falls back to input for an unknown type', async () => {
      const stub = makeClientStub();
      const tools = new CollectionTools(stub);

      const result = await tools.createField({ collection: 'articles', field: 'f1', type: 'mystery' as any });

      expect(text(result)).toContain('**Interface**: input');
    });

    it('assembles required/unique/note/validation/options into the field payload', async () => {
      const stub = makeClientStub();
      const tools = new CollectionTools(stub);

      const result = await tools.createField({
        collection: 'articles',
        field: 'slug',
        type: 'string' as any,
        interface: 'input' as any,
        required: true,
        unique: true,
        default_value: 'untitled',
        note: 'URL slug',
        validation: { _and: [{ slug: { _nnull: true } }] },
        options: { placeholder: 'my-slug' },
      });

      expect(stub.createField).toHaveBeenCalledWith('articles', {
        field: 'slug',
        type: 'string',
        meta: {
          interface: 'input',
          required: true,
          note: 'URL slug',
          validation: { _and: [{ slug: { _nnull: true } }] },
          options: { placeholder: 'my-slug' },
        },
        schema: {
          is_nullable: false,
          is_unique: true,
          default_value: 'untitled',
        },
      });
      const out = text(result);
      expect(out).toContain('Field Created');
      expect(out).toContain('**Required**: Yes');
      expect(out).toContain('**Unique**: Yes');
    });

    it('defaults required and unique to No', async () => {
      const stub = makeClientStub();
      const tools = new CollectionTools(stub);

      const result = await tools.createField({ collection: 'articles', field: 'f', type: 'string' as any });
      const fieldData = stub.createField.mock.calls[0][1];

      expect(fieldData.meta.required).toBe(false);
      expect(fieldData.schema.is_nullable).toBe(true);
      expect(fieldData.schema.is_unique).toBe(false);
      expect(text(result)).toContain('**Required**: No');
      expect(text(result)).toContain('**Unique**: No');
    });

    it('returns an error message when the client rejects', async () => {
      const stub = makeClientStub();
      stub.createField.mockRejectedValue(new Error('field boom'));
      const tools = new CollectionTools(stub);

      const result = await tools.createField({ collection: 'articles', field: 'f', type: 'string' as any });
      expect(text(result)).toContain('Error creating field "f" in collection "articles": field boom');
    });
  });

  describe('updateField', () => {
    it('sends only type when only type is provided', async () => {
      const stub = makeClientStub();
      const tools = new CollectionTools(stub);

      const result = await tools.updateField({ collection: 'articles', field: 'title', type: 'text' as any });

      expect(stub.updateField).toHaveBeenCalledWith('articles', 'title', { type: 'text' });
      expect(text(result)).toContain('Field Updated');
      expect(text(result)).toContain('**Changes**: type');
    });

    it('assembles only meta when only meta props are provided', async () => {
      const stub = makeClientStub();
      const tools = new CollectionTools(stub);

      await tools.updateField({
        collection: 'articles',
        field: 'title',
        interface: 'textarea' as any,
        note: 'long form',
        validation: { _and: [] },
        options: { trim: true },
      });

      expect(stub.updateField).toHaveBeenCalledWith('articles', 'title', {
        meta: {
          interface: 'textarea',
          note: 'long form',
          validation: { _and: [] },
          options: { trim: true },
        },
      });
    });

    it('assembles only schema when only schema props are provided', async () => {
      const stub = makeClientStub();
      const tools = new CollectionTools(stub);

      await tools.updateField({
        collection: 'articles',
        field: 'title',
        unique: true,
        default_value: 'untitled',
      });

      expect(stub.updateField).toHaveBeenCalledWith('articles', 'title', {
        schema: { is_unique: true, default_value: 'untitled' },
      });
    });

    it('puts required:false into both meta and schema', async () => {
      const stub = makeClientStub();
      const tools = new CollectionTools(stub);

      await tools.updateField({ collection: 'articles', field: 'title', required: false });

      expect(stub.updateField).toHaveBeenCalledWith('articles', 'title', {
        meta: { required: false },
        schema: { is_nullable: true },
      });
    });

    it('assembles type, meta and schema together', async () => {
      const stub = makeClientStub();
      const tools = new CollectionTools(stub);

      const result = await tools.updateField({
        collection: 'articles',
        field: 'title',
        type: 'string' as any,
        interface: 'input' as any,
        required: true,
        unique: false,
        default_value: null,
        note: 'n',
        validation: { v: 1 },
        options: { o: 1 },
      });

      expect(stub.updateField).toHaveBeenCalledWith('articles', 'title', {
        type: 'string',
        meta: {
          interface: 'input',
          required: true,
          note: 'n',
          validation: { v: 1 },
          options: { o: 1 },
        },
        schema: {
          is_nullable: false,
          is_unique: false,
          default_value: null,
        },
      });
      expect(text(result)).toContain('**Changes**:');
    });

    it('returns an error message when the client rejects', async () => {
      const stub = makeClientStub();
      stub.updateField.mockRejectedValue(new Error('uf boom'));
      const tools = new CollectionTools(stub);

      const result = await tools.updateField({ collection: 'articles', field: 'title', note: 'x' });
      expect(text(result)).toContain('Error updating field "title" in collection "articles": uf boom');
    });
  });

  describe('deleteField', () => {
    it('warns without confirm and lists relations matching collection.field', async () => {
      const stub = makeClientStub();
      stub.getRelations.mockResolvedValue(envelope(RELATIONS));
      const tools = new CollectionTools(stub);

      const result = await tools.deleteField({ collection: 'articles', field: 'author' });
      const out = text(result);

      expect(out).toContain('permanently delete field "author" from collection "articles"');
      expect(out).toContain('used in 1 relation(s)');
      expect(out).toContain('- articles.author → authors');
      expect(stub.deleteField).not.toHaveBeenCalled();
    });

    it('warns about relations matching via related_collection + one_field', async () => {
      const stub = makeClientStub();
      stub.getRelations.mockResolvedValue(envelope(RELATIONS));
      const tools = new CollectionTools(stub);

      const result = await tools.deleteField({ collection: 'authors', field: 'articles' });
      const out = text(result);

      expect(out).toContain('used in 1 relation(s)');
      expect(out).toContain('- articles.author → authors');
      expect(stub.deleteField).not.toHaveBeenCalled();
    });

    it('warns without a relation list when the field is unrelated', async () => {
      const stub = makeClientStub();
      stub.getRelations.mockResolvedValue(envelope(RELATIONS));
      const tools = new CollectionTools(stub);

      const result = await tools.deleteField({ collection: 'tags', field: 'name' });
      const out = text(result);

      expect(out).toContain('permanently delete field "name"');
      expect(out).not.toContain('used in');
      expect(out).toContain('confirm: true');
    });

    it('warns without a relation list when the relations payload has no data', async () => {
      const stub = makeClientStub();
      stub.getRelations.mockResolvedValue(envelope(null));
      const tools = new CollectionTools(stub);

      const result = await tools.deleteField({ collection: 'articles', field: 'author' });
      expect(text(result)).toContain('permanently delete field "author"');
      expect(text(result)).not.toContain('used in');
      expect(stub.deleteField).not.toHaveBeenCalled();
    });

    it('deletes the field when confirm is true without consulting relations', async () => {
      const stub = makeClientStub();
      const tools = new CollectionTools(stub);

      const result = await tools.deleteField({ collection: 'articles', field: 'author', confirm: true });

      expect(stub.deleteField).toHaveBeenCalledWith('articles', 'author');
      expect(stub.getRelations).not.toHaveBeenCalled();
      expect(text(result)).toContain('Field "author" has been deleted from collection "articles"');
    });

    it('returns an error message when the delete rejects', async () => {
      const stub = makeClientStub();
      stub.deleteField.mockRejectedValue(new Error('df boom'));
      const tools = new CollectionTools(stub);

      const result = await tools.deleteField({ collection: 'articles', field: 'author', confirm: true });
      expect(text(result)).toContain('Error deleting field "author" from collection "articles": df boom');
    });

    it('returns an error message when the relations check rejects', async () => {
      const stub = makeClientStub();
      stub.getRelations.mockRejectedValue(new Error('rel boom'));
      const tools = new CollectionTools(stub);

      const result = await tools.deleteField({ collection: 'articles', field: 'author' });
      expect(text(result)).toContain('Error deleting field "author" from collection "articles": rel boom');
    });
  });

  describe('bulkOperations', () => {
    it('executes create, update and delete operations', async () => {
      const stub = makeClientStub();
      stub.createItem.mockResolvedValue(envelope({ id: 100 }));
      stub.updateItem.mockResolvedValue(envelope({ id: 1, title: 'upd' }));
      const tools = new CollectionTools(stub);

      const result = await tools.bulkOperations({
        collection: 'articles',
        operations: {
          create: [{ title: 'a' }, { title: 'b' }],
          update: [{ id: 1, title: 'upd' }],
          delete: [2, 3],
        },
      });
      const out = text(result);

      expect(out).toContain('Bulk Operations Completed');
      expect(out).toContain('**Created**: 2');
      expect(out).toContain('**Updated**: 1');
      expect(out).toContain('**Deleted**: 2');
      expect(out).toContain('**Errors**: 0');
      expect(stub.createItem).toHaveBeenCalledTimes(2);
      expect(stub.updateItem).toHaveBeenCalledWith('articles', 1, { title: 'upd' });
      expect(stub.deleteItems).toHaveBeenCalledWith('articles', [2, 3]);
    });

    it('passes validation and executes when payloads are valid', async () => {
      const stub = makeClientStub();
      stub.getFields.mockResolvedValue(envelope(FIELDS_ARTICLES));
      stub.createItem.mockResolvedValue(envelope({ id: 9 }));
      const tools = new CollectionTools(stub);

      const result = await tools.bulkOperations({
        collection: 'articles',
        operations: {
          create: [{ id: 9, title: 'valid' }],
          update: [{ id: 1, status: 'published' }],
        },
        validate: true,
      });
      const out = text(result);

      expect(out).toContain('Bulk Operations Completed');
      expect(out).toContain('**Created**: 1');
      expect(out).toContain('**Updated**: 1');
      expect(stub.getFields).toHaveBeenCalledWith('articles');
    });

    it('fails validation when an update operation is missing id', async () => {
      const stub = makeClientStub();
      stub.getFields.mockResolvedValue(envelope(FIELDS_ARTICLES));
      const tools = new CollectionTools(stub);

      const result = await tools.bulkOperations({
        collection: 'articles',
        operations: { update: [{ title: 'no id' } as any] },
        validate: true,
      });
      const out = text(result);

      expect(out).toContain('Validation Failed');
      expect(out).toContain('Update operation 0: Missing required "id" field');
      expect(stub.updateItem).not.toHaveBeenCalled();
      expect(stub.createItem).not.toHaveBeenCalled();
      expect(stub.deleteItems).not.toHaveBeenCalled();
    });

    it('fails validation when a create operation misses required fields', async () => {
      const stub = makeClientStub();
      stub.getFields.mockResolvedValue(envelope(FIELDS_ARTICLES));
      const tools = new CollectionTools(stub);

      const result = await tools.bulkOperations({
        collection: 'articles',
        operations: { create: [{ status: 'draft' }] },
        validate: true,
      });
      const out = text(result);

      expect(out).toContain('Validation Failed');
      expect(out).toContain('Create operation 0: Missing required field "title"');
      expect(stub.createItem).not.toHaveBeenCalled();
    });

    it('passes validation when the fields payload has no data', async () => {
      const stub = makeClientStub();
      stub.getFields.mockResolvedValue(envelope(null));
      stub.createItem.mockResolvedValue(envelope({ id: 1 }));
      const tools = new CollectionTools(stub);

      const result = await tools.bulkOperations({
        collection: 'articles',
        operations: { create: [{ anything: true }] },
        validate: true,
      });

      expect(text(result)).toContain('Bulk Operations Completed');
      expect(text(result)).toContain('**Created**: 1');
    });

    it('fails validation when the schema lookup rejects', async () => {
      const stub = makeClientStub();
      stub.getFields.mockRejectedValue(new Error('fields boom'));
      const tools = new CollectionTools(stub);

      const result = await tools.bulkOperations({
        collection: 'articles',
        operations: { create: [{ title: 'x' }] },
        validate: true,
      });
      const out = text(result);

      expect(out).toContain('Validation Failed');
      expect(out).toContain('Validation error: fields boom');
      expect(stub.createItem).not.toHaveBeenCalled();
    });

    it('accumulates per-operation errors without aborting the batch', async () => {
      const stub = makeClientStub();
      stub.createItem.mockRejectedValue(new Error('create failed'));
      stub.updateItem.mockRejectedValue(new Error('update failed'));
      stub.deleteItems.mockRejectedValue(new Error('delete failed'));
      const tools = new CollectionTools(stub);

      const result = await tools.bulkOperations({
        collection: 'articles',
        operations: {
          create: [{ title: 'a' }],
          update: [{ id: 1, title: 'b' }],
          delete: [2],
        },
      });
      const out = text(result);

      expect(out).toContain('**Errors**: 3');
      expect(out).toContain('- create: create failed');
      expect(out).toContain('- update: update failed');
      expect(out).toContain('- delete: delete failed');
      expect(out).toContain('**Created**: 0');
      expect(out).toContain('**Updated**: 0');
      expect(out).toContain('**Deleted**: 0');
    });

    it('returns an error message when operations are malformed', async () => {
      const stub = makeClientStub();
      const tools = new CollectionTools(stub);

      const result = await tools.bulkOperations({
        collection: 'articles',
        operations: undefined as any,
      });

      expect(text(result)).toContain('Error executing bulk operations on collection "articles"');
    });
  });
});
