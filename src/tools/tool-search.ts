// Keyword search over the server's own tool definitions.
//
// Mirrors the search-first tool discovery Directus 12.3.0 added for its MCP
// surface (#27797), without hiding anything: listTools still returns every
// definition, and this is an additional entry point for clients that would
// rather ask than scan.
//
// Deliberately a pure function rather than a class — it needs no Directus
// client, so it stays trivially testable and adds no ServerDeps wiring.

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
  annotations?: Record<string, unknown>;
  keywords?: string[];
}

/** Always surfaced, so a caller always has a route into the data model. */
const PINNED = 'get_collection_schema';

const DEFAULT_LIMIT = 10;

/** Score one definition against the query terms. Higher is a better match. */
function scoreTool(tool: ToolDefinition, terms: string[]): number {
  const name = tool.name.toLowerCase();
  const description = tool.description.toLowerCase();
  const keywords = (tool.keywords ?? []).map((k) => k.toLowerCase());

  let score = 0;

  for (const term of terms) {
    if (name === term) score += 100;
    else if (name.includes(term)) score += 50;

    if (keywords.includes(term)) score += 30;
    else if (keywords.some((k) => k.includes(term))) score += 15;

    if (description.includes(term)) score += 10;
  }

  return score;
}

/**
 * Find the tools matching a free-text task description.
 *
 * Returns full definitions so the caller can invoke a result directly rather
 * than making a second lookup.
 */
export function searchTools(
  definitions: readonly ToolDefinition[],
  args: { query?: string; limit?: number } = {}
): { content: Array<{ type: string; text: string }> } {
  const query = (args.query ?? '').trim();

  if (!query) {
    return {
      content: [{ type: 'text', text: '❌ `query` is required — describe the task you want a tool for.' }]
    };
  }

  const terms = query.toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean);
  const limit = args.limit && args.limit > 0 ? args.limit : DEFAULT_LIMIT;

  const scored = definitions
    .map((tool) => ({ tool, score: scoreTool(tool, terms) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name));

  if (scored.length === 0) {
    return {
      content: [{
        type: 'text',
        text: `No tools matched "${query}". Call tools/list to see all ${definitions.length} tools.`
      }]
    };
  }

  const matches = scored.slice(0, limit).map((entry) => entry.tool);

  // Pin the schema tool so a successful search always includes a route into the
  // data model, even when the query does not mention it. Not added to an empty
  // result — "no matches" is more useful there than one unrelated tool.
  if (!matches.some((t) => t.name === PINNED)) {
    const pinned = definitions.find((t) => t.name === PINNED);
    if (pinned) matches.unshift(pinned);
  }

  return {
    content: [{
      type: 'text',
      text: `Found ${matches.length} tool(s) matching "${query}":\n\n` +
            `\`\`\`json\n${JSON.stringify(matches, null, 2)}\n\`\`\``
    }]
  };
}
