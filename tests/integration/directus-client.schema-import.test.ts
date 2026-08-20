// Integration tests for the Directus 12.2/12.3 client methods: schema
// snapshot/diff/apply, data import, and cache clear.
//
// These run over real sockets against MockDirectus rather than through
// makeClientStub(), because the tool-layer tests stub the client entirely and
// therefore never exercise these methods' own request-building or their 204
// handling — the exact path that broke during the SDK transport migration.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { DirectusClient } from '../../src/client/directus-client.js';
import { startMockDirectus, type MockDirectus } from '../helpers/mock-directus.js';

let mock: MockDirectus;

function makeClient(): DirectusClient {
  return new DirectusClient({
    url: mock.url,
    token: 'schema-token',
    retries: 1,
    retryDelay: 1,
    maxRetryDelay: 5,
    timeout: 5000,
  });
}

beforeAll(async () => {
  mock = await startMockDirectus();
});
afterEach(() => mock.reset());
afterAll(async () => {
  await mock.stop();
});

describe('getSchemaSnapshot', () => {
  it('requests a full snapshot when given no options', async () => {
    const res = await makeClient().getSchemaSnapshot();
    const req = mock.lastRequest('GET', '/schema/snapshot');

    expect(req?.query.includeCollections).toBeUndefined();
    expect(req?.query.excludeCollections).toBeUndefined();
    // Directus reports a full snapshot as version 1.
    expect(res.data.version).toBe(1);
  });

  it('requests a partial snapshot for includeCollections', async () => {
    const res = await makeClient().getSchemaSnapshot({ includeCollections: ['articles'] });
    const req = mock.lastRequest('GET', '/schema/snapshot');

    expect(req?.query.includeCollections).toBe('articles');
    // A partial snapshot is version 2 — the 12.2.0 addition.
    expect(res.data.version).toBe(2);
    expect(res.data.collections.map((c: any) => c.collection)).toEqual(['articles']);
  });

  it('requests a partial snapshot for excludeCollections', async () => {
    const res = await makeClient().getSchemaSnapshot({ excludeCollections: ['articles'] });
    const req = mock.lastRequest('GET', '/schema/snapshot');

    expect(req?.query.excludeCollections).toBe('articles');
    expect(res.data.version).toBe(2);
    expect(res.data.collections.map((c: any) => c.collection)).not.toContain('articles');
  });

  it('rejects include and exclude together without issuing a request', async () => {
    await expect(
      makeClient().getSchemaSnapshot({ includeCollections: ['a'], excludeCollections: ['b'] })
    ).rejects.toMatchObject({ extensions: { code: 'INVALID_PAYLOAD' } });

    expect(mock.lastRequest('GET', '/schema/snapshot')).toBeUndefined();
  });

  it('treats empty arrays as "no filter" rather than a partial snapshot', async () => {
    const res = await makeClient().getSchemaSnapshot({
      includeCollections: [],
      excludeCollections: [],
    });
    const req = mock.lastRequest('GET', '/schema/snapshot');

    expect(req?.query.includeCollections).toBeUndefined();
    expect(res.data.version).toBe(1);
  });
});

describe('diffSchema', () => {
  const snapshot = { version: 1, directus: '12.3.0', collections: [{ collection: 'articles' }] } as any;

  it('posts the snapshot and returns the diff', async () => {
    const res = await makeClient().diffSchema(snapshot);
    const req = mock.lastRequest('POST', '/schema/diff');

    expect(req?.body).toMatchObject({ version: 1 });
    expect(res.data?.hash).toBe('diff-hash');
  });

  it('passes mode through so merge omits deletions', async () => {
    const merge = await makeClient().diffSchema(snapshot, { mode: 'merge' });
    expect(mock.lastRequest('POST', '/schema/diff')?.query.mode).toBe('merge');
    expect(merge.data?.diff.collections).toHaveLength(1);

    mock.reset();

    const mirror = await makeClient().diffSchema(snapshot, { mode: 'mirror' });
    expect(mock.lastRequest('POST', '/schema/diff')?.query.mode).toBe('mirror');
    // mirror reports deletions that merge suppresses
    expect(mirror.data?.diff.collections).toHaveLength(2);
  });

  it('passes force through', async () => {
    await makeClient().diffSchema(snapshot, { force: true });
    expect(mock.lastRequest('POST', '/schema/diff')?.query.force).toBe('true');
  });

  it('surfaces the 204 "no difference" answer as null data', async () => {
    // The mock answers 204 (no content-type) when the snapshot has no
    // collections, matching Directus. This is the path that threw
    // "Unexpected end of JSON input" before the transport normalised 204s.
    const res = await makeClient().diffSchema({ collections: [] } as any);
    expect(res.data).toBeNull();
  });
});

describe('applySchema', () => {
  const diff = { hash: 'diff-hash', diff: { collections: [], fields: [], relations: [] } } as any;

  it('posts the diff and handles the 204 answer', async () => {
    const res = await makeClient().applySchema(diff);
    const req = mock.lastRequest('POST', '/schema/apply');

    expect(req?.body).toMatchObject({ hash: 'diff-hash' });
    expect(res.data).toBeNull();
  });

  it('passes force through', async () => {
    await makeClient().applySchema(diff, true);
    expect(mock.lastRequest('POST', '/schema/apply')?.query.force).toBe('true');
  });
});

describe('importData', () => {
  function formData(): FormData {
    const fd = new FormData();
    fd.append('file', new Blob(['[{"id":1}]'], { type: 'application/json' }), 'data.json');
    return fd;
  }

  it('posts multipart form data to the per-collection endpoint', async () => {
    const res = await makeClient().importData('articles', formData());
    const req = mock.lastRequest('POST', '/utils/import/articles');

    expect(req).toBeDefined();
    expect(req?.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/);
    expect(res.data).toBeNull();
  });
});

describe('importDataBatch', () => {
  function formData(): FormData {
    const fd = new FormData();
    fd.append('file', new Blob(['[{"id":1}]'], { type: 'application/json' }), 'data.json');
    return fd;
  }

  it('posts to the batch endpoint and returns the per-collection report', async () => {
    const res = await makeClient().importDataBatch(formData());
    const req = mock.lastRequest('POST', '/utils/import');

    expect(req).toBeDefined();
    expect(res.data.collections.articles).toMatchObject({ existing: [1], new: [2, 3] });
  });

  it('passes mode, dryRun and dangerouslyAllowDelete through', async () => {
    const res = await makeClient().importDataBatch(formData(), {
      mode: 'merge',
      dryRun: true,
      dangerouslyAllowDelete: true,
    });
    const req = mock.lastRequest('POST', '/utils/import');

    expect(req?.query.mode).toBe('merge');
    expect(req?.query.dryRun).toBe('true');
    expect(req?.query.dangerouslyAllowDelete).toBe('true');
    // dry runs report the plan without applying it
    expect(res.data.applied).toBe(false);
  });
});

describe('clearCache', () => {
  it('posts to /utils/cache/clear and handles the 204 answer', async () => {
    const res = await makeClient().clearCache();

    expect(mock.lastRequest('POST', '/utils/cache/clear')).toBeDefined();
    expect(res.data).toBeNull();
  });
});
