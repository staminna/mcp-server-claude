// Integration tests: DirectusClient over real sockets against MockDirectus.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { DirectusClient } from '../../src/client/directus-client.js';
import { startMockDirectus, type MockDirectus } from '../helpers/mock-directus.js';
import { directusError } from '../helpers/fixtures.js';

let mock: MockDirectus;

function makeClient(): DirectusClient {
  return new DirectusClient({
    url: mock.url,
    token: 'integration-token',
    retries: 2,
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

describe('real-socket request shape', () => {
  it('sends the Bearer token on every request', async () => {
    await makeClient().getCollections();
    const req = mock.lastRequest('GET', '/collections');
    expect(req?.headers.authorization).toBe('Bearer integration-token');
  });

  it('serializes QueryOptions into the query string', async () => {
    const filter = { status: { _eq: 'published' } };
    await makeClient().getItems('articles', {
      filter,
      fields: ['id', 'title'],
      limit: 2,
      sort: ['-id'],
    });
    const req = mock.lastRequest('GET', '/items/articles');
    expect(req?.query.filter).toBe(JSON.stringify(filter));
    expect(req?.query.fields).toBe('id,title');
    expect(req?.query.limit).toBe('2');
    expect(req?.query.sort).toBe('-id');
  });

  it('posts createItem bodies verbatim', async () => {
    await makeClient().createItem('articles', { title: 'Wired', status: 'draft' });
    const req = mock.lastRequest('POST', '/items/articles');
    expect(req?.body).toEqual({ title: 'Wired', status: 'draft' });
  });

  it('joins ids in the deleteItems path', async () => {
    await makeClient().deleteItems('articles', [1, 2, 3]);
    expect(mock.lastRequest('DELETE', '/items/articles/1,2,3')).toBeDefined();
  });

  it('fetches server info', async () => {
    const info = await makeClient().getServerInfo();
    expect(info.data).toMatchObject({ version: '12.0.0' });
  });
});

describe('retry and error handling over real HTTP', () => {
  it('retries 500s and then succeeds', async () => {
    let failures = 0;
    mock.use((req, res) => {
      if (req.path === '/items/articles' && failures < 2) {
        failures++;
        res.statusCode = 500;
        res.end(JSON.stringify(directusError('flaky')));
        return true;
      }
      return false;
    });

    const result = await makeClient().getItems('articles');
    expect(failures).toBe(2);
    expect(Array.isArray(result.data)).toBe(true);
    expect(mock.requests.filter((r) => r.path === '/items/articles')).toHaveLength(3);
  });

  it('retries 429 once and succeeds', async () => {
    let limited = false;
    mock.use((req, res) => {
      if (req.path === '/items/articles' && !limited) {
        limited = true;
        res.statusCode = 429;
        res.end(JSON.stringify(directusError('rate limited')));
        return true;
      }
      return false;
    });
    await makeClient().getItems('articles');
    expect(mock.requests.filter((r) => r.path === '/items/articles')).toHaveLength(2);
  });

  it('surfaces parsed Directus permission errors without retrying', async () => {
    await expect(makeClient().getCollection('top_secret')).rejects.toMatchObject({
      message: expect.stringContaining('permission'),
      extensions: { code: 'FORBIDDEN' },
    });
    expect(mock.requests.filter((r) => r.path === '/collections/top_secret')).toHaveLength(1);
  });

  it('gives up after exhausting retries', async () => {
    mock.use((req, res) => {
      if (req.path === '/items/articles') {
        res.statusCode = 503;
        res.end(JSON.stringify(directusError('down for maintenance')));
        return true;
      }
      return false;
    });
    await expect(makeClient().getItems('articles')).rejects.toMatchObject({
      message: 'down for maintenance',
    });
    expect(mock.requests.filter((r) => r.path === '/items/articles')).toHaveLength(3);
  });
});

describe('ping over real HTTP', () => {
  it('succeeds on the first health endpoint', async () => {
    expect(await makeClient().ping()).toBe(true);
    expect(mock.lastRequest('GET', '/server/ping')).toBeDefined();
  });

  it('falls back to /collections when health endpoints fail', async () => {
    mock.use((req, res) => {
      if (req.path.includes('health') || req.path === '/server/ping') {
        res.statusCode = 404;
        res.end(JSON.stringify(directusError('not here')));
        return true;
      }
      return false;
    });
    expect(await makeClient().ping()).toBe(true);
    expect(mock.lastRequest('GET', '/collections')).toBeDefined();
  });
});
