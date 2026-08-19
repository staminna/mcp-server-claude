// Unit tests for src/tools/tool-search.ts.
import { describe, it, expect } from 'vitest';
import { searchTools, type ToolDefinition } from '../../src/tools/tool-search.js';
import { TOOL_DEFINITIONS } from '../../src/server.js';

const DEFS = TOOL_DEFINITIONS as unknown as ToolDefinition[];

function parse(result: { content: Array<{ text: string }> }): ToolDefinition[] {
  const match = result.content[0]!.text.match(/```json\n([\s\S]*?)\n```/);
  if (!match) return [];
  return JSON.parse(match[1]!);
}

describe('searchTools', () => {
  it('requires a query', () => {
    const result = searchTools(DEFS, {});
    expect(result.content[0]!.text).toContain('`query` is required');
  });

  it('finds the schema tools for a schema query', () => {
    const names = parse(searchTools(DEFS, { query: 'schema snapshot' })).map((t) => t.name);
    expect(names).toContain('get_schema_snapshot');
  });

  it('ranks an exact name match first', () => {
    const names = parse(searchTools(DEFS, { query: 'delete_items' })).map((t) => t.name);
    // get_collection_schema is pinned at the front; the exact match leads the rest.
    expect(names.filter((n) => n !== 'get_collection_schema')[0]).toBe('delete_items');
  });

  it('matches on keywords that do not appear in the name or description', () => {
    const names = parse(searchTools(DEFS, { query: 'csv' })).map((t) => t.name);
    expect(names).toContain('import_data');
  });

  it('respects the limit', () => {
    const limited = parse(searchTools(DEFS, { query: 'collection', limit: 2 }));
    // limit applies to scored matches; the pinned schema tool may be added on top.
    expect(limited.length).toBeLessThanOrEqual(3);
  });

  it('always pins the collection schema tool', () => {
    const names = parse(searchTools(DEFS, { query: 'flow' })).map((t) => t.name);
    expect(names).toContain('get_collection_schema');
  });

  it('reports no matches for nonsense', () => {
    const result = searchTools(DEFS, { query: 'zzzzqqqq' });
    expect(result.content[0]!.text).toContain('No tools matched');
  });

  it('returns full definitions, not just names', () => {
    const [first] = parse(searchTools(DEFS, { query: 'delete rows' }));
    expect(first).toHaveProperty('inputSchema');
    expect(first).toHaveProperty('description');
  });

  it('breaks score ties by name', () => {
    const defs: ToolDefinition[] = [
      { name: 'zebra', description: 'x', inputSchema: {}, keywords: ['shared'] },
      { name: 'alpha', description: 'x', inputSchema: {}, keywords: ['shared'] },
    ];
    const names = parse(searchTools(defs, { query: 'shared' })).map((t) => t.name);
    expect(names).toEqual(['alpha', 'zebra']);
  });

  it('handles a definition set with no pinned tool', () => {
    const defs: ToolDefinition[] = [{ name: 'solo', description: 'a lonely tool', inputSchema: {} }];
    const names = parse(searchTools(defs, { query: 'lonely' })).map((t) => t.name);
    expect(names).toEqual(['solo']);
  });
});
