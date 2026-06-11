// End-to-end: spawn the built server (dist/index.js) over stdio with the MCP
// SDK client, against an in-process mock Directus on an ephemeral port.
// Run via `npm run test:e2e` (builds first). Subprocess code does not count
// toward coverage — these tests verify the real wire behavior.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startMockDirectus, type MockDirectus } from '../helpers/mock-directus.js';

const REPO = process.cwd();

const EXPECTED_TOOLS = [
  'analyze_collection_schema',
  'analyze_relationships',
  'bulk_operations',
  'create_collection',
  'create_field',
  'create_flow',
  'create_item',
  'create_relationship',
  'delete_collection',
  'delete_field',
  'delete_flow',
  'delete_items',
  'diagnose_collection_access',
  'get_collection_items',
  'get_collection_schema',
  'get_files',
  'get_flow',
  'get_flows',
  'get_operations',
  'get_user',
  'get_users',
  'list_collections',
  'refresh_collection_cache',
  'trigger_flow',
  'update_field',
  'update_flow',
  'update_item',
  'validate_collection_creation',
  'validate_collection_schema',
];

function baseEnv(mockUrl: string): Record<string, string> {
  // Filter undefined values out of process.env for the spawn env type.
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([, v]) => v !== undefined)
  ) as Record<string, string>;
  return {
    ...inherited,
    DIRECTUS_URL: mockUrl,
    DIRECTUS_TOKEN: 'e2e-token',
    LOG_LEVEL: 'ERROR',
    DIRECTUS_RETRIES: '1',
    DIRECTUS_RETRY_DELAY: '1',
    DIRECTUS_MAX_RETRY_DELAY: '2',
  };
}

describe('MCP server e2e (features enabled)', () => {
  let mock: MockDirectus;
  let client: Client;

  beforeAll(async () => {
    mock = await startMockDirectus();
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['dist/index.js'],
      cwd: REPO,
      env: {
        ...baseEnv(mock.url),
        DIRECTUS_PROMPTS_COLLECTION_ENABLED: 'true',
        DIRECTUS_RESOURCES_ENABLED: 'true',
      },
    });
    client = new Client({ name: 'e2e-tests', version: '1.0.0' });
    await client.connect(transport);
  }, 30_000);

  afterAll(async () => {
    await client?.close();
    await mock?.stop();
  }, 15_000);

  it('reports its server identity', () => {
    expect(client.getServerVersion()).toMatchObject({
      name: 'directus-mcp-server-enhanced',
      version: '2.0.0',
    });
  });

  it('lists exactly the 29 expected tools with object schemas', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(EXPECTED_TOOLS);
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe('object');
    }
    const items = tools.find((t) => t.name === 'get_collection_items')!;
    expect(items.inputSchema.required).toEqual(['collection']);
    const update = tools.find((t) => t.name === 'update_item')!;
    expect(update.inputSchema.required).toEqual(['collection', 'id', 'data']);
  });

  it('executes list_collections with the configured Bearer token', async () => {
    const result = await client.callTool({ name: 'list_collections', arguments: {} });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain('articles');
    const req = mock.lastRequest('GET', '/collections');
    expect(req?.headers.authorization).toBe('Bearer e2e-token');
  });

  it('serializes filters for get_collection_items', async () => {
    const filter = { status: { _eq: 'published' } };
    const result = await client.callTool({
      name: 'get_collection_items',
      arguments: { collection: 'articles', filter, limit: 2 },
    });
    expect(result.isError).toBeFalsy();
    const req = mock.lastRequest('GET', '/items/articles');
    expect(req?.query.filter).toBe(JSON.stringify(filter));
    expect(req?.query.limit).toBe('2');
  });

  it('returns isError for unknown tools', async () => {
    const result = await client.callTool({ name: 'definitely_not_a_tool', arguments: {} });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain('Unknown tool: definitely_not_a_tool');
  });

  it('lists prompts from the ai_prompts collection', async () => {
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual(['summarize_article', 'translate_article']);
    const summarize = prompts.find((p) => p.name === 'summarize_article')!;
    expect(summarize.arguments).toEqual([
      expect.objectContaining({ name: 'title' }),
      expect.objectContaining({ name: 'words' }),
    ]);
  });

  it('interpolates {{arg}} placeholders in prompts/get', async () => {
    const prompt = await client.getPrompt({
      name: 'summarize_article',
      arguments: { title: 'Directus Rocks', words: '50' },
    });
    const text = (prompt.messages[0].content as { type: string; text: string }).text;
    expect(text).toContain('Directus Rocks');
    expect(text).toContain('50');
    expect(text).not.toContain('{{title}}');
    expect(text).not.toContain('{{words}}');
  });

  it('exposes non-system collections with schemas as resources', async () => {
    const { resources } = await client.listResources();
    const uris = resources.map((r) => r.uri);
    expect(uris).toContain('directus://collection/articles');
    expect(uris).not.toContain('directus://collection/directus_users'); // system excluded
    expect(uris).not.toContain('directus://collection/content_group'); // no schema
  });

  it('reads a collection resource with schema and sample items', async () => {
    const result = await client.readResource({ uri: 'directus://collection/articles' });
    const payload = JSON.parse((result.contents[0] as { text: string }).text);
    expect(payload.schema).toMatchObject({ collection: 'articles' });
    expect(Array.isArray(payload.items)).toBe(true);
    expect(payload.items.length).toBeGreaterThan(0);
  });
});

describe('MCP server e2e (prompts/resources disabled)', () => {
  let mock: MockDirectus;
  let client: Client;

  beforeAll(async () => {
    mock = await startMockDirectus();
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['dist/index.js'],
      cwd: REPO,
      env: baseEnv(mock.url), // no enable flags
    });
    client = new Client({ name: 'e2e-tests-disabled', version: '1.0.0' });
    await client.connect(transport);
  }, 30_000);

  afterAll(async () => {
    await client?.close();
    await mock?.stop();
  }, 15_000);

  it('returns no prompts when the feature flag is off', async () => {
    const { prompts } = await client.listPrompts();
    expect(prompts).toEqual([]);
  });

  it('returns no resources when the feature flag is off', async () => {
    const { resources } = await client.listResources();
    expect(resources).toEqual([]);
  });
});
