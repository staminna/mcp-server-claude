// Unit tests for src/tools/diagnostic-tools.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DiagnosticTools } from '../../src/tools/diagnostic-tools.js';
import { logger } from '../../src/utils/logger.js';
import { makeClientStub } from '../helpers/stubs.js';
import {
  envelope,
  COLLECTIONS,
  FIELDS_ARTICLES,
  RELATIONS,
  ITEMS_ARTICLES,
} from '../helpers/fixtures.js';

function textOf(result: any): string {
  return result.content[0].text as string;
}

describe('DiagnosticTools', () => {
  beforeEach(() => {
    // Silence the singleton logger's stderr JSON lines.
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('diagnoseCollectionAccess', () => {
    it('reports HEALTHY when every test passes with all toggles enabled', async () => {
      const stub = makeClientStub();
      stub.getCollections.mockResolvedValue(envelope(COLLECTIONS));
      stub.getCollection.mockResolvedValue(envelope(COLLECTIONS[0]));
      stub.getFields.mockResolvedValue(envelope(FIELDS_ARTICLES));
      stub.getRelations.mockResolvedValue(envelope(RELATIONS));
      stub.getItems.mockResolvedValue(envelope(ITEMS_ARTICLES, { total_count: 3 }));
      stub.getUsers.mockResolvedValue(
        envelope({ id: 'u1', role: { name: 'Admin', admin_access: true } })
      );

      const tools = new DiagnosticTools(stub);
      const result = await tools.diagnoseCollectionAccess({
        collection: 'articles',
        includeFields: true,
        includeRelations: true,
        includePermissions: true,
      });

      const text = textOf(result);
      expect(text).toContain('Collection Access Diagnostics for "articles"');
      expect(text).toContain('HEALTHY');
      expect(text).toContain('✅');
      expect(text).toContain('100%');
      expect(text).toContain('(6/6 tests passed)');
      expect(text).toContain('Collection "articles" found in collections list');
      expect(text).toContain('Successfully accessed collection "articles" directly');
      expect(text).toContain('Successfully retrieved 4 fields for collection "articles"');
      expect(text).toContain('relations for collection "articles"');
      expect(text).toContain('Successfully accessed items in collection "articles"');
      expect(text).toContain('Current user has access');
      expect(text).toContain('• All tests passed - collection is fully accessible');
      // m2m vs m2o classification in the JSON dump
      expect(text).toContain('"type": "m2m"');
      expect(text).toContain('"type": "m2o"');

      expect(stub.getFields).toHaveBeenCalledWith('articles');
      expect(stub.getItems).toHaveBeenCalledWith('articles', { limit: 1 });
      expect(stub.getUsers).toHaveBeenCalledWith({ limit: 1 });
    });

    it('skips fields/relations/permissions tests when toggles are off', async () => {
      const stub = makeClientStub();
      stub.getCollections.mockResolvedValue(envelope(COLLECTIONS));
      stub.getCollection.mockResolvedValue(envelope(COLLECTIONS[0]));
      stub.getItems.mockResolvedValue(envelope(ITEMS_ARTICLES));

      const tools = new DiagnosticTools(stub);
      const result = await tools.diagnoseCollectionAccess({ collection: 'articles' });

      const text = textOf(result);
      expect(text).toContain('HEALTHY');
      expect(text).toContain('(3/3 tests passed)');
      expect(text).not.toContain('Fields Access');
      expect(text).not.toContain('Relations Access');
      expect(text).not.toContain('User Permissions');
      expect(stub.getFields).not.toHaveBeenCalled();
      expect(stub.getRelations).not.toHaveBeenCalled();
      expect(stub.getUsers).not.toHaveBeenCalled();
    });

    it('reports PARTIAL when the collection is missing from the collections list', async () => {
      // Default stub: getCollections resolves envelope([]) -> not found,
      // getCollection and getItems resolve -> 2/3 pass.
      const stub = makeClientStub();

      const tools = new DiagnosticTools(stub);
      const result = await tools.diagnoseCollectionAccess({ collection: 'ghost' });

      const text = textOf(result);
      expect(text).toContain('PARTIAL');
      expect(text).toContain('⚠️');
      expect(text).toContain('(2/3 tests passed)');
      expect(text).toContain('Collection "ghost" NOT found in collections list');
      expect(text).toContain('• Collection may not be properly created or indexed');
      expect(text).toContain('• Try refreshing the collections cache');
    });

    it('reports FAILED with recommendations when all base tests reject', async () => {
      const stub = makeClientStub();
      stub.getCollections.mockRejectedValue(new Error('list boom'));
      stub.getCollection.mockRejectedValue(new Error('direct boom'));
      stub.getItems.mockRejectedValue(new Error('items boom'));

      const tools = new DiagnosticTools(stub);
      const result = await tools.diagnoseCollectionAccess({ collection: 'articles' });

      const text = textOf(result);
      expect(text).toContain('FAILED');
      expect(text).toContain('❌');
      expect(text).toContain('(0/3 tests passed)');
      expect(text).toContain('Error fetching collections list: list boom');
      expect(text).toContain('Failed to access collection "articles" directly: direct boom');
      expect(text).toContain('Failed to access items in collection "articles": items boom');
      expect(text).toContain('• Collection may have permission restrictions');
      expect(text).toContain('• Verify collection name spelling and case sensitivity');
      expect(text).toContain('• Collection exists but item access is restricted');
      expect(text).toContain('• Verify read permissions for the collection');
    });

    it('captures failures of fields, relations and permissions tests', async () => {
      const stub = makeClientStub();
      stub.getCollections.mockResolvedValue(envelope(COLLECTIONS));
      stub.getCollection.mockResolvedValue(envelope(COLLECTIONS[0]));
      stub.getItems.mockResolvedValue(envelope(ITEMS_ARTICLES));
      stub.getFields.mockRejectedValue(new Error('fields denied'));
      stub.getRelations.mockRejectedValue(new Error('relations denied'));
      stub.getUsers.mockRejectedValue(new Error('users denied'));

      const tools = new DiagnosticTools(stub);
      const result = await tools.diagnoseCollectionAccess({
        collection: 'articles',
        includeFields: true,
        includeRelations: true,
        includePermissions: true,
      });

      const text = textOf(result);
      // 3 of 6 passed -> not strictly more than half -> FAILED
      expect(text).toContain('FAILED');
      expect(text).toContain('(3/6 tests passed)');
      expect(text).toContain('Failed to retrieve fields for collection "articles": fields denied');
      expect(text).toContain(
        'Failed to retrieve relations for collection "articles": relations denied'
      );
      expect(text).toContain('Failed to get user permissions: users denied');
      expect(text).toContain('• Collection may exist but fields are not accessible');
      expect(text).toContain('• Check field-level permissions');
      expect(text).toContain('• User authentication or role issues detected');
      expect(text).toContain('• Verify admin access and token validity');
    });

    it('handles responses with missing data arrays gracefully', async () => {
      const stub = makeClientStub();
      stub.getCollections.mockResolvedValue({} as any);
      stub.getFields.mockResolvedValue({} as any);
      stub.getRelations.mockResolvedValue({} as any);
      stub.getItems.mockResolvedValue({} as any);

      const tools = new DiagnosticTools(stub);
      const result = await tools.diagnoseCollectionAccess({
        collection: 'articles',
        includeFields: true,
        includeRelations: true,
      });

      const text = textOf(result);
      expect(text).toContain('Collection "articles" NOT found in collections list');
      expect(text).toContain('Successfully retrieved 0 fields for collection "articles"');
      expect(text).toContain('Found 0 relations for collection "articles"');
      // 4/5 passed -> PARTIAL
      expect(text).toContain('PARTIAL');
      expect(text).toContain('(4/5 tests passed)');
    });

    it('returns an error message when an unexpected error escapes the test runners', async () => {
      vi.spyOn(logger, 'toolStart').mockImplementation(() => {
        throw new Error('logger exploded');
      });
      const stub = makeClientStub();

      const tools = new DiagnosticTools(stub);
      const result = await tools.diagnoseCollectionAccess({ collection: 'articles' });

      expect(textOf(result)).toContain(
        'Error diagnosing collection access for "articles": logger exploded'
      );
      expect(stub.getCollections).not.toHaveBeenCalled();
    });
  });

  describe('refreshCollectionCache', () => {
    it('refreshes without a specific collection and tolerates missing data', async () => {
      const stub = makeClientStub();
      stub.getCollections.mockResolvedValue({} as any);

      const tools = new DiagnosticTools(stub);
      const result = await tools.refreshCollectionCache({});

      const text = textOf(result);
      expect(text).toContain('Collection Cache Refresh');
      expect(text).toContain('**Operations**: 2/2 successful');
      expect(text).toContain('clear_cache');
      expect(text).toContain('Successfully cleared Directus cache');
      expect(text).toContain('Refreshed collections list (0 collections found)');
      expect(stub.getCollection).not.toHaveBeenCalled();
    });

    it('verifies a specific collection after refresh', async () => {
      const stub = makeClientStub();
      stub.getCollections.mockResolvedValue(envelope(COLLECTIONS));
      stub.getCollection.mockResolvedValue(envelope(COLLECTIONS[0]));

      const tools = new DiagnosticTools(stub);
      const result = await tools.refreshCollectionCache({ collection: 'articles' });

      const text = textOf(result);
      expect(text).toContain('**Operations**: 3/3 successful');
      expect(text).toContain(`Refreshed collections list (${COLLECTIONS.length} collections found)`);
      expect(text).toContain('Successfully verified collection "articles" after refresh');
      expect(stub.getCollection).toHaveBeenCalledWith('articles');
    });

    it('reports the verification failure when the collection is still inaccessible', async () => {
      const stub = makeClientStub();
      stub.getCollections.mockResolvedValue(envelope(COLLECTIONS));
      stub.getCollection.mockRejectedValue(new Error('still hidden'));

      const tools = new DiagnosticTools(stub);
      const result = await tools.refreshCollectionCache({ collection: 'ghost' });

      const text = textOf(result);
      expect(text).toContain('**Operations**: 2/3 successful');
      expect(text).toContain(
        'Collection "ghost" still not accessible after refresh: still hidden'
      );
      expect(text).toContain('❌');
    });

    it('records a failed collections refresh', async () => {
      const stub = makeClientStub();
      stub.getCollections.mockRejectedValue(new Error('net down'));

      const tools = new DiagnosticTools(stub);
      const result = await tools.refreshCollectionCache({});

      const text = textOf(result);
      expect(text).toContain('**Operations**: 1/2 successful');
      expect(text).toContain('Failed to refresh collections: net down');
    });

    it('returns an error message when an unexpected error occurs', async () => {
      vi.spyOn(logger, 'toolStart').mockImplementation(() => {
        throw new Error('logger exploded');
      });
      const stub = makeClientStub();

      const tools = new DiagnosticTools(stub);
      const result = await tools.refreshCollectionCache({ collection: 'articles' });

      expect(textOf(result)).toContain('Error refreshing collection cache: logger exploded');
    });
  });

  describe('validateCollectionCreation', () => {
    it('reports FULLY_ACCESSIBLE when the collection is immediately available', async () => {
      const stub = makeClientStub();
      stub.getCollection.mockResolvedValue(envelope(COLLECTIONS[0]));
      stub.getCollections.mockResolvedValue(envelope(COLLECTIONS));

      const tools = new DiagnosticTools(stub);
      const result = await tools.validateCollectionCreation({
        collection: 'articles',
        waitTime: 1,
      });

      const text = textOf(result);
      expect(text).toContain('Collection Creation Validation for "articles"');
      expect(text).toContain('FULLY_ACCESSIBLE');
      expect(text).toContain('✅');
      expect(text).toContain('(3/3 steps passed)');
      expect(text).toContain('Collection "articles" immediately accessible');
      expect(text).toContain('Collection "articles" accessible after 1ms delay');
      expect(text).toContain('Collection "articles" found in collections list');
      expect(text).toContain('• Collection is fully accessible');
      expect(text).toContain('immediate_check');
      expect(text).toContain('waiting_1ms');
      expect(text).toContain('delayed_check');
      expect(stub.getCollection).toHaveBeenCalledTimes(2);
    });

    it('reports PARTIALLY_ACCESSIBLE when access only succeeds after the delay', async () => {
      const stub = makeClientStub();
      stub.getCollection
        .mockRejectedValueOnce(new Error('not yet'))
        .mockResolvedValue(envelope(COLLECTIONS[0]));
      stub.getCollections.mockResolvedValue(envelope(COLLECTIONS));

      const tools = new DiagnosticTools(stub);
      const result = await tools.validateCollectionCreation({
        collection: 'articles',
        waitTime: 1,
      });

      const text = textOf(result);
      expect(text).toContain('PARTIALLY_ACCESSIBLE');
      expect(text).toContain('⚠️');
      expect(text).toContain('(2/3 steps passed)');
      expect(text).toContain('Collection "articles" not immediately accessible: not yet');
      expect(text).toContain('Collection "articles" accessible after 1ms delay');
      expect(text).toContain('• Collection may need more time to propagate');
      expect(text).toContain('• Consider clearing cache and retrying');
    });

    it('reports NOT_ACCESSIBLE when every step fails', async () => {
      const stub = makeClientStub();
      stub.getCollection.mockRejectedValue(new Error('nope'));
      stub.getCollections.mockRejectedValue(new Error('list down'));

      const tools = new DiagnosticTools(stub);
      const result = await tools.validateCollectionCreation({
        collection: 'ghost',
        waitTime: 1,
      });

      const text = textOf(result);
      expect(text).toContain('NOT_ACCESSIBLE');
      expect(text).toContain('❌');
      expect(text).toContain('(0/3 steps passed)');
      expect(text).toContain('Collection "ghost" not immediately accessible: nope');
      expect(text).toContain('Collection "ghost" still not accessible after 1ms: nope');
      expect(text).toContain('Error checking collections list: list down');
      expect(text).toContain('• Check Directus server logs for errors');
      expect(text).toContain('• Verify collection was created successfully');
    });

    it('flags a collection that is accessible but missing from the collections list', async () => {
      const stub = makeClientStub();
      stub.getCollection.mockResolvedValue(envelope(COLLECTIONS[0]));
      // default getCollections resolves envelope([]) -> not found

      const tools = new DiagnosticTools(stub);
      const result = await tools.validateCollectionCreation({
        collection: 'orphan',
        waitTime: 1,
      });

      const text = textOf(result);
      expect(text).toContain('PARTIALLY_ACCESSIBLE');
      expect(text).toContain('(2/3 steps passed)');
      expect(text).toContain('Collection "orphan" NOT found in collections list');
    });

    it('returns an error message when an unexpected error occurs', async () => {
      vi.spyOn(logger, 'toolStart').mockImplementation(() => {
        throw new Error('logger exploded');
      });
      const stub = makeClientStub();

      const tools = new DiagnosticTools(stub);
      const result = await tools.validateCollectionCreation({
        collection: 'ghost',
        waitTime: 1,
      });

      expect(textOf(result)).toContain(
        'Error validating collection creation for "ghost": logger exploded'
      );
      expect(stub.getCollection).not.toHaveBeenCalled();
    });
  });
});
