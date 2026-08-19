// Characterization test: pins the exact HTTP wire contract of every public
// DirectusClient method against MockDirectus.
//
// This exists to make the axios -> @directus/sdk transport migration safe. It
// was written against the pre-migration axios client and must keep passing
// afterwards, with one deliberate exception documented inline (deleteItems,
// whose wire shape legitimately changes to match Directus 12.3.0).
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { DirectusClient } from '../../src/client/directus-client.js';
import { startMockDirectus, type MockDirectus } from '../helpers/mock-directus.js';

let mock: MockDirectus;

function makeClient(): DirectusClient {
  return new DirectusClient({
    url: mock.url,
    token: 'contract-token',
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

interface Case {
  name: string;
  run: (c: DirectusClient) => Promise<unknown>;
  method: string;
  path: string;
  query?: Record<string, string>;
  body?: unknown;
}

const CASES: Case[] = [
  // --- generic verbs -------------------------------------------------------
  { name: 'get', run: (c) => c.get('/collections'), method: 'GET', path: '/collections' },
  { name: 'post', run: (c) => c.post('/collections', { collection: 'x' }), method: 'POST', path: '/collections', body: { collection: 'x' } },
  { name: 'patch', run: (c) => c.patch('/collections/articles', { meta: { note: 'n' } }), method: 'PATCH', path: '/collections/articles', body: { meta: { note: 'n' } } },
  { name: 'delete', run: (c) => c.delete('/collections/articles'), method: 'DELETE', path: '/collections/articles' },

  // --- collections ---------------------------------------------------------
  { name: 'getCollections', run: (c) => c.getCollections(), method: 'GET', path: '/collections' },
  { name: 'getCollection', run: (c) => c.getCollection('articles'), method: 'GET', path: '/collections/articles' },
  { name: 'updateCollection', run: (c) => c.updateCollection('articles', { note: 'hi' }), method: 'PATCH', path: '/collections/articles', body: { meta: { note: 'hi' } } },
  { name: 'deleteCollection', run: (c) => c.deleteCollection('articles'), method: 'DELETE', path: '/collections/articles' },

  // --- items ---------------------------------------------------------------
  { name: 'getItems', run: (c) => c.getItems('articles'), method: 'GET', path: '/items/articles' },
  {
    name: 'getItems + query',
    run: (c) => c.getItems('articles', { fields: ['id', 'title'], limit: 2, sort: ['-id'], filter: { status: { _eq: 'published' } }, search: 'q', offset: 5, page: 2 }),
    method: 'GET',
    path: '/items/articles',
    query: { fields: 'id,title', limit: '2', sort: '-id', filter: JSON.stringify({ status: { _eq: 'published' } }), search: 'q', offset: '5', page: '2' },
  },
  { name: 'getItem', run: (c) => c.getItem('articles', 1), method: 'GET', path: '/items/articles/1' },
  { name: 'createItem', run: (c) => c.createItem('articles', { title: 'T' }), method: 'POST', path: '/items/articles', body: { title: 'T' } },
  { name: 'createItems', run: (c) => c.createItems('articles', [{ title: 'A' }, { title: 'B' }]), method: 'POST', path: '/items/articles', body: [{ title: 'A' }, { title: 'B' }] },
  { name: 'updateItem', run: (c) => c.updateItem('articles', 1, { title: 'U' }), method: 'PATCH', path: '/items/articles/1', body: { title: 'U' } },
  { name: 'updateItems', run: (c) => c.updateItems('articles', [1, 2], { status: 'archived' }), method: 'PATCH', path: '/items/articles', body: { keys: [1, 2], data: { status: 'archived' } } },
  { name: 'deleteItem', run: (c) => c.deleteItem('articles', 1), method: 'DELETE', path: '/items/articles/1' },

  // --- fields / relations --------------------------------------------------
  { name: 'getFields (all)', run: (c) => c.getFields(), method: 'GET', path: '/fields' },
  { name: 'getFields (scoped)', run: (c) => c.getFields('articles'), method: 'GET', path: '/fields/articles' },
  { name: 'createField', run: (c) => c.createField('articles', { field: 'f', type: 'string' }), method: 'POST', path: '/fields/articles', body: { field: 'f', type: 'string' } },
  { name: 'updateField', run: (c) => c.updateField('articles', 'f', { type: 'text' }), method: 'PATCH', path: '/fields/articles/f', body: { type: 'text' } },
  { name: 'deleteField', run: (c) => c.deleteField('articles', 'f'), method: 'DELETE', path: '/fields/articles/f' },
  { name: 'getRelations', run: (c) => c.getRelations(), method: 'GET', path: '/relations' },
  { name: 'createRelation', run: (c) => c.createRelation({ collection: 'a', field: 'b' }), method: 'POST', path: '/relations', body: { collection: 'a', field: 'b' } },
  { name: 'deleteRelation', run: (c) => c.deleteRelation('articles', 'f'), method: 'DELETE', path: '/relations/articles/f' },

  // --- users / roles / permissions ----------------------------------------
  { name: 'getUsers', run: (c) => c.getUsers(), method: 'GET', path: '/users' },
  { name: 'getUser', run: (c) => c.getUser('aaaa-1111'), method: 'GET', path: '/users/aaaa-1111' },
  { name: 'createUser', run: (c) => c.createUser({ email: 'a@b.c' }), method: 'POST', path: '/users', body: { email: 'a@b.c' } },
  { name: 'updateUser', run: (c) => c.updateUser('aaaa-1111', { first_name: 'N' }), method: 'PATCH', path: '/users/aaaa-1111', body: { first_name: 'N' } },
  { name: 'deleteUser', run: (c) => c.deleteUser('aaaa-1111'), method: 'DELETE', path: '/users/aaaa-1111' },
  { name: 'getRoles', run: (c) => c.getRoles(), method: 'GET', path: '/roles' },
  { name: 'getRole', run: (c) => c.getRole('r1'), method: 'GET', path: '/roles/r1' },
  { name: 'createRole', run: (c) => c.createRole({ name: 'R' }), method: 'POST', path: '/roles', body: { name: 'R' } },
  { name: 'getPermissions', run: (c) => c.getPermissions(), method: 'GET', path: '/permissions' },
  { name: 'createPermission', run: (c) => c.createPermission({ collection: 'a' }), method: 'POST', path: '/permissions', body: { collection: 'a' } },

  // --- files / flows / server ---------------------------------------------
  { name: 'getFiles', run: (c) => c.getFiles(), method: 'GET', path: '/files' },
  { name: 'deleteFile', run: (c) => c.deleteFile('f1'), method: 'DELETE', path: '/files/f1' },
  { name: 'getFlows', run: (c) => c.getFlows(), method: 'GET', path: '/flows' },
  { name: 'triggerFlow', run: (c) => c.triggerFlow('flow-0001', { a: 1 }), method: 'POST', path: '/flows/trigger/flow-0001', body: { a: 1 } },
  { name: 'getServerInfo', run: (c) => c.getServerInfo(), method: 'GET', path: '/server/info' },
];

describe('DirectusClient wire contract', () => {
  it.each(CASES)('$name -> $method $path', async ({ run, method, path, query, body }) => {
    await run(makeClient());
    const req = mock.lastRequest(method, path);

    expect(req, `no ${method} ${path} was recorded`).toBeDefined();
    expect(req!.path).toBe(path);
    expect(req!.headers.authorization).toBe('Bearer contract-token');

    if (query) expect(req!.query).toMatchObject(query);
    if (body !== undefined) expect(req!.body).toEqual(body);
  });

  it('sends exactly one request per call', async () => {
    await makeClient().getCollections();
    expect(mock.requests).toHaveLength(1);
  });

  // deleteItems is called out separately: Directus 12.3.0 (#27759) changes this
  // wire shape from a comma-joined path to a body carrying `keys`.
  it('deleteItems targets the collection with the given ids', async () => {
    await makeClient().deleteItems('articles', [1, 2, 3]);
    const req = mock.requests.find((r) => r.method === 'DELETE' && r.path.startsWith('/items/articles'));
    expect(req).toBeDefined();
    // Either wire shape must convey the same three ids.
    const conveyed = req!.path === '/items/articles' ? req!.body?.keys : req!.path.replace('/items/articles/', '').split(',').map(Number);
    expect(conveyed).toEqual([1, 2, 3]);
  });

  it('exposes meta from the response envelope', async () => {
    const res = await makeClient().getItems('articles');
    expect(res.meta).toBeDefined();
  });
});
