// Unit tests for src/client/directus-client.ts using the shared MSW harness.
// All HTTP traffic is intercepted at http://directus.test — no real network.

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
  type MockInstance,
} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DirectusClient } from '../../src/client/directus-client.js';
import { SERVER_NAME, SERVER_VERSION } from '../../src/version.js';
import { server, http, HttpResponse, DIRECTUS_URL } from '../helpers/msw.js';
import {
  envelope,
  directusError,
  COLLECTIONS,
  ITEMS_ARTICLES,
  FILES,
  SERVER_INFO,
} from '../helpers/fixtures.js';

const UPLOAD_FIXTURE = fileURLToPath(new URL('../helpers/files/upload.txt', import.meta.url));

function makeClient(overrides: Record<string, any> = {}): DirectusClient {
  return new DirectusClient({
    url: DIRECTUS_URL,
    token: 'test-token',
    retries: 2,
    retryDelay: 1,
    maxRetryDelay: 5,
    timeout: 5000,
    ...overrides,
  });
}

interface SeenRequest {
  method: string;
  url: URL;
  body: string;
}

/** Prepend a catch-all handler that records every request the server sees. */
function recordAll(): SeenRequest[] {
  const seen: SeenRequest[] = [];
  server.use(
    http.all(`${DIRECTUS_URL}/*`, async ({ request }) => {
      seen.push({ method: request.method, url: new URL(request.url), body: await request.text() });
      return HttpResponse.json(envelope({ ok: true }));
    })
  );
  return seen;
}

let stderrSpy: MockInstance;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  // The axios interceptors log 4xx/5xx responses at ERROR level (singleton
  // logger -> process.stderr). Silence it so error-path tests stay quiet.
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});
afterEach(() => {
  stderrSpy.mockRestore();
  server.resetHandlers();
});
afterAll(() => server.close());

describe('constructor and auth', () => {
  it('applies defaults when only url is provided', () => {
    const client = new DirectusClient({ url: DIRECTUS_URL });
    const cfg = (client as any).config;
    expect(cfg.timeout).toBe(30000);
    expect(cfg.retries).toBe(3);
    expect(cfg.retryDelay).toBe(1000);
    expect(cfg.maxRetryDelay).toBe(10000);
  });

  it('explicit config values override defaults', () => {
    const cfg = (makeClient() as any).config;
    expect(cfg.timeout).toBe(5000);
    expect(cfg.retries).toBe(2);
    expect(cfg.retryDelay).toBe(1);
    expect(cfg.maxRetryDelay).toBe(5);
    expect(cfg.url).toBe(DIRECTUS_URL);
    expect(cfg.token).toBe('test-token');
  });

  it('sends Bearer Authorization and User-Agent headers when token is configured', async () => {
    let auth: string | null = null;
    let userAgent: string | null = null;
    server.use(
      http.get(`${DIRECTUS_URL}/server/info`, ({ request }) => {
        auth = request.headers.get('authorization');
        userAgent = request.headers.get('user-agent');
        return HttpResponse.json(envelope(SERVER_INFO));
      })
    );

    await makeClient().getServerInfo();

    expect(auth).toBe('Bearer test-token');
    // Derived from the single source of truth so a version bump does not need a
    // test edit — what matters is the shape, not the literal number.
    expect(userAgent).toBe(`${SERVER_NAME}/${SERVER_VERSION}`);
  });

  it('omits the Authorization header when no token is configured', async () => {
    let auth: string | null = 'unset';
    server.use(
      http.get(`${DIRECTUS_URL}/server/info`, ({ request }) => {
        auth = request.headers.get('authorization');
        return HttpResponse.json(envelope(SERVER_INFO));
      })
    );

    await new DirectusClient({ url: DIRECTUS_URL }).getServerInfo();

    expect(auth).toBeNull();
  });
});

describe('query serialization', () => {
  it('serializes every supported option', async () => {
    let url: URL | undefined;
    server.use(
      http.get(`${DIRECTUS_URL}/items/articles`, ({ request }) => {
        url = new URL(request.url);
        return HttpResponse.json(envelope([]));
      })
    );

    await makeClient().getItems('articles', {
      fields: ['id', 'title'],
      filter: { status: { _eq: 'published' } },
      sort: ['-date_created', 'title'],
      limit: 10,
      offset: 5,
      page: 2,
      search: 'hello world',
      meta: ['total_count', 'filter_count'],
      deep: { author: { _limit: 1 } },
      alias: { writer: 'author' },
      aggregate: { count: '*' },
      groupBy: ['status', 'author'],
      export: 'csv',
    });

    const p = url!.searchParams;
    expect(p.get('fields')).toBe('id,title');
    expect(p.get('sort')).toBe('-date_created,title');
    expect(p.get('groupBy')).toBe('status,author');
    expect(p.get('meta')).toBe('total_count,filter_count');
    expect(JSON.parse(p.get('filter')!)).toEqual({ status: { _eq: 'published' } });
    expect(JSON.parse(p.get('deep')!)).toEqual({ author: { _limit: 1 } });
    expect(JSON.parse(p.get('alias')!)).toEqual({ writer: 'author' });
    expect(JSON.parse(p.get('aggregate')!)).toEqual({ count: '*' });
    expect(p.get('limit')).toBe('10');
    expect(p.get('offset')).toBe('5');
    expect(p.get('page')).toBe('2');
    expect(p.get('search')).toBe('hello world');
    expect(p.get('export')).toBe('csv');
  });

  it('sends no query string for empty options', async () => {
    let url: URL | undefined;
    server.use(
      http.get(`${DIRECTUS_URL}/items/articles`, ({ request }) => {
        url = new URL(request.url);
        return HttpResponse.json(envelope([]));
      })
    );

    await makeClient().getItems('articles');

    expect([...url!.searchParams.keys()]).toEqual([]);
  });

  it('sends limit: 0 (Directus returns counts with no items)', async () => {
    let url: URL | undefined;
    server.use(
      http.get(`${DIRECTUS_URL}/items/articles`, ({ request }) => {
        url = new URL(request.url);
        return HttpResponse.json(envelope([]));
      })
    );

    await makeClient().getItems('articles', { limit: 0 });

    // The previous axios query builder dropped limit: 0 on a truthiness check.
    // The SDK gates on limit >= -1, so 0 now reaches the wire — which is the
    // correct Directus semantics (no items, but meta counts still returned).
    expect(url!.searchParams.get('limit')).toBe('0');
  });
});

describe('core HTTP verbs return the Directus envelope', () => {
  it('get() returns the response envelope', async () => {
    const res = await makeClient().get('/collections');
    expect(res).toEqual({ data: COLLECTIONS });
  });

  it('post() returns the response envelope', async () => {
    server.use(
      http.post(`${DIRECTUS_URL}/items/articles`, async ({ request }) =>
        HttpResponse.json(envelope(await request.json()), { status: 200 })
      )
    );
    const res = await makeClient().post('/items/articles', { title: 'New' });
    expect(res).toEqual({ data: { title: 'New' } });
  });

  it('patch() returns the response envelope', async () => {
    server.use(
      http.patch(`${DIRECTUS_URL}/items/articles/1`, () =>
        HttpResponse.json(envelope({ id: 1, title: 'Edited' }))
      )
    );
    const res = await makeClient().patch('/items/articles/1', { title: 'Edited' });
    expect(res.data).toMatchObject({ id: 1, title: 'Edited' });
  });

  it('delete() returns the response envelope', async () => {
    server.use(
      http.delete(`${DIRECTUS_URL}/items/articles/1`, () => HttpResponse.json(envelope(null)))
    );
    const res = await makeClient().delete('/items/articles/1');
    expect(res).toEqual({ data: null });
  });
});

describe('retry behavior', () => {
  it('retries 500 responses and succeeds when the server recovers (500,500,200)', async () => {
    let calls = 0;
    server.use(
      http.get(`${DIRECTUS_URL}/items/articles`, () => {
        calls++;
        if (calls <= 2) {
          return HttpResponse.json(directusError('boom'), { status: 500 });
        }
        return HttpResponse.json(envelope(ITEMS_ARTICLES));
      })
    );

    const res = await makeClient().getItems('articles');

    expect(calls).toBe(3);
    expect(res.data).toEqual(ITEMS_ARTICLES);
  });

  it('retries 429 rate-limit responses', async () => {
    let calls = 0;
    server.use(
      http.get(`${DIRECTUS_URL}/server/info`, () => {
        calls++;
        if (calls === 1) {
          return HttpResponse.json(directusError('Too many requests', 'RATE_LIMIT'), { status: 429 });
        }
        return HttpResponse.json(envelope(SERVER_INFO));
      })
    );

    const res = await makeClient().getServerInfo();

    expect(calls).toBe(2);
    expect(res.data).toEqual(SERVER_INFO);
  });

  it('does NOT retry 404 responses', async () => {
    let calls = 0;
    server.use(
      http.get(`${DIRECTUS_URL}/items/missing`, () => {
        calls++;
        return HttpResponse.json(directusError('Item not found', 'ROUTE_NOT_FOUND'), { status: 404 });
      })
    );

    await expect(makeClient().getItems('missing')).rejects.toMatchObject({
      message: 'Item not found',
      extensions: { code: 'ROUTE_NOT_FOUND' },
    });
    expect(calls).toBe(1);
  });

  it('throws the parsed Directus error once retries are exhausted', async () => {
    let calls = 0;
    server.use(
      http.get(`${DIRECTUS_URL}/items/articles`, () => {
        calls++;
        return HttpResponse.json(
          directusError('Database is down', 'INTERNAL_SERVER_ERROR'),
          { status: 500 }
        );
      })
    );

    await expect(makeClient().getItems('articles')).rejects.toMatchObject({
      message: 'Database is down',
      extensions: { code: 'INTERNAL_SERVER_ERROR' },
    });
    // initial attempt + retries(2)
    expect(calls).toBe(3);
  });

  it('retries network errors and falls back to the axios error shape', async () => {
    let calls = 0;
    server.use(
      http.get(`${DIRECTUS_URL}/items/articles`, () => {
        calls++;
        return HttpResponse.error();
      })
    );

    const err: any = await makeClient().getItems('articles').catch((e) => e);

    expect(calls).toBe(3);
    expect(typeof err.message).toBe('string');
    expect(err.message.length).toBeGreaterThan(0);
    expect(err.extensions.code).toBeTruthy();
  });
});

describe('parseDirectusError', () => {
  it('parses the Directus errors[] format including extensions', async () => {
    server.use(
      http.get(`${DIRECTUS_URL}/items/articles`, () =>
        HttpResponse.json(
          {
            errors: [
              {
                message: 'You do not have permission',
                extensions: { code: 'FORBIDDEN', collection: 'articles', field: 'title' },
              },
            ],
          },
          { status: 403 }
        )
      )
    );

    await expect(makeClient().getItems('articles')).rejects.toEqual({
      message: 'You do not have permission',
      extensions: { code: 'FORBIDDEN', collection: 'articles', field: 'title' },
    });
  });

  it('falls back to defaults when the errors[] entry is empty', async () => {
    server.use(
      http.get(`${DIRECTUS_URL}/items/articles`, () =>
        HttpResponse.json({ errors: [{}] }, { status: 400 })
      )
    );

    await expect(makeClient().getItems('articles')).rejects.toMatchObject({
      message: 'Unknown Directus error',
      extensions: { code: 'UNKNOWN' },
    });
  });

  it('parses the single error-object format', async () => {
    server.use(
      http.get(`${DIRECTUS_URL}/items/articles`, () =>
        HttpResponse.json({ error: { message: 'Invalid token', code: 'INVALID_TOKEN' } }, { status: 401 })
      )
    );

    await expect(makeClient().getItems('articles')).rejects.toMatchObject({
      message: 'Invalid token',
      extensions: { code: 'INVALID_TOKEN' },
    });
  });

  it('parses a string error value with UNKNOWN code', async () => {
    server.use(
      http.get(`${DIRECTUS_URL}/items/articles`, () =>
        HttpResponse.json({ error: 'something broke' }, { status: 400 })
      )
    );

    await expect(makeClient().getItems('articles')).rejects.toMatchObject({
      message: 'something broke',
      extensions: { code: 'UNKNOWN' },
    });
  });

  it('parses the plain message format as VALIDATION_ERROR', async () => {
    server.use(
      http.get(`${DIRECTUS_URL}/items/articles`, () =>
        HttpResponse.json({ message: 'Title is required' }, { status: 400 })
      )
    );

    await expect(makeClient().getItems('articles')).rejects.toMatchObject({
      message: 'Title is required',
      extensions: { code: 'VALIDATION_ERROR' },
    });
  });

  it('falls back to the axios error when the body is empty', async () => {
    server.use(
      http.get(`${DIRECTUS_URL}/items/articles`, () => new HttpResponse(null, { status: 400 }))
    );

    const err: any = await makeClient().getItems('articles').catch((e) => e);

    expect(err.message).toContain('400');
    expect(err.extensions.code).toBeTruthy();
  });
});

describe('endpoint wrappers hit the expected method and path', () => {
  const rows: Array<{
    name: string;
    call: (c: DirectusClient) => Promise<unknown>;
    method: string;
    path: string;
    /** Defaults to the raw envelope; set where a wrapper reshapes the payload. */
    data?: unknown;
  }> = [
    { name: 'getCollections', call: (c) => c.getCollections(), method: 'GET', path: '/collections' },
    { name: 'getCollection', call: (c) => c.getCollection('articles'), method: 'GET', path: '/collections/articles' },
    { name: 'createCollection', call: (c) => c.createCollection('widgets'), method: 'POST', path: '/collections' },
    { name: 'updateCollection', call: (c) => c.updateCollection('articles', { note: 'x' }), method: 'PATCH', path: '/collections/articles' },
    { name: 'deleteCollection', call: (c) => c.deleteCollection('articles'), method: 'DELETE', path: '/collections/articles' },
    // getItems normalises a singleton object into an array, so the mock's bare
    // envelope comes back wrapped. See DirectusClient.getItems.
    { name: 'getItems', call: (c) => c.getItems('articles'), method: 'GET', path: '/items/articles', data: [{ ok: true }] },
    { name: 'getItem', call: (c) => c.getItem('articles', 1), method: 'GET', path: '/items/articles/1' },
    { name: 'createItem', call: (c) => c.createItem('articles', { title: 'a' }), method: 'POST', path: '/items/articles' },
    { name: 'createItems', call: (c) => c.createItems('articles', [{ title: 'a' }, { title: 'b' }]), method: 'POST', path: '/items/articles' },
    { name: 'updateItem', call: (c) => c.updateItem('articles', 1, { title: 'b' }), method: 'PATCH', path: '/items/articles/1' },
    { name: 'updateItems', call: (c) => c.updateItems('articles', [1, 2], { status: 'archived' }), method: 'PATCH', path: '/items/articles' },
    { name: 'deleteItem', call: (c) => c.deleteItem('articles', 1), method: 'DELETE', path: '/items/articles/1' },
    { name: 'deleteItems', call: (c) => c.deleteItems('articles', [1, 2, 3]), method: 'DELETE', path: '/items/articles' },
    { name: 'getFiles', call: (c) => c.getFiles(), method: 'GET', path: '/files' },
    { name: 'deleteFile', call: (c) => c.deleteFile('file-0001'), method: 'DELETE', path: '/files/file-0001' },
    { name: 'getUsers', call: (c) => c.getUsers(), method: 'GET', path: '/users' },
    { name: 'getUser', call: (c) => c.getUser('aaaa-1111'), method: 'GET', path: '/users/aaaa-1111' },
    { name: 'createUser', call: (c) => c.createUser({ email: 'x@y.z' }), method: 'POST', path: '/users' },
    { name: 'updateUser', call: (c) => c.updateUser('aaaa-1111', { title: 'Eng' }), method: 'PATCH', path: '/users/aaaa-1111' },
    { name: 'deleteUser', call: (c) => c.deleteUser('aaaa-1111'), method: 'DELETE', path: '/users/aaaa-1111' },
    { name: 'getRoles', call: (c) => c.getRoles(), method: 'GET', path: '/roles' },
    { name: 'getRole', call: (c) => c.getRole('role-admin'), method: 'GET', path: '/roles/role-admin' },
    { name: 'createRole', call: (c) => c.createRole({ name: 'Viewer' }), method: 'POST', path: '/roles' },
    { name: 'getFlows', call: (c) => c.getFlows(), method: 'GET', path: '/flows' },
    { name: 'triggerFlow', call: (c) => c.triggerFlow('flow-0001', { ping: true }), method: 'POST', path: '/flows/trigger/flow-0001' },
    { name: 'getFields (all)', call: (c) => c.getFields(), method: 'GET', path: '/fields' },
    { name: 'getFields (collection)', call: (c) => c.getFields('articles'), method: 'GET', path: '/fields/articles' },
    { name: 'createField', call: (c) => c.createField('articles', { field: 'subtitle', type: 'string' }), method: 'POST', path: '/fields/articles' },
    { name: 'updateField', call: (c) => c.updateField('articles', 'title', { meta: { note: 'x' } }), method: 'PATCH', path: '/fields/articles/title' },
    { name: 'deleteField', call: (c) => c.deleteField('articles', 'title'), method: 'DELETE', path: '/fields/articles/title' },
    { name: 'getRelations', call: (c) => c.getRelations(), method: 'GET', path: '/relations' },
    { name: 'createRelation', call: (c) => c.createRelation({ collection: 'articles', field: 'author' }), method: 'POST', path: '/relations' },
    { name: 'deleteRelation', call: (c) => c.deleteRelation('articles', 'author'), method: 'DELETE', path: '/relations/articles/author' },
    { name: 'getPermissions', call: (c) => c.getPermissions(), method: 'GET', path: '/permissions' },
    { name: 'createPermission', call: (c) => c.createPermission({ collection: 'articles', action: 'read' }), method: 'POST', path: '/permissions' },
    { name: 'getServerInfo', call: (c) => c.getServerInfo(), method: 'GET', path: '/server/info' },
  ];

  it.each(rows)('$name -> $method $path', async ({ call, method, path: expectedPath, data }) => {
    const seen = recordAll();

    const res: any = await call(makeClient());

    expect(seen).toHaveLength(1);
    expect(seen[0].method).toBe(method);
    expect(seen[0].url.pathname).toBe(expectedPath);
    expect(res.data).toEqual(data ?? { ok: true });
  });

  it('createCollection with no fields still creates a real table with an id key', async () => {
    // Regression: this used to send schema:null, which Directus treats as a
    // grouping folder — so the collection reported success and then every write
    // to it failed with "no permission ... or it does not exist".
    const seen = recordAll();
    await makeClient().createCollection('widgets');

    const body = JSON.parse(seen[0].body);
    expect(body).toMatchObject({ collection: 'widgets', meta: {}, schema: {} });
    expect(body.fields).toHaveLength(1);
    expect(body.fields[0]).toMatchObject({
      field: 'id',
      schema: { is_primary_key: true, has_auto_increment: true },
    });
  });

  it('createCollection({folder:true}) sends schema:null for a grouping element', async () => {
    const seen = recordAll();
    await makeClient().createCollection('Loja', {}, undefined, { folder: true });
    expect(JSON.parse(seen[0].body)).toEqual({ collection: 'Loja', meta: {}, schema: null });
  });

  it('createCollection with fields sends schema:{} and injects an id primary key', async () => {
    const seen = recordAll();
    await makeClient().createCollection('widgets', {}, [{ field: 'name', type: 'string' }]);

    const body = JSON.parse(seen[0].body);
    expect(body.collection).toBe('widgets');
    expect(body.schema).toEqual({});
    expect(body.fields).toHaveLength(2);
    expect(body.fields[0]).toMatchObject({
      field: 'id',
      type: 'integer',
      schema: { is_primary_key: true, has_auto_increment: true },
    });
    expect(body.fields[1]).toMatchObject({ field: 'name', type: 'string', schema: {} });
  });

  it('updateCollection wraps the payload in { meta }', async () => {
    const seen = recordAll();
    await makeClient().updateCollection('articles', { note: 'updated' });
    expect(JSON.parse(seen[0].body)).toEqual({ meta: { note: 'updated' } });
  });

  it('updateItems sends PATCH /items/:collection with { keys, data }', async () => {
    const seen = recordAll();
    await makeClient().updateItems('articles', [1, 2], { status: 'archived' });
    expect(JSON.parse(seen[0].body)).toEqual({ keys: [1, 2], data: { status: 'archived' } });
  });

  it('triggerFlow posts the payload to /flows/trigger/:id', async () => {
    const seen = recordAll();
    await makeClient().triggerFlow('flow-0001', { article: 7 });
    expect(JSON.parse(seen[0].body)).toEqual({ article: 7 });
  });
});

describe('bulkOperation', () => {
  it('aggregates created/updated/deleted results on success', async () => {
    server.use(
      http.post(`${DIRECTUS_URL}/items/articles`, async ({ request }) =>
        HttpResponse.json(envelope(await request.json()))
      ),
      http.patch(`${DIRECTUS_URL}/items/articles/:id`, async ({ params, request }) => {
        const data = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(envelope({ id: Number(params.id), ...data }));
      }),
      http.delete(`${DIRECTUS_URL}/items/articles`, () => HttpResponse.json(envelope(null)))
    );

    const result = await makeClient().bulkOperation<{ title?: string; status?: string }>('articles', {
      create: [{ title: 'a' }, { title: 'b' }],
      update: [
        { id: 1, status: 'draft' },
        { id: 2, status: 'published' },
      ],
      delete: [3, 4],
    });

    expect(result.created).toEqual([{ title: 'a' }, { title: 'b' }]);
    expect(result.updated).toEqual([
      { id: 1, status: 'draft' },
      { id: 2, status: 'published' },
    ]);
    expect(result.deleted).toEqual([3, 4]);
    expect(result.errors).toEqual([]);
  });

  it('accumulates per-operation errors without aborting later operations', async () => {
    const failure = () =>
      HttpResponse.json(directusError('Nope', 'FORBIDDEN', { collection: 'articles' }), {
        status: 403,
      });
    server.use(
      http.post(`${DIRECTUS_URL}/items/articles`, failure),
      http.patch(`${DIRECTUS_URL}/items/articles/:id`, failure),
      http.delete(`${DIRECTUS_URL}/items/articles/:ids`, failure)
    );

    const result = await makeClient().bulkOperation<{ title?: string; status?: string }>('articles', {
      create: [{ title: 'a' }],
      update: [
        { id: 1, status: 'draft' },
        { id: 2, status: 'published' },
      ],
      delete: [3],
    });

    expect(result.created).toEqual([]);
    expect(result.updated).toEqual([]);
    expect(result.deleted).toEqual([]);
    // 1 create batch + 2 individual updates + 1 delete batch
    expect(result.errors).toHaveLength(4);
    expect(result.errors!.map((e) => e.operation)).toEqual(['create', 'update', 'update', 'delete']);
    expect(result.errors![0].error).toMatchObject({
      message: 'Nope',
      extensions: { code: 'FORBIDDEN' },
    });
  });

  it('returns empty results when no operations are provided', async () => {
    const result = await makeClient().bulkOperation('articles', {});
    expect(result).toEqual({ created: [], updated: [], deleted: [], errors: [] });
  });
});

describe('uploadFile', () => {
  function captureUpload() {
    const captured = { contentType: null as string | null, body: '' };
    server.use(
      http.post(`${DIRECTUS_URL}/files`, async ({ request }) => {
        captured.contentType = request.headers.get('content-type');
        captured.body = await request.text();
        return HttpResponse.json(envelope(FILES[0]));
      })
    );
    return captured;
  }

  it('uploads a Buffer as multipart with title/folder/storage/metadata fields', async () => {
    const captured = captureUpload();

    const result = await makeClient().uploadFile(Buffer.from('hello world'), {
      filename: 'hello.txt',
      title: 'Hello',
      folder: 'folder-1',
      storage: 'local',
      metadata: { source: 'unit-test' },
    });

    expect(captured.contentType).toContain('multipart/form-data');
    expect(captured.body).toContain('name="file"');
    expect(captured.body).toContain('hello.txt');
    expect(captured.body).toContain('hello world');
    expect(captured.body).toContain('name="title"');
    expect(captured.body).toContain('Hello');
    expect(captured.body).toContain('name="folder"');
    expect(captured.body).toContain('folder-1');
    expect(captured.body).toContain('name="storage"');
    expect(captured.body).toContain('local');
    expect(captured.body).toContain('name="metadata"');
    expect(captured.body).toContain('"source":"unit-test"');
    expect(result).toMatchObject({ id: 'file-0001' });
  });

  it('defaults the Buffer filename to "upload" when no options are given', async () => {
    const captured = captureUpload();

    await makeClient().uploadFile(Buffer.from('raw-bytes'));

    expect(captured.body).toContain('filename="upload"');
    expect(captured.body).toContain('raw-bytes');
  });

  it('uploads from a file path using a read stream and the file basename', async () => {
    const captured = captureUpload();

    const result = await makeClient().uploadFile(UPLOAD_FIXTURE);

    expect(captured.contentType).toContain('multipart/form-data');
    expect(captured.body).toContain('filename="upload.txt"');
    expect(captured.body).toContain(fs.readFileSync(UPLOAD_FIXTURE, 'utf8').trim());
    expect(result).toMatchObject({ id: 'file-0001' });
  });
});

describe('ping', () => {
  it('returns true when the first health endpoint responds', async () => {
    let pingCalls = 0;
    server.use(
      http.get(`${DIRECTUS_URL}/server/ping`, () => {
        pingCalls++;
        return HttpResponse.json({ data: 'pong' });
      })
    );

    await expect(makeClient().ping()).resolves.toBe(true);
    expect(pingCalls).toBe(1);
  });

  it('falls back to /collections when every health endpoint 404s', async () => {
    const notFound = () =>
      HttpResponse.json(directusError('Not found', 'ROUTE_NOT_FOUND'), { status: 404 });
    let collectionsUrl: URL | undefined;
    server.use(
      http.get(`${DIRECTUS_URL}/server/ping`, notFound),
      http.get(`${DIRECTUS_URL}/server/health`, notFound),
      http.get(`${DIRECTUS_URL}/utils/health`, notFound),
      http.get(`${DIRECTUS_URL}/admin/server/health`, notFound),
      http.get(`${DIRECTUS_URL}/collections`, ({ request }) => {
        collectionsUrl = new URL(request.url);
        return HttpResponse.json(envelope(COLLECTIONS));
      })
    );

    await expect(makeClient().ping()).resolves.toBe(true);
    expect(collectionsUrl!.searchParams.get('limit')).toBe('1');
  });

  it('returns false when everything fails', async () => {
    const notFound = () =>
      HttpResponse.json(directusError('Not found', 'ROUTE_NOT_FOUND'), { status: 404 });
    server.use(
      http.get(`${DIRECTUS_URL}/server/ping`, notFound),
      http.get(`${DIRECTUS_URL}/server/health`, notFound),
      http.get(`${DIRECTUS_URL}/utils/health`, notFound),
      http.get(`${DIRECTUS_URL}/admin/server/health`, notFound),
      http.get(`${DIRECTUS_URL}/collections`, notFound)
    );

    await expect(makeClient().ping()).resolves.toBe(false);
  });
});

// Branch coverage for request shaping and error normalisation. These pin
// behaviour callers rely on: that a pre-serialised body is not double-encoded,
// that content-version params reach the wire, and that a malformed error body
// still yields a readable message rather than "undefined".
describe('request shaping details', () => {
  it('threads version and versionRaw into the query', async () => {
    const seen = recordAll();

    await makeClient().get('/items/articles', { version: 'draft', versionRaw: true });

    expect(seen[0]!.url.searchParams.get('version')).toBe('draft');
    expect(seen[0]!.url.searchParams.get('versionRaw')).toBe('true');
  });

  it('sends a pre-serialised string body verbatim rather than re-encoding it', async () => {
    const seen = recordAll();
    const client = makeClient();

    await client.post('/utils/import/articles', '{"raw":true}');
    await client.patch('/items/articles/1', '{"raw":true}');

    expect(seen[0]!.body).toBe('{"raw":true}');
    expect(seen[1]!.body).toBe('{"raw":true}');
  });

  it('forwards caller-supplied headers on post', async () => {
    let seenHeader: string | null = null;
    server.use(
      http.post(`${DIRECTUS_URL}/items/articles`, ({ request }) => {
        seenHeader = request.headers.get('x-test');
        return HttpResponse.json(envelope({ ok: true }));
      })
    );

    await makeClient().post('/items/articles', { a: 1 }, { headers: { 'X-Test': 'yes' } });

    expect(seenHeader).toBe('yes');
  });

  it('passes query options through on updateItem', async () => {
    const seen = recordAll();

    await makeClient().updateItem('articles', 1, { title: 'x' }, { fields: ['id', 'title'] });

    expect(seen[0]!.url.searchParams.get('fields')).toBe('id,title');
  });

  it('omits meta when the envelope carries a falsy one', async () => {
    server.use(
      http.get(`${DIRECTUS_URL}/items/articles`, () => HttpResponse.json({ data: [], meta: null }))
    );

    const res = await makeClient().getItems('articles');

    expect(res).toEqual({ data: [] });
    expect(res).not.toHaveProperty('meta');
  });

  it('treats a null/undefined target as nothing to delete', async () => {
    const seen = recordAll();

    await expect(makeClient().deleteItems('articles', undefined as any)).resolves.toEqual({ data: null });

    expect(seen).toHaveLength(0);
  });
});

describe('createCollection payload building', () => {
  it('accepts name as an alias for field', async () => {
    const seen = recordAll();

    await makeClient().createCollection('widgets', {}, [{ name: 'title', type: 'string' } as any]);

    const body = JSON.parse(seen[0]!.body);
    expect(body.fields.map((f: any) => f.field)).toContain('title');
  });

  it('leaves alias fields without a schema block', async () => {
    const seen = recordAll();

    await makeClient().createCollection('widgets', {}, [{ field: 'children', type: 'alias' } as any]);

    const body = JSON.parse(seen[0]!.body);
    const children = body.fields.find((f: any) => f.field === 'children');
    expect(children.schema).toBeUndefined();
  });

  it('does not inject an id when the caller already supplied a primary key', async () => {
    const seen = recordAll();

    await makeClient().createCollection('widgets', {}, [
      { field: 'uuid', type: 'uuid', schema: { is_primary_key: true } } as any,
    ]);

    const body = JSON.parse(seen[0]!.body);
    expect(body.fields).toHaveLength(1);
    expect(body.fields[0].field).toBe('uuid');
  });
});

describe('error normalisation edge cases', () => {
  it('does not leak a TypeError when the error body has an empty errors array', async () => {
    // The SDK's isDirectusError() indexes errors[0] unguarded, so this body
    // used to surface as "Cannot use 'in' operator to search for 'message' in
    // undefined" instead of any real diagnosis.
    server.use(
      http.get(`${DIRECTUS_URL}/collections`, () =>
        HttpResponse.json({ errors: [] }, { status: 400 })
      )
    );

    const err = await makeClient().getCollections().catch((e) => e);

    expect(err).not.toBeInstanceOf(TypeError);
    expect(err).toMatchObject({ message: expect.any(String), extensions: { code: expect.any(String) } });
    expect(err.message).not.toContain('in operator');
  });

  it('does not leak a TypeError when the first error entry is null', async () => {
    server.use(
      http.get(`${DIRECTUS_URL}/collections`, () =>
        HttpResponse.json({ errors: [null] }, { status: 400 })
      )
    );

    await expect(makeClient().getCollections()).rejects.toMatchObject({
      message: 'Unknown Directus error',
      extensions: { code: 'UNKNOWN' },
    });
  });

  it('reports a network error when the thrown error has no message', async () => {
    const client = makeClient({ retries: 0 });
    vi.spyOn(client as any, 'send').mockRejectedValue(new Error(''));

    await expect(client.getCollections()).rejects.toBeDefined();
  });
});

describe('ping resilience', () => {
  it('returns false when every endpoint throws a plain Error', async () => {
    const client = makeClient();
    // send() rejects with a DirectusError object literal, never an Error, so
    // the `instanceof Error` arm of ping()'s catch is only reachable this way.
    vi.spyOn(client, 'get').mockRejectedValue(new Error('down'));

    await expect(client.ping()).resolves.toBe(false);
  });
});

describe('getItems shape normalisation', () => {
  it('wraps a singleton object into an array', async () => {
    // Directus answers a singleton collection with a bare object. The declared
    // return type is T[], and three call sites assumed it — an item count that
    // rendered "undefined", a silent count of 0, and a `.map is not a function`
    // crash partway through a cascade delete.
    server.use(
      http.get(`${DIRECTUS_URL}/items/homepage`, () =>
        HttpResponse.json({ data: { id: 1, title: 'hero' }, meta: { total_count: 1 } })
      )
    );

    const res = await makeClient().getItems('homepage');

    expect(Array.isArray(res.data)).toBe(true);
    expect(res.data).toEqual([{ id: 1, title: 'hero' }]);
    expect(res.meta).toEqual({ total_count: 1 });
  });

  it('leaves an array untouched and maps null to an empty array', async () => {
    server.use(
      http.get(`${DIRECTUS_URL}/items/articles`, () => HttpResponse.json({ data: [{ id: 1 }, { id: 2 }] })),
      http.get(`${DIRECTUS_URL}/items/empty`, () => HttpResponse.json({ data: null }))
    );

    const client = makeClient();
    expect((await client.getItems('articles')).data).toEqual([{ id: 1 }, { id: 2 }]);
    expect((await client.getItems('empty')).data).toEqual([]);
  });
});

describe('error mapping distinguishes rejection from unreachability', () => {
  it('reports the HTTP status when the body carries no usable error', async () => {
    server.use(
      http.get(`${DIRECTUS_URL}/collections`, () => HttpResponse.json({ errors: [] }, { status: 400 }))
    );

    const err: any = await makeClient().getCollections().catch((e) => e);

    // Previously this said "Network error" / NETWORK_ERROR, colliding with a
    // genuine socket failure and pointing the caller at the wrong problem.
    expect(err.extensions.status).toBe(400);
    expect(err.extensions.code).not.toBe('NETWORK_ERROR');
  });
});
