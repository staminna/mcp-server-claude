// Structured tool output: every tool declares an outputSchema, and what the
// real tool classes return through callTool conforms to it — on the happy path
// and on the confirm / no-op / rejected paths that never reach Directus.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv-provider.js';
import { createHandlers, TOOL_DEFINITIONS, type ServerDeps } from '../../src/server.js';
import { OUTPUT_SCHEMAS } from '../../src/tools/output-schemas.js';
import {
  TOOL_STATUSES,
  buildOutputSchema,
  isToolResult,
  summarize,
  toStructuredContent,
} from '../../src/tools/result.js';
import { CollectionTools } from '../../src/tools/collection-tools.js';
import { UserTools } from '../../src/tools/user-tools.js';
import { FileTools } from '../../src/tools/file-tools.js';
import { FlowTools } from '../../src/tools/flow-tools.js';
import { SchemaTools } from '../../src/tools/schema-tools.js';
import { DiagnosticTools } from '../../src/tools/diagnostic-tools.js';
import { logger } from '../../src/utils/logger.js';
import { makeClientStub, type StubbedClient } from '../helpers/stubs.js';
import {
  COLLECTIONS,
  FIELDS_ARTICLES,
  FILES,
  FLOWS,
  ITEMS_ARTICLES,
  OPERATIONS,
  RELATIONS,
  USERS,
  envelope,
} from '../helpers/fixtures.js';

const ajv = new AjvJsonSchemaValidator();

function realDeps(stub: StubbedClient): ServerDeps {
  return {
    directusClient: stub,
    collectionTools: new CollectionTools(stub),
    userTools: new UserTools(stub),
    fileTools: new FileTools(stub),
    flowTools: new FlowTools(stub),
    schemaTools: new SchemaTools(stub),
    diagnosticTools: new DiagnosticTools(stub),
  };
}

function seededStub(): StubbedClient {
  const stub = makeClientStub();
  stub.getCollections.mockResolvedValue(envelope(COLLECTIONS));
  stub.getCollection.mockResolvedValue(envelope(COLLECTIONS[0]));
  stub.getFields.mockResolvedValue(envelope(FIELDS_ARTICLES));
  stub.getRelations.mockResolvedValue(envelope(RELATIONS));
  stub.getItems.mockResolvedValue(envelope(ITEMS_ARTICLES, { total_count: 3, filter_count: 3 }));
  stub.createItem.mockResolvedValue(envelope(ITEMS_ARTICLES[0]));
  stub.updateItem.mockResolvedValue(envelope(ITEMS_ARTICLES[0]));
  stub.getUsers.mockResolvedValue(envelope(USERS, { total_count: USERS.length }));
  stub.getUser.mockResolvedValue(envelope(USERS[0]));
  stub.getFiles.mockResolvedValue(envelope(FILES, { total_count: FILES.length }));
  stub.getFlows.mockResolvedValue(envelope(FLOWS, { total_count: FLOWS.length }));
  stub.get.mockResolvedValue(envelope(OPERATIONS, { total_count: OPERATIONS.length }));
  stub.post.mockResolvedValue(envelope(FLOWS[0]));
  stub.patch.mockResolvedValue(envelope(FLOWS[0]));
  stub.triggerFlow.mockResolvedValue(envelope({ ran: true }));
  stub.getSchemaSnapshot.mockResolvedValue(
    envelope({ version: 1, directus: '12.6.0', vendor: 'postgres', collections: [], fields: [], relations: [] })
  );
  stub.diffSchema.mockResolvedValue(
    envelope({ hash: 'abc', diff: { collections: [{}], fields: [{}, {}], relations: [] } })
  );
  stub.importDataBatch.mockResolvedValue(
    envelope({ mode: 'add', collections: { articles: { new: [1], existing: [], deleted: [] } } })
  );
  return stub;
}

const DIFF = { hash: 'abc', diff: { collections: [{}], fields: [], relations: [] } };
const JSON_FILE = Buffer.from('[{"title":"a"}]').toString('base64');

// [tool, arguments, expected status, whether `data` must be present]
const CASES: Array<[string, Record<string, unknown>, string, boolean]> = [
  ['list_collections', {}, 'ok', true],
  ['get_collection_schema', { collection: 'articles' }, 'ok', true],
  ['get_collection_items', { collection: 'articles' }, 'ok', true],
  ['create_collection', { collection: 'notes', fields: [{ field: 'title', type: 'string' }] }, 'ok', true],
  ['create_collection', { collection: 'group', folder: true }, 'ok', true],
  ['delete_collection', { collection: 'articles' }, 'confirmation_required', true],
  ['delete_collection', { collection: 'articles', confirm: true }, 'ok', true],
  ['create_item', { collection: 'articles', data: { title: 'a' } }, 'ok', true],
  ['update_item', { collection: 'articles', id: 1, data: { title: 'b' } }, 'ok', true],
  ['update_item', { collection: 'articles', id: 1, data: {} }, 'noop', false],
  ['update_item', { collection: 'articles', id: 1, data: { a: 1 }, version: 'published' }, 'rejected', false],
  ['delete_items', { collection: 'articles' }, 'noop', false],
  ['delete_items', { collection: 'articles', ids: [1], query: { limit: -1 } }, 'rejected', false],
  ['delete_items', { collection: 'articles', query: { limit: -1 }, cascadeDelete: true }, 'rejected', false],
  ['delete_items', { collection: 'articles', ids: [1, 2], cascadeDelete: true }, 'confirmation_required', true],
  ['delete_items', { collection: 'articles', query: { limit: -1 } }, 'confirmation_required', true],
  ['delete_items', { collection: 'articles', ids: [1, 2], confirm: true }, 'ok', true],
  ['create_field', { collection: 'articles', field: 'subtitle', type: 'string' }, 'ok', true],
  ['update_field', { collection: 'articles', field: 'title', note: 'Headline' }, 'ok', true],
  ['delete_field', { collection: 'articles', field: 'author' }, 'confirmation_required', true],
  ['delete_field', { collection: 'articles', field: 'author', confirm: true }, 'ok', true],
  ['bulk_operations', { collection: 'articles', operations: {} }, 'noop', false],
  ['bulk_operations', { collection: 'articles', operations: { update: [{ title: 'x' }] }, validate: true }, 'rejected', true],
  ['bulk_operations', { collection: 'articles', operations: { create: [{ title: 'a' }], delete: [9] } }, 'ok', true],
  ['analyze_collection_schema', { collection: 'articles', includeRelations: true, validateConstraints: true }, 'ok', true],
  ['analyze_relationships', {}, 'ok', true],
  ['create_relationship', { type: 'm2o', collection: 'articles', field: 'editor', related_collection: 'authors' }, 'ok', true],
  ['validate_collection_schema', { collection: 'articles', strict: true }, 'ok', true],
  ['diagnose_collection_access', { collection: 'articles', includeFields: true, includeRelations: true, includePermissions: true }, 'ok', true],
  ['refresh_collection_cache', { collection: 'articles' }, 'ok', true],
  ['validate_collection_creation', { collection: 'articles', waitTime: 1 }, 'ok', true],
  ['get_users', {}, 'ok', true],
  ['get_user', { id: 'aaaa-1111' }, 'ok', true],
  ['get_files', {}, 'ok', true],
  ['get_flows', {}, 'ok', true],
  ['get_flow', { id: 'flow-0001' }, 'ok', true],
  ['create_flow', { name: 'Notify' }, 'ok', true],
  ['update_flow', { id: 'flow-0001', data: { status: 'inactive' } }, 'ok', true],
  ['delete_flow', { id: 'flow-0001' }, 'confirmation_required', true],
  ['delete_flow', { id: 'flow-0001', confirm: true }, 'ok', true],
  ['trigger_flow', { id: 'flow-0001' }, 'ok', true],
  ['get_operations', { flow_id: 'flow-0001' }, 'ok', true],
  ['get_schema_snapshot', {}, 'ok', true],
  ['get_schema_snapshot', { include_collections: ['a'], exclude_collections: ['b'] }, 'rejected', false],
  ['diff_schema', { snapshot: { version: 1 } }, 'ok', true],
  ['diff_schema', {}, 'rejected', false],
  ['apply_schema', { diff: DIFF }, 'confirmation_required', true],
  ['apply_schema', { diff: DIFF, confirm: true }, 'ok', true],
  ['apply_schema', {}, 'rejected', false],
  ['import_data', { collection: 'articles', file_data: JSON_FILE }, 'ok', true],
  ['import_data', { file_data: JSON_FILE, dry_run: true }, 'ok', true],
  ['import_data', { file_data: JSON_FILE, dangerously_allow_delete: true }, 'confirmation_required', false],
  ['import_data', { file_data: JSON_FILE, file_path: '/tmp/x.json' }, 'rejected', false],
  ['import_data', { collection: 'articles', file_data: JSON_FILE, mode: 'merge' }, 'rejected', false],
  ['search_tools', { query: 'delete rows' }, 'ok', true],
  ['search_tools', { query: 'zzzz_nomatch' }, 'ok', true],
  ['search_tools', {}, 'rejected', false],
];

let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true) as any;
});

afterEach(() => {
  stderrSpy.mockRestore();
  vi.restoreAllMocks();
  delete process.env.DIRECTUS_MAX_PAYLOAD_BYTES;
  delete process.env.DIRECTUS_IMPORT_MAX_FILE_SIZE;
});

describe('outputSchema declarations', () => {
  it('every tool declares one, and no schema is left without a tool', () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name).sort();
    expect(Object.keys(OUTPUT_SCHEMAS).sort()).toEqual(names);
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.outputSchema, `${tool.name} has no outputSchema`).toBeDefined();
    }
  });

  it.each(TOOL_DEFINITIONS.map((t) => [t.name, t.outputSchema] as const))(
    '%s is a compilable object schema around the shared envelope',
    (_name, schema: any) => {
      expect(schema.type).toBe('object');
      expect(schema.required).toEqual(['status', 'summary']);
      for (const status of schema.properties.status.enum) {
        expect(TOOL_STATUSES).toContain(status);
      }
      expect(schema.properties.status.enum).toContain('ok');
      expect(() => ajv.getValidator(schema)).not.toThrow();
    }
  );

  it('advertises confirmation_required on every tool that takes confirm', () => {
    for (const tool of TOOL_DEFINITIONS) {
      const takesConfirm = 'confirm' in ((tool.inputSchema as any).properties ?? {});
      const statuses = (tool.outputSchema as any).properties.status.enum as string[];
      expect(statuses.includes('confirmation_required'), tool.name).toBe(takesConfirm);
    }
  });

  it('covers every tool with at least one conformance case', () => {
    const covered = new Set(CASES.map(([name]) => name));
    for (const tool of TOOL_DEFINITIONS) {
      expect(covered.has(tool.name), `${tool.name} has no conformance case`).toBe(true);
    }
  });
});

describe('structuredContent conformance (real tool classes)', () => {
  it.each(CASES)('%s %j -> %s', async (name, args, status, hasData) => {
    const warn = vi.spyOn(logger, 'warn');
    const { callTool } = createHandlers(realDeps(seededStub()), {} as NodeJS.ProcessEnv);

    const result: any = await callTool({ params: { name, arguments: args } });

    expect(result.isError, result.content[0].text).toBeUndefined();
    expect(result.content[0].type).toBe('text');
    // The text block is the tool's own prose, not a JSON-encoded envelope.
    expect(result.content[0].text.startsWith('{\n  "content"')).toBe(false);

    const structured = result.structuredContent;
    expect(structured.status).toBe(status);
    expect(structured.summary.length).toBeGreaterThan(0);
    expect(structured.data !== undefined, 'data presence').toBe(hasData);

    const check = ajv.getValidator(OUTPUT_SCHEMAS[name] as any)(structured);
    expect(check.valid, check.errorMessage).toBe(true);
    // The safety net did not have to strip anything to get there.
    expect(warn).not.toHaveBeenCalled();
    // And it survives the wire unchanged.
    expect(JSON.parse(JSON.stringify(structured))).toEqual(structured);
  });

  it('reports payload-size refusals as rejected', async () => {
    process.env.DIRECTUS_MAX_PAYLOAD_BYTES = '10';
    process.env.DIRECTUS_IMPORT_MAX_FILE_SIZE = '4';
    const { callTool } = createHandlers(realDeps(seededStub()), {} as NodeJS.ProcessEnv);

    for (const [name, args] of [
      ['diff_schema', { snapshot: { version: 1, collections: ['a', 'b'] } }],
      ['apply_schema', { diff: DIFF }],
      ['import_data', { collection: 'articles', file_data: JSON_FILE }],
    ] as const) {
      const result: any = await callTool({ params: { name, arguments: args } });
      expect(result.structuredContent.status, name).toBe('rejected');
      expect(result.isError).toBeUndefined();
    }
  });

  it('describes list_collections entries with folder and inactive flags', async () => {
    const { callTool } = createHandlers(realDeps(seededStub()), {} as NodeJS.ProcessEnv);
    const result: any = await callTool({ params: { name: 'list_collections', arguments: {} } });
    const { count, collections } = result.structuredContent.data;
    expect(count).toBe(collections.length);
    for (const entry of collections) {
      expect(typeof entry.collection).toBe('string');
      expect(typeof entry.is_folder).toBe('boolean');
      expect(typeof entry.is_inactive).toBe('boolean');
    }
  });

  it('reports a diff that changes nothing as ok with has_changes false', async () => {
    const stub = seededStub();
    stub.diffSchema.mockResolvedValue(envelope(null));
    const { callTool } = createHandlers(realDeps(stub), {} as NodeJS.ProcessEnv);
    const result: any = await callTool({ params: { name: 'diff_schema', arguments: { snapshot: { version: 1 } } } });
    expect(result.structuredContent.data).toEqual({
      has_changes: false,
      mode: 'mirror',
      counts: { collections: 0, fields: 0, relations: 0 },
    });
  });

  it('grades a bulk run by what actually changed', async () => {
    const stub = seededStub();
    stub.createItem.mockRejectedValueOnce(new Error('nope'));
    const { callTool } = createHandlers(realDeps(stub), {} as NodeJS.ProcessEnv);
    const partial: any = await callTool({
      params: { name: 'bulk_operations', arguments: { collection: 'articles', operations: { create: [{ a: 1 }, { a: 2 }] } } },
    });
    expect(partial.structuredContent.data.outcome).toBe('partial');
    expect(partial.structuredContent.data.errors).toHaveLength(1);

    stub.createItem.mockRejectedValue(new Error('nope'));
    const failed: any = await callTool({
      params: { name: 'bulk_operations', arguments: { collection: 'articles', operations: { create: [{ a: 1 }] } } },
    });
    expect(failed.structuredContent.data.outcome).toBe('failed');
  });
});

describe('callTool result handling', () => {
  it('surfaces a tool-level failure as isError, with no structured output', async () => {
    const stub = seededStub();
    stub.getCollections.mockRejectedValue(new Error('directus is down'));
    const { callTool } = createHandlers(realDeps(stub), {} as NodeJS.ProcessEnv);

    const result: any = await callTool({ params: { name: 'list_collections', arguments: {} } });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Error listing collections: directus is down');
    expect(result.structuredContent).toBeUndefined();
  });

  it('falls back to the envelope when a payload drifts from its schema', async () => {
    const warn = vi.spyOn(logger, 'warn');
    const deps = realDeps(seededStub());
    deps.collectionTools.listCollections = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'Available collections (1):' }],
      data: { count: 'one', collections: 'not-an-array' },
    });
    const { callTool } = createHandlers(deps, {} as NodeJS.ProcessEnv);

    const result: any = await callTool({ params: { name: 'list_collections', arguments: {} } });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ status: 'ok', summary: 'Available collections (1):' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('list_collections');
  });

  it('wraps a result that is not a content envelope instead of dropping it', async () => {
    const deps = realDeps(seededStub());
    deps.userTools.getUsers = vi.fn().mockResolvedValue({ plain: 'object' });
    const { callTool } = createHandlers(deps, {} as NodeJS.ProcessEnv);

    const result: any = await callTool({ params: { name: 'get_users', arguments: {} } });

    expect(JSON.parse(result.content[0].text)).toEqual({ plain: 'object' });
    expect(result.structuredContent.status).toBe('ok');
  });
});

describe('result helpers', () => {
  it('summarize takes the first non-empty line and caps its length', () => {
    expect(summarize('\n\n  Headline here \nrest')).toBe('Headline here');
    expect(summarize('')).toBe('');
    const long = summarize('x'.repeat(500));
    expect(long).toHaveLength(300);
    expect(long.endsWith('…')).toBe(true);
  });

  it('toStructuredContent defaults to ok and drops undefined members', () => {
    expect(toStructuredContent({ content: [{ type: 'text', text: 'Done' }] })).toEqual({ status: 'ok', summary: 'Done' });
    expect(
      toStructuredContent({
        content: [{ type: 'text', text: 'Done' }],
        status: 'noop',
        data: { kept: 1, dropped: undefined },
      })
    ).toEqual({ status: 'noop', summary: 'Done', data: { kept: 1 } });
    expect(toStructuredContent({ content: [] }).summary).toBe('');
  });

  it('isToolResult recognises only content envelopes', () => {
    expect(isToolResult({ content: [] })).toBe(true);
    expect(isToolResult({ content: 'text' })).toBe(false);
    expect(isToolResult(null)).toBe(false);
    expect(isToolResult('text')).toBe(false);
  });

  it('buildOutputSchema omits data when a tool has none', () => {
    const bare = buildOutputSchema() as any;
    expect(bare.properties.data).toBeUndefined();
    expect(bare.properties.status.enum).toEqual(['ok']);

    const withData = buildOutputSchema({ properties: { n: { type: 'integer' } }, required: ['n'] }, ['ok', 'noop']) as any;
    expect(withData.properties.data.required).toEqual(['n']);
    expect(withData.properties.status.enum).toEqual(['ok', 'noop']);
  });
});
