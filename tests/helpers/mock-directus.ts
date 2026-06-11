// A minimal in-process Directus mock over node:http, shared by integration and
// e2e tests. Listens on an ephemeral 127.0.0.1 port and records every request.
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { URL } from 'node:url';
import {
  COLLECTIONS,
  FIELDS_ARTICLES,
  RELATIONS,
  ITEMS_ARTICLES,
  USERS,
  ROLES,
  FILES,
  FOLDERS,
  FLOWS,
  OPERATIONS,
  PERMISSIONS,
  PROMPTS,
  SERVER_INFO,
  envelope,
  directusError,
} from './fixtures.js';

export interface RecordedRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string | string[] | undefined>;
  body: any;
}

export type RouteOverride = (
  req: RecordedRequest,
  res: ServerResponse
) => boolean | void; // return true when the override handled the response

export class MockDirectus {
  private server: Server;
  public requests: RecordedRequest[] = [];
  private overrides: RouteOverride[] = [];
  public url = '';

  constructor() {
    this.server = createServer((req, res) => this.handle(req, res));
  }

  async start(): Promise<string> {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    const address = this.server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Failed to bind mock Directus to an ephemeral port');
    }
    this.url = `http://127.0.0.1:${address.port}`;
    return this.url;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve, reject) =>
      this.server.close((err) => (err ? reject(err) : resolve()))
    );
  }

  /** Install a per-test override; cleared by reset(). */
  use(override: RouteOverride): void {
    this.overrides.push(override);
  }

  reset(): void {
    this.requests = [];
    this.overrides = [];
  }

  /** Most recent request matching a method+path prefix. */
  lastRequest(method: string, pathPrefix: string): RecordedRequest | undefined {
    return [...this.requests]
      .reverse()
      .find((r) => r.method === method && r.path.startsWith(pathPrefix));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const parsed = new URL(req.url || '/', this.url || 'http://127.0.0.1');
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8');
    let body: any = undefined;
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
    }

    const recorded: RecordedRequest = {
      method: req.method || 'GET',
      path: parsed.pathname,
      query: Object.fromEntries(parsed.searchParams.entries()),
      headers: req.headers,
      body,
    };
    this.requests.push(recorded);

    res.setHeader('content-type', 'application/json');

    for (const override of this.overrides) {
      if (override(recorded, res)) return;
    }

    this.route(recorded, res);
  }

  private json(res: ServerResponse, status: number, payload: unknown): void {
    res.statusCode = status;
    res.end(JSON.stringify(payload));
  }

  private route(req: RecordedRequest, res: ServerResponse): void {
    const { method, path } = req;

    // Health endpoints (ping() tries several)
    if (path === '/server/ping') return this.json(res, 200, { data: 'pong' });
    if (path === '/server/health') return this.json(res, 200, { status: 'ok' });
    if (path === '/server/info') return this.json(res, 200, envelope(SERVER_INFO));

    // Collections
    if (path === '/collections' && method === 'GET') return this.json(res, 200, envelope(COLLECTIONS));
    if (path === '/collections' && method === 'POST') return this.json(res, 200, envelope(req.body));
    const collectionMatch = path.match(/^\/collections\/([^/]+)$/);
    if (collectionMatch) {
      const name = collectionMatch[1];
      const found = COLLECTIONS.find((c) => c.collection === name);
      if (method === 'GET') {
        return found
          ? this.json(res, 200, envelope(found))
          : this.json(res, 403, directusError(`You don't have permission to access collection "${name}" or it does not exist.`, 'FORBIDDEN'));
      }
      if (method === 'PATCH') return this.json(res, 200, envelope({ ...found, meta: req.body }));
      if (method === 'DELETE') return this.json(res, 204, {});
    }

    // Fields
    if (path === '/fields' && method === 'GET') return this.json(res, 200, envelope(FIELDS_ARTICLES));
    const fieldsMatch = path.match(/^\/fields\/([^/]+)$/);
    if (fieldsMatch && method === 'GET') return this.json(res, 200, envelope(FIELDS_ARTICLES.filter((f) => f.collection === fieldsMatch[1])));
    if (fieldsMatch && method === 'POST') return this.json(res, 200, envelope(req.body));
    const fieldMatch = path.match(/^\/fields\/([^/]+)\/([^/]+)$/);
    if (fieldMatch && method === 'PATCH') return this.json(res, 200, envelope(req.body));
    if (fieldMatch && method === 'DELETE') return this.json(res, 204, {});

    // Relations
    if (path === '/relations' && method === 'GET') return this.json(res, 200, envelope(RELATIONS));
    if (path === '/relations' && method === 'POST') return this.json(res, 200, envelope(req.body));
    const relationMatch = path.match(/^\/relations\/([^/]+)\/([^/]+)$/);
    if (relationMatch && method === 'DELETE') return this.json(res, 204, {});

    // Items: ai_prompts (prompt fixtures) and regular collections
    const itemsMatch = path.match(/^\/items\/([^/]+)(?:\/([^/]+))?$/);
    if (itemsMatch) {
      const [, collection, id] = itemsMatch;
      const pool = collection === 'ai_prompts' ? PROMPTS : ITEMS_ARTICLES;
      if (method === 'GET' && !id) {
        // honor name filter for prompts/get
        if (collection === 'ai_prompts' && req.query.filter) {
          try {
            const filter = JSON.parse(req.query.filter);
            const wanted = filter?.name?._eq;
            if (wanted) {
              return this.json(res, 200, envelope(PROMPTS.filter((p) => p.name === wanted)));
            }
          } catch {
            // fall through to full list
          }
        }
        return this.json(res, 200, { data: pool, meta: { total_count: pool.length, filter_count: pool.length } });
      }
      if (method === 'GET' && id) {
        const item = (pool as any[]).find((i) => String(i.id) === id);
        return item
          ? this.json(res, 200, envelope(item))
          : this.json(res, 404, directusError('Item not found', 'RECORD_NOT_FOUND'));
      }
      if (method === 'POST') return this.json(res, 200, envelope(Array.isArray(req.body) ? req.body : { id: 99, ...req.body }));
      if (method === 'PATCH' && id) return this.json(res, 200, envelope({ id, ...req.body }));
      if (method === 'PATCH' && !id) return this.json(res, 200, envelope((req.body?.keys || []).map((k: any) => ({ id: k, ...req.body?.data }))));
      if (method === 'DELETE') return this.json(res, 204, {});
    }

    // Users / roles / permissions
    if (path === '/users' && method === 'GET') return this.json(res, 200, envelope(USERS));
    if (path === '/users' && method === 'POST') return this.json(res, 200, envelope({ id: 'new-user', ...req.body }));
    const userMatch = path.match(/^\/users\/([^/]+)$/);
    if (userMatch && method === 'GET') {
      const user = USERS.find((u) => u.id === userMatch[1]);
      return user
        ? this.json(res, 200, envelope(user))
        : this.json(res, 404, directusError('User not found', 'RECORD_NOT_FOUND'));
    }
    if (userMatch && method === 'PATCH') return this.json(res, 200, envelope({ id: userMatch[1], ...req.body }));
    if (userMatch && method === 'DELETE') return this.json(res, 204, {});
    if (path === '/roles' && method === 'GET') return this.json(res, 200, envelope(ROLES));
    if (path === '/roles' && method === 'POST') return this.json(res, 200, envelope({ id: 'new-role', ...req.body }));
    const roleMatch = path.match(/^\/roles\/([^/]+)$/);
    if (roleMatch && method === 'GET') return this.json(res, 200, envelope(ROLES.find((r) => r.id === roleMatch[1]) ?? null));
    if (path === '/permissions' && method === 'GET') return this.json(res, 200, envelope(PERMISSIONS));
    if (path === '/permissions' && method === 'POST') return this.json(res, 200, envelope({ id: 2, ...req.body }));

    // Files / folders
    if (path === '/files' && method === 'GET') return this.json(res, 200, envelope(FILES));
    if (path === '/files' && method === 'POST') return this.json(res, 200, envelope(FILES[0]));
    const fileMatch = path.match(/^\/files\/([^/]+)$/);
    if (fileMatch && method === 'GET') {
      const file = FILES.find((f) => f.id === fileMatch[1]);
      return file
        ? this.json(res, 200, envelope(file))
        : this.json(res, 404, directusError('File not found', 'RECORD_NOT_FOUND'));
    }
    if (fileMatch && method === 'PATCH') return this.json(res, 200, envelope({ id: fileMatch[1], ...req.body }));
    if (fileMatch && method === 'DELETE') return this.json(res, 204, {});
    if (path === '/folders' && method === 'GET') return this.json(res, 200, envelope(FOLDERS));
    if (path === '/folders' && method === 'POST') return this.json(res, 200, envelope({ id: 'new-folder', ...req.body }));

    // Flows / operations
    if (path === '/flows' && method === 'GET') return this.json(res, 200, envelope(FLOWS));
    if (path === '/flows' && method === 'POST') return this.json(res, 200, envelope({ id: 'new-flow', ...req.body }));
    const flowTrigger = path.match(/^\/flows\/trigger\/([^/]+)$/);
    if (flowTrigger && method === 'POST') return this.json(res, 200, envelope({ triggered: flowTrigger[1], input: req.body }));
    const flowMatch = path.match(/^\/flows\/([^/]+)$/);
    if (flowMatch && method === 'GET') {
      const flow = FLOWS.find((f) => f.id === flowMatch[1]);
      return flow
        ? this.json(res, 200, envelope(flow))
        : this.json(res, 404, directusError('Flow not found', 'RECORD_NOT_FOUND'));
    }
    if (flowMatch && method === 'PATCH') return this.json(res, 200, envelope({ id: flowMatch[1], ...req.body }));
    if (flowMatch && method === 'DELETE') return this.json(res, 204, {});
    if (path === '/operations' && method === 'GET') return this.json(res, 200, envelope(OPERATIONS));

    this.json(res, 404, directusError(`No mock route for ${method} ${path}`, 'ROUTE_NOT_FOUND'));
  }
}

/** Convenience: start a mock and return [instance, url]. */
export async function startMockDirectus(): Promise<MockDirectus> {
  const mock = new MockDirectus();
  await mock.start();
  return mock;
}
