// Unit tests for src/server.ts: loadConfigFromEnv, TOOL_DEFINITIONS,
// createHandlers (tools/prompts/resources), createDeps and createServer.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  loadConfigFromEnv,
  createHandlers,
  createDeps,
  createServer,
  TOOL_DEFINITIONS,
  type ServerDeps,
} from '../../src/server.js';
import { DirectusClient } from '../../src/client/directus-client.js';
import { CollectionTools } from '../../src/tools/collection-tools.js';
import { UserTools } from '../../src/tools/user-tools.js';
import { FileTools } from '../../src/tools/file-tools.js';
import { FlowTools } from '../../src/tools/flow-tools.js';
import { SchemaTools } from '../../src/tools/schema-tools.js';
import { DiagnosticTools } from '../../src/tools/diagnostic-tools.js';
import { makeClientStub, type ClientStub } from '../helpers/stubs.js';
import { COLLECTIONS, ITEMS_ARTICLES, PROMPTS, envelope } from '../helpers/fixtures.js';

// Every tool name with the deps slot + method it must dispatch to.
const DISPATCH: Array<[string, keyof ServerDeps, string]> = [
  ['list_collections', 'collectionTools', 'listCollections'],
  ['get_collection_schema', 'collectionTools', 'getCollectionSchema'],
  ['get_collection_items', 'collectionTools', 'getCollectionItems'],
  ['create_collection', 'collectionTools', 'createCollection'],
  ['delete_collection', 'collectionTools', 'deleteCollection'],
  ['create_item', 'collectionTools', 'createItem'],
  ['update_item', 'collectionTools', 'updateItem'],
  ['delete_items', 'collectionTools', 'deleteItems'],
  ['create_field', 'collectionTools', 'createField'],
  ['update_field', 'collectionTools', 'updateField'],
  ['delete_field', 'collectionTools', 'deleteField'],
  ['bulk_operations', 'collectionTools', 'bulkOperations'],
  ['analyze_collection_schema', 'schemaTools', 'analyzeCollectionSchema'],
  ['analyze_relationships', 'schemaTools', 'analyzeRelationships'],
  ['create_relationship', 'schemaTools', 'createRelationship'],
  ['validate_collection_schema', 'schemaTools', 'validateCollectionSchema'],
  ['diagnose_collection_access', 'diagnosticTools', 'diagnoseCollectionAccess'],
  ['refresh_collection_cache', 'diagnosticTools', 'refreshCollectionCache'],
  ['validate_collection_creation', 'diagnosticTools', 'validateCollectionCreation'],
  ['get_users', 'userTools', 'getUsers'],
  ['get_user', 'userTools', 'getUser'],
  ['get_files', 'fileTools', 'getFiles'],
  ['get_flows', 'flowTools', 'getFlows'],
  ['get_flow', 'flowTools', 'getFlow'],
  ['create_flow', 'flowTools', 'createFlow'],
  ['update_flow', 'flowTools', 'updateFlow'],
  ['delete_flow', 'flowTools', 'deleteFlow'],
  ['trigger_flow', 'flowTools', 'triggerFlow'],
  ['get_operations', 'flowTools', 'getOperations'],
];

type StubbedDeps = ServerDeps & {
  directusClient: ClientStub & DirectusClient;
  [slot: string]: any;
};

// createHandlers never checks instanceof, so plain objects of vi.fn()s work.
function makeDeps(): StubbedDeps {
  const mk = () => vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
  const deps: Record<string, any> = { directusClient: makeClientStub() };
  for (const [, slot, method] of DISPATCH) {
    deps[slot] = deps[slot] || {};
    deps[slot][method] = mk();
  }
  return deps as StubbedDeps;
}

const ENABLED_PROMPTS = { DIRECTUS_PROMPTS_COLLECTION_ENABLED: 'true' } as NodeJS.ProcessEnv;
const ENABLED_RESOURCES = { DIRECTUS_RESOURCES_ENABLED: 'true' } as NodeJS.ProcessEnv;

let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // The logger is a module singleton writing JSON lines to stderr; silence it.
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  stderrSpy.mockRestore();
});

describe('loadConfigFromEnv', () => {
  it('applies all defaults when env is empty', () => {
    const config = loadConfigFromEnv({} as NodeJS.ProcessEnv);

    expect(config.url).toBe('http://localhost:8065');
    expect(config.token).toBeUndefined();
    expect(config.timeout).toBe(30000);
    expect(config.retries).toBe(3);
    expect(config.retryDelay).toBe(1000);
    expect(config.maxRetryDelay).toBe(10000);
    expect(config.websocket).toBe(false);
    expect(config.https).toBeUndefined();
  });

  it('honors every env override', () => {
    const config = loadConfigFromEnv({
      DIRECTUS_URL: 'https://cms.example.com',
      DIRECTUS_TOKEN: 'secret-token',
      DIRECTUS_TIMEOUT: '5000',
      DIRECTUS_RETRIES: '7',
      DIRECTUS_RETRY_DELAY: '1',
      DIRECTUS_MAX_RETRY_DELAY: '5',
    } as NodeJS.ProcessEnv);

    expect(config.url).toBe('https://cms.example.com');
    expect(config.token).toBe('secret-token');
    expect(config.timeout).toBe(5000);
    expect(config.retries).toBe(7);
    expect(config.retryDelay).toBe(1);
    expect(config.maxRetryDelay).toBe(5);
  });

  it('leaves https undefined when only non-cert https vars are set', () => {
    const config = loadConfigFromEnv({
      DIRECTUS_HTTPS_PASSPHRASE: 'pw',
      DIRECTUS_HTTPS_SERVERNAME: 'cms.example.com',
      DIRECTUS_HTTPS_REJECT_UNAUTHORIZED: 'false',
    } as NodeJS.ProcessEnv);

    expect(config.https).toBeUndefined();
  });

  it('builds https block with only ca', () => {
    const config = loadConfigFromEnv({ DIRECTUS_HTTPS_CA: '/certs/ca.pem' } as NodeJS.ProcessEnv);
    expect(config.https).toEqual({ ca: '/certs/ca.pem' });
  });

  it('builds https block with cert and key', () => {
    const config = loadConfigFromEnv({
      DIRECTUS_HTTPS_CERT: '/certs/client.pem',
      DIRECTUS_HTTPS_KEY: '/certs/client.key',
    } as NodeJS.ProcessEnv);
    expect(config.https).toEqual({ cert: '/certs/client.pem', key: '/certs/client.key' });
  });

  it('builds https block with pfx, passphrase, servername and rejectUnauthorized=true', () => {
    const config = loadConfigFromEnv({
      DIRECTUS_HTTPS_PFX: '/certs/bundle.pfx',
      DIRECTUS_HTTPS_PASSPHRASE: 'pw',
      DIRECTUS_HTTPS_SERVERNAME: 'cms.internal',
      DIRECTUS_HTTPS_REJECT_UNAUTHORIZED: 'true',
    } as NodeJS.ProcessEnv);

    expect(config.https).toEqual({
      pfx: '/certs/bundle.pfx',
      passphrase: 'pw',
      servername: 'cms.internal',
      rejectUnauthorized: true,
    });
  });

  it("maps REJECT_UNAUTHORIZED 'false' to rejectUnauthorized: false", () => {
    const config = loadConfigFromEnv({
      DIRECTUS_HTTPS_CA: 'inline-ca-content',
      DIRECTUS_HTTPS_REJECT_UNAUTHORIZED: 'false',
    } as NodeJS.ProcessEnv);

    expect(config.https).toEqual({ ca: 'inline-ca-content', rejectUnauthorized: false });
  });
});

describe('listTools / TOOL_DEFINITIONS', () => {
  it('exposes exactly the 29 dispatchable tools', async () => {
    const { listTools } = createHandlers(makeDeps(), {} as NodeJS.ProcessEnv);
    const { tools } = await listTools();

    expect(tools).toBe(TOOL_DEFINITIONS);
    expect(tools).toHaveLength(29);

    const listed = tools.map((t: any) => t.name).sort();
    const dispatched = DISPATCH.map(([name]) => name).sort();
    expect(listed).toEqual(dispatched);
  });

  it('every tool definition has an object inputSchema', () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });
});

describe('callTool dispatch', () => {
  it.each(DISPATCH)('%s dispatches to %s.%s with args', async (name, slot, method) => {
    const deps = makeDeps();
    const { callTool } = createHandlers(deps, {} as NodeJS.ProcessEnv);
    const args = { collection: 'articles', probe: name };

    const result = await callTool({ params: { name, arguments: args } });

    expect((deps as any)[slot][method]).toHaveBeenCalledTimes(1);
    expect((deps as any)[slot][method]).toHaveBeenCalledWith(args);
    // Other slots must not have been touched.
    for (const [, otherSlot, otherMethod] of DISPATCH) {
      if (otherSlot === slot && otherMethod === method) continue;
      expect((deps as any)[otherSlot][otherMethod]).not.toHaveBeenCalled();
    }
    expect((result as any).isError).toBeUndefined();
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('ok');
  });

  it('returns isError for an unknown tool', async () => {
    const { callTool } = createHandlers(makeDeps(), {} as NodeJS.ProcessEnv);

    const result = await callTool({ params: { name: 'nuke_everything', arguments: {} } });

    expect((result as any).isError).toBe(true);
    expect(result.content[0].text).toContain('Unknown tool: nuke_everything');
  });

  it('returns isError with the message when a tool rejects with an Error', async () => {
    const deps = makeDeps();
    (deps.collectionTools as any).listCollections.mockRejectedValue(new Error('boom from tool'));
    const { callTool } = createHandlers(deps, {} as NodeJS.ProcessEnv);

    const result = await callTool({ params: { name: 'list_collections', arguments: {} } });

    expect((result as any).isError).toBe(true);
    expect(result.content[0].text).toContain('Error: boom from tool');
  });

  it('returns Unknown error when a tool rejects with a non-Error', async () => {
    const deps = makeDeps();
    (deps.flowTools as any).getFlows.mockRejectedValue('string failure');
    const { callTool } = createHandlers(deps, {} as NodeJS.ProcessEnv);

    const result = await callTool({ params: { name: 'get_flows' } });

    expect((result as any).isError).toBe(true);
    expect(result.content[0].text).toContain('Error: Unknown error');
  });
});

describe('prompts', () => {
  it('listPrompts returns empty list when feature is disabled', async () => {
    const deps = makeDeps();
    const { listPrompts } = createHandlers(deps, {} as NodeJS.ProcessEnv);

    await expect(listPrompts()).resolves.toEqual({ prompts: [] });
    expect(deps.directusClient.getItems).not.toHaveBeenCalled();
  });

  it('listPrompts maps Directus rows, falling back to id when name is missing', async () => {
    const deps = makeDeps();
    const rows = [
      ...PROMPTS,
      { id: 'prompt-3', status: 'published', arguments: null }, // no name/description/arguments
    ];
    deps.directusClient.getItems.mockResolvedValue(envelope(rows));
    const { listPrompts } = createHandlers(deps, ENABLED_PROMPTS);

    const { prompts } = await listPrompts();

    expect(deps.directusClient.getItems).toHaveBeenCalledWith('ai_prompts', {
      filter: { status: { _eq: 'published' } },
      fields: ['id', 'name', 'description', 'arguments'],
      limit: -1,
    });
    expect(prompts).toHaveLength(3);
    expect(prompts[0]).toEqual({
      name: 'summarize_article',
      description: 'Summarize an article',
      arguments: [
        { name: 'title', description: 'Article title', required: true },
        { name: 'words', description: 'Word budget', required: false },
      ],
    });
    expect(prompts[2]).toEqual({ name: 'prompt-3', description: '', arguments: [] });
  });

  it('listPrompts returns empty list when the client rejects', async () => {
    const deps = makeDeps();
    deps.directusClient.getItems.mockRejectedValue(new Error('directus down'));
    const { listPrompts } = createHandlers(deps, ENABLED_PROMPTS);

    await expect(listPrompts()).resolves.toEqual({ prompts: [] });
  });

  it('listPrompts tolerates a response without data', async () => {
    const deps = makeDeps();
    deps.directusClient.getItems.mockResolvedValue({} as any);
    const { listPrompts } = createHandlers(deps, ENABLED_PROMPTS);

    await expect(listPrompts()).resolves.toEqual({ prompts: [] });
  });

  it('getPrompt throws when the feature is disabled', async () => {
    const deps = makeDeps();
    const { getPrompt } = createHandlers(deps, {} as NodeJS.ProcessEnv);

    await expect(getPrompt({ params: { name: 'summarize_article' } })).rejects.toThrow(
      'Prompts feature is disabled'
    );
    expect(deps.directusClient.getItems).not.toHaveBeenCalled();
  });

  it('getPrompt interpolates repeated placeholders and leaves unknown ones', async () => {
    const deps = makeDeps();
    deps.directusClient.getItems.mockResolvedValue(
      envelope([
        {
          id: 'p',
          name: 'greet',
          description: 'Greets',
          content: 'Hello {{who}}, again {{who}}. Keep {{mystery}} as-is.',
          arguments: JSON.stringify([{ name: 'who' }, { name: 'absent' }]),
        },
      ])
    );
    const { getPrompt } = createHandlers(deps, ENABLED_PROMPTS);

    const result = await getPrompt({ params: { name: 'greet', arguments: { who: 'World' } } });

    expect(deps.directusClient.getItems).toHaveBeenCalledWith('ai_prompts', {
      filter: { name: { _eq: 'greet' }, status: { _eq: 'published' } },
      limit: 1,
    });
    expect(result.description).toBe('Greets');
    expect(result.messages[0].role).toBe('user');
    expect(result.messages[0].content.text).toBe('Hello World, again World. Keep {{mystery}} as-is.');
  });

  it('getPrompt accepts arguments already parsed as an object', async () => {
    const deps = makeDeps();
    deps.directusClient.getItems.mockResolvedValue(
      envelope([
        {
          id: 'p2',
          name: 'count',
          content: 'Count to {{n}}.',
          arguments: [{ name: 'n' }], // already an array, not a JSON string
        },
      ])
    );
    const { getPrompt } = createHandlers(deps, ENABLED_PROMPTS);

    const result = await getPrompt({ params: { name: 'count', arguments: { n: 5 } } });

    expect(result.messages[0].content.text).toBe('Count to 5.');
    expect(result.description).toBe('');
  });

  it('getPrompt falls back to the template field when content is missing', async () => {
    const deps = makeDeps();
    deps.directusClient.getItems.mockResolvedValue(envelope([PROMPTS[1]]));
    const { getPrompt } = createHandlers(deps, ENABLED_PROMPTS);

    const result = await getPrompt({
      params: { name: 'translate_article', arguments: { title: 'Hello', language: 'pt' } },
    });

    expect(result.messages[0].content.text).toBe('Translate Hello to pt.');
  });

  it('getPrompt returns empty text when neither content nor template exist and no args given', async () => {
    const deps = makeDeps();
    deps.directusClient.getItems.mockResolvedValue(envelope([{ id: 'bare', name: 'bare' }]));
    const { getPrompt } = createHandlers(deps, ENABLED_PROMPTS);

    const result = await getPrompt({ params: { name: 'bare' } });

    expect(result.messages[0].content.text).toBe('');
  });

  it('getPrompt throws for a prompt that is not found', async () => {
    const deps = makeDeps();
    deps.directusClient.getItems.mockResolvedValue(envelope([]));
    const { getPrompt } = createHandlers(deps, ENABLED_PROMPTS);

    await expect(getPrompt({ params: { name: 'ghost' } })).rejects.toThrow('Prompt not found: ghost');
  });

  it('honors a custom DIRECTUS_PROMPTS_COLLECTION', async () => {
    const deps = makeDeps();
    deps.directusClient.getItems.mockResolvedValue(envelope(PROMPTS));
    const env = {
      DIRECTUS_PROMPTS_COLLECTION_ENABLED: 'true',
      DIRECTUS_PROMPTS_COLLECTION: 'my_prompts',
    } as NodeJS.ProcessEnv;
    const { listPrompts, getPrompt } = createHandlers(deps, env);

    await listPrompts();
    expect(deps.directusClient.getItems).toHaveBeenLastCalledWith('my_prompts', expect.any(Object));

    await getPrompt({ params: { name: 'summarize_article' } });
    expect(deps.directusClient.getItems).toHaveBeenLastCalledWith('my_prompts', expect.any(Object));
  });
});

describe('resources', () => {
  it('listResources returns empty list when feature is disabled', async () => {
    const deps = makeDeps();
    const { listResources } = createHandlers(deps, {} as NodeJS.ProcessEnv);

    await expect(listResources()).resolves.toEqual({ resources: [] });
    expect(deps.directusClient.getCollections).not.toHaveBeenCalled();
  });

  it('listResources exposes non-system collections with schema as directus:// URIs', async () => {
    const deps = makeDeps();
    deps.directusClient.getCollections.mockResolvedValue(envelope(COLLECTIONS));
    const { listResources } = createHandlers(deps, ENABLED_RESOURCES);

    const { resources } = await listResources();

    const names = resources.map((r: any) => r.name);
    expect(names).toEqual(['articles', 'authors', 'articles_tags', 'tags', 'comments']);
    expect(names).not.toContain('directus_users'); // system excluded by default
    expect(names).not.toContain('content_group'); // no schema -> excluded

    const articles = resources[0];
    expect(articles.uri).toBe('directus://collection/articles');
    expect(articles.description).toBe('Blog articles'); // meta.note
    expect(articles.mimeType).toBe('application/json');

    const tags = resources.find((r: any) => r.name === 'tags');
    expect(tags!.description).toBe('Directus collection: tags'); // no note -> fallback
  });

  it("includes system collections when DIRECTUS_RESOURCES_EXCLUDE_SYSTEM='false'", async () => {
    const deps = makeDeps();
    deps.directusClient.getCollections.mockResolvedValue(envelope(COLLECTIONS));
    const env = {
      DIRECTUS_RESOURCES_ENABLED: 'true',
      DIRECTUS_RESOURCES_EXCLUDE_SYSTEM: 'false',
    } as NodeJS.ProcessEnv;
    const { listResources } = createHandlers(deps, env);

    const { resources } = await listResources();

    const names = resources.map((r: any) => r.name);
    expect(names).toContain('directus_users');
    expect(names).not.toContain('content_group'); // schemaless still excluded
    expect(resources).toHaveLength(6);
  });

  it('listResources returns empty list when the client rejects', async () => {
    const deps = makeDeps();
    deps.directusClient.getCollections.mockRejectedValue(new Error('directus down'));
    const { listResources } = createHandlers(deps, ENABLED_RESOURCES);

    await expect(listResources()).resolves.toEqual({ resources: [] });
  });

  it('listResources tolerates a response without data', async () => {
    const deps = makeDeps();
    deps.directusClient.getCollections.mockResolvedValue({} as any);
    const { listResources } = createHandlers(deps, ENABLED_RESOURCES);

    await expect(listResources()).resolves.toEqual({ resources: [] });
  });

  it('readResource throws when the feature is disabled', async () => {
    const deps = makeDeps();
    const { readResource } = createHandlers(deps, {} as NodeJS.ProcessEnv);

    await expect(
      readResource({ params: { uri: 'directus://collection/articles' } })
    ).rejects.toThrow('Resources feature is disabled');
    expect(deps.directusClient.getCollection).not.toHaveBeenCalled();
  });

  it('readResource returns schema, items and meta for a valid URI', async () => {
    const deps = makeDeps();
    deps.directusClient.getCollection.mockResolvedValue(envelope(COLLECTIONS[0]));
    deps.directusClient.getItems.mockResolvedValue(envelope(ITEMS_ARTICLES, { total_count: 3 }));
    const { readResource } = createHandlers(deps, ENABLED_RESOURCES);

    const result = await readResource({ params: { uri: 'directus://collection/articles' } });

    expect(deps.directusClient.getCollection).toHaveBeenCalledWith('articles');
    expect(deps.directusClient.getItems).toHaveBeenCalledWith('articles', { limit: 10 });

    expect(result.contents).toHaveLength(1);
    expect(result.contents[0].uri).toBe('directus://collection/articles');
    expect(result.contents[0].mimeType).toBe('application/json');

    const parsed = JSON.parse(result.contents[0].text);
    expect(parsed.schema.collection).toBe('articles');
    expect(parsed.items).toEqual(ITEMS_ARTICLES);
    expect(parsed.meta).toEqual({ total_count: 3 });
  });

  it('readResource falls back to empty items/meta when the items response is bare', async () => {
    const deps = makeDeps();
    deps.directusClient.getCollection.mockResolvedValue(envelope(COLLECTIONS[0]));
    deps.directusClient.getItems.mockResolvedValue({} as any);
    const { readResource } = createHandlers(deps, ENABLED_RESOURCES);

    const result = await readResource({ params: { uri: 'directus://collection/articles' } });

    const parsed = JSON.parse(result.contents[0].text);
    expect(parsed.items).toEqual([]);
    expect(parsed.meta).toEqual({});
  });

  it('readResource throws for an invalid URI', async () => {
    const deps = makeDeps();
    const { readResource } = createHandlers(deps, ENABLED_RESOURCES);

    await expect(readResource({ params: { uri: 'https://nope/articles' } })).rejects.toThrow(
      'Invalid resource URI'
    );
    expect(deps.directusClient.getCollection).not.toHaveBeenCalled();
  });

  it('readResource rethrows client failures', async () => {
    const deps = makeDeps();
    deps.directusClient.getCollection.mockRejectedValue(new Error('forbidden'));
    const { readResource } = createHandlers(deps, ENABLED_RESOURCES);

    await expect(
      readResource({ params: { uri: 'directus://collection/articles' } })
    ).rejects.toThrow('forbidden');
  });
});

describe('createDeps / createServer', () => {
  const config = loadConfigFromEnv({
    DIRECTUS_URL: 'http://localhost:1',
    DIRECTUS_TOKEN: 'test-token',
    DIRECTUS_RETRY_DELAY: '1',
    DIRECTUS_MAX_RETRY_DELAY: '5',
  } as NodeJS.ProcessEnv);

  it('createDeps wires every real tool instance to one DirectusClient', () => {
    const deps = createDeps(config);

    expect(deps.directusClient).toBeInstanceOf(DirectusClient);
    expect(deps.collectionTools).toBeInstanceOf(CollectionTools);
    expect(deps.userTools).toBeInstanceOf(UserTools);
    expect(deps.fileTools).toBeInstanceOf(FileTools);
    expect(deps.flowTools).toBeInstanceOf(FlowTools);
    expect(deps.schemaTools).toBeInstanceOf(SchemaTools);
    expect(deps.diagnosticTools).toBeInstanceOf(DiagnosticTools);

    for (const slot of [
      'collectionTools',
      'userTools',
      'fileTools',
      'flowTools',
      'schemaTools',
      'diagnosticTools',
    ] as const) {
      expect((deps[slot] as any)['client']).toBe(deps.directusClient);
    }
  });

  it('createServer returns a Server wired with the provided deps', () => {
    const deps = makeDeps();
    const result = createServer(config, deps, {} as NodeJS.ProcessEnv);

    expect(result.server).toBeInstanceOf(Server);
    expect(result.deps).toBe(deps);
  });

  it('createServer builds default deps from the config when none are given', () => {
    const { server, deps } = createServer(config);

    expect(server).toBeInstanceOf(Server);
    expect(deps.directusClient).toBeInstanceOf(DirectusClient);
    expect(deps.collectionTools).toBeInstanceOf(CollectionTools);
  });
});
