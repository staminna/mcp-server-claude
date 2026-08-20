// Unit tests for src/client/transport.ts — the axios-backed fetch handed to the
// Directus SDK via globals.fetch.
//
// These mock axios outright rather than going through MSW, because the branches
// that matter here are the ones a real server will not produce on demand: a
// header whose value is not a string, an axios response with no headers at all,
// a non-Error rejection, an error entry that is null inside errors[]. Those are
// exactly the shapes that broke during the SDK migration, so they are worth
// pinning directly.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DirectusConfig } from '../../src/types/directus.js';

const request = vi.fn();
const create = vi.fn(() => ({ request }));

vi.mock('axios', () => ({
  default: { create: (...args: unknown[]) => create(...(args as [])) },
}));

const { createDirectusFetch } = await import('../../src/client/transport.js');

let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  request.mockReset();
  create.mockClear();
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  stderrSpy.mockRestore();
});

const CONFIG: DirectusConfig = {
  url: 'http://directus.test',
  token: 't',
  retries: 0,
  retryDelay: 1,
  maxRetryDelay: 5,
  timeout: 1000,
};

function makeFetch(overrides: Partial<DirectusConfig> = {}, onEnvelope?: (e: any) => void) {
  return createDirectusFetch({ ...CONFIG, ...overrides } as DirectusConfig, onEnvelope);
}

describe('axios instance construction', () => {
  it('applies the documented defaults when the config omits retry settings', async () => {
    // retries/retryDelay/maxRetryDelay default to 3/1000/10000. Prove the retry
    // default by counting attempts on a persistently failing request, with the
    // backoff sleep collapsed by fake timers.
    vi.useFakeTimers();
    try {
      const doFetch = createDirectusFetch({ url: 'http://directus.test' } as DirectusConfig);
      request.mockResolvedValue({ status: 500, statusText: 'Server Error', headers: {}, data: '' });

      const pending = doFetch('http://directus.test/items/a');
      await vi.runAllTimersAsync();
      await pending;

      // 1 initial attempt + 3 retries
      expect(request).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('attaches an httpsAgent when TLS options are configured', async () => {
    makeFetch({ https: { rejectUnauthorized: false } } as Partial<DirectusConfig>);

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ httpsAgent: expect.anything() }));
  });

  it('omits httpsAgent entirely when no TLS options are configured', () => {
    makeFetch();

    expect(create).toHaveBeenCalledWith(expect.not.objectContaining({ httpsAgent: expect.anything() }));
  });

  it('passes the httpsAgent on each request too', async () => {
    const doFetch = makeFetch({ https: { rejectUnauthorized: false } } as Partial<DirectusConfig>);
    request.mockResolvedValue({ status: 200, headers: {}, data: '{"data":1}' });

    await doFetch('http://directus.test/items/a');

    expect(request).toHaveBeenCalledWith(expect.objectContaining({ httpsAgent: expect.anything() }));
  });
});

describe('request shaping', () => {
  it('defaults to GET and sends only the User-Agent when init is omitted', async () => {
    const doFetch = makeFetch();
    request.mockResolvedValue({ status: 200, headers: {}, data: '{"data":1}' });

    await doFetch('http://directus.test/items/a');

    const sent = request.mock.calls[0]![0];
    expect(sent.method).toBe('GET');
    expect(Object.keys(sent.headers)).toEqual(['User-Agent']);
    expect(sent.headers['User-Agent']).toMatch(/^directus-mcp-server-enhanced\//);
    // no body key when init.body is absent
    expect(sent).not.toHaveProperty('data');
  });

  it('merges caller headers and uppercases the method', async () => {
    const doFetch = makeFetch();
    request.mockResolvedValue({ status: 200, headers: {}, data: '{"data":1}' });

    await doFetch('http://directus.test/items/a', {
      method: 'patch',
      headers: { 'X-Test': 'yes' },
      body: '{"a":1}',
    });

    const sent = request.mock.calls[0]![0];
    expect(sent.method).toBe('PATCH');
    expect(sent.headers['X-Test']).toBe('yes');
    expect(sent.data).toBe('{"a":1}');
  });
});

describe('toResponse', () => {
  it('drops content-type on a 204 so extractData takes the null path', async () => {
    const doFetch = makeFetch();
    request.mockResolvedValue({
      status: 204,
      headers: { 'content-type': 'application/json' },
      data: '',
    });

    const res = (await doFetch('http://directus.test/items/a')) as Response;

    expect(res.status).toBe(204);
    // A 204 still advertising JSON would be handed to .json() and throw.
    expect(res.headers.get('content-type')).toBeNull();
    expect(res.body).toBeNull();
  });

  it('synthesizes {"data":null} for an empty 2xx body', async () => {
    const doFetch = makeFetch();
    request.mockResolvedValue({ status: 200, headers: {}, data: '' });

    const res = (await doFetch('http://directus.test/items/a')) as Response;

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ data: null });
  });

  it('synthesizes a Directus-shaped error for an empty error body', async () => {
    const doFetch = makeFetch();
    request.mockResolvedValue({ status: 502, statusText: 'Bad Gateway', headers: {}, data: '' });

    const res = (await doFetch('http://directus.test/items/a')) as Response;
    const body = await res.json();

    expect(body.errors[0]).toMatchObject({
      message: 'HTTP 502 Bad Gateway',
      extensions: { code: 'UNKNOWN', status: 502 },
    });
  });

  it('omits a missing statusText rather than leaving a trailing space', async () => {
    const doFetch = makeFetch();
    request.mockResolvedValue({ status: 500, headers: {}, data: '' });

    const res = (await doFetch('http://directus.test/items/a')) as Response;
    const body = await res.json();

    expect(body.errors[0].message).toBe('HTTP 500');
  });

  it('tolerates a response with no headers and a non-string body', async () => {
    const doFetch = makeFetch();
    request.mockResolvedValue({ status: 200, headers: undefined, data: { not: 'a string' } });

    const res = (await doFetch('http://directus.test/items/a')) as Response;

    // A non-string body is treated as empty, so the 2xx synthetic applies.
    await expect(res.json()).resolves.toEqual({ data: null });
  });

  it('skips headers whose value is not a string', async () => {
    const doFetch = makeFetch();
    request.mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'application/json', 'set-cookie': ['a=1', 'b=2'] },
      data: '{"data":1}',
    });

    const res = (await doFetch('http://directus.test/items/a')) as Response;

    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});

describe('inspectBody', () => {
  it('hands meta to the listener', async () => {
    const seen: any[] = [];
    const doFetch = makeFetch({}, (e) => seen.push(e));
    request.mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'application/json' },
      data: JSON.stringify({ data: [1], meta: { total_count: 7 } }),
    });

    await doFetch('http://directus.test/items/a');

    expect(seen).toEqual([{ data: [1], meta: { total_count: 7 } }]);
  });

  it('ignores a JSON body that parses to a non-object', async () => {
    const seen: any[] = [];
    const doFetch = makeFetch({}, (e) => seen.push(e));
    request.mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'application/json' },
      data: '"just a string"',
    });

    const res = (await doFetch('http://directus.test/items/a')) as Response;

    expect(seen).toEqual([]);
    await expect(res.text()).resolves.toBe('"just a string"');
  });

  it('ignores an unparseable JSON body', async () => {
    const doFetch = makeFetch();
    request.mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'application/json' },
      data: '{not json',
    });

    const res = (await doFetch('http://directus.test/items/a')) as Response;

    await expect(res.text()).resolves.toBe('{not json');
  });

  it('leaves a non-JSON body untouched', async () => {
    const seen: any[] = [];
    const doFetch = makeFetch({}, (e) => seen.push(e));
    request.mockResolvedValue({ status: 200, headers: { 'content-type': 'text/plain' }, data: 'pong' });

    const res = (await doFetch('http://directus.test/server/ping')) as Response;

    expect(seen).toEqual([]);
    await expect(res.text()).resolves.toBe('pong');
  });

  it('stamps the HTTP status onto errors that lack one, preserving those that have one', async () => {
    const doFetch = makeFetch();
    request.mockResolvedValue({
      status: 400,
      headers: { 'content-type': 'application/json' },
      data: JSON.stringify({
        errors: [
          null,
          'oops',
          { message: 'already stamped', extensions: { code: 'X', status: 418 } },
          { message: 'needs a status', extensions: { code: 'Y' } },
        ],
      }),
    });

    const res = (await doFetch('http://directus.test/items/a')) as Response;
    const body = await res.json();

    // non-object entries survive untouched
    expect(body.errors[0]).toBeNull();
    expect(body.errors[1]).toBe('oops');
    // an existing status is never overwritten
    expect(body.errors[2].extensions.status).toBe(418);
    // a missing one is filled in from the HTTP status
    expect(body.errors[3].extensions.status).toBe(400);
  });

  it('returns the body unchanged when every error already carries a status', async () => {
    const doFetch = makeFetch();
    const data = JSON.stringify({
      errors: [{ message: 'm', extensions: { code: 'X', status: 418 } }],
    });
    request.mockResolvedValue({ status: 400, headers: { 'content-type': 'application/json' }, data });

    const res = (await doFetch('http://directus.test/items/a')) as Response;

    await expect(res.text()).resolves.toBe(data);
  });
});

describe('retry and transport failures', () => {
  it('does not retry a 4xx', async () => {
    const doFetch = makeFetch({ retries: 3 });
    request.mockResolvedValue({
      status: 403,
      headers: { 'content-type': 'application/json' },
      data: JSON.stringify({ errors: [{ message: 'forbidden' }] }),
    });

    await doFetch('http://directus.test/items/a');

    expect(request).toHaveBeenCalledTimes(1);
  });

  it('retries a 429 and returns the eventual success', async () => {
    vi.useFakeTimers();
    try {
      const doFetch = makeFetch({ retries: 2 });
      request
        .mockResolvedValueOnce({ status: 429, headers: {}, data: '' })
        .mockResolvedValue({
          status: 200,
          headers: { 'content-type': 'application/json' },
          data: '{"data":"ok"}',
        });

      const pending = doFetch('http://directus.test/items/a');
      await vi.runAllTimersAsync();
      const res = (await pending) as Response;

      expect(request).toHaveBeenCalledTimes(2);
      await expect(res.json()).resolves.toEqual({ data: 'ok' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('rethrows the transport error once retries are exhausted', async () => {
    const doFetch = makeFetch({ retries: 0 });
    request.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(doFetch('http://directus.test/items/a')).rejects.toThrow('ECONNREFUSED');
  });

  it('handles a non-Error rejection without masking it', async () => {
    const doFetch = makeFetch({ retries: 0 });
    request.mockRejectedValue('string failure');

    await expect(doFetch('http://directus.test/items/a')).rejects.toBe('string failure');
  });

  it('counts retries per call rather than across calls', async () => {
    // Regression: the retry budget used to live on the client instance and was
    // never reset on success, so one retry permanently shrank every later
    // request's budget.
    vi.useFakeTimers();
    try {
      const doFetch = makeFetch({ retries: 1 });
      request
        .mockResolvedValueOnce({ status: 500, headers: {}, data: '' })
        .mockResolvedValueOnce({ status: 200, headers: {}, data: '{"data":1}' })
        .mockResolvedValueOnce({ status: 500, headers: {}, data: '' })
        .mockResolvedValueOnce({ status: 200, headers: {}, data: '{"data":2}' });

      const first = doFetch('http://directus.test/items/a');
      await vi.runAllTimersAsync();
      await first;
      expect(request).toHaveBeenCalledTimes(2);

      const second = doFetch('http://directus.test/items/b');
      await vi.runAllTimersAsync();
      await second;
      // the second call still gets its own full budget
      expect(request).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });
});
