// The result contract shared by every tool.
//
// A tool method returns the human-readable `content` it always has, plus two
// optional fields the server turns into MCP `structuredContent`:
//
//   status  what actually happened, so an agent does not have to parse prose to
//           learn whether a destructive call ran or merely asked for `confirm`.
//   data    the tool-specific payload, described per tool in output-schemas.ts.
//
// Failures keep using `isError: true` and carry no structured output: the MCP
// spec exempts error results from `outputSchema`.

export const TOOL_STATUSES = ['ok', 'confirmation_required', 'noop', 'rejected'] as const;

/**
 * - `ok` — the tool did what it was asked.
 * - `confirmation_required` — nothing was changed; call again with `confirm: true`.
 * - `noop` — nothing was changed because there was nothing to do.
 * - `rejected` — nothing was sent to Directus because the arguments were unusable.
 */
export type ToolStatus = (typeof TOOL_STATUSES)[number];

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  status?: ToolStatus;
  data?: Record<string, unknown>;
}

export interface StructuredToolOutput {
  [key: string]: unknown;
  status: ToolStatus;
  summary: string;
  data?: Record<string, unknown>;
}

const SUMMARY_MAX = 300;

/** First non-empty line of a tool's text, which every tool writes as a headline. */
export function summarize(text: string): string {
  const line = text.split('\n').find((l) => l.trim().length > 0)?.trim() ?? '';
  return line.length > SUMMARY_MAX ? `${line.slice(0, SUMMARY_MAX - 1)}…` : line;
}

/** True for the `{ content: [...] }` envelope the tool classes return. */
export function isToolResult(value: unknown): value is ToolResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as ToolResult).content)
  );
}

/**
 * Build the `structuredContent` for a successful tool result.
 *
 * `data` goes through a JSON round trip so the object matches what will be on
 * the wire: `undefined` members disappear instead of failing schema validation.
 */
export function toStructuredContent(result: ToolResult): StructuredToolOutput {
  const text = result.content.find((block) => block.type === 'text')?.text ?? '';
  const structured: StructuredToolOutput = {
    status: result.status ?? 'ok',
    summary: summarize(text),
  };
  if (result.data !== undefined) {
    structured.data = JSON.parse(JSON.stringify(result.data));
  }
  return structured;
}

export interface DataSchema {
  description?: string;
  properties: Record<string, unknown>;
  required?: string[];
}

/**
 * The `outputSchema` for one tool: the shared `{ status, summary }` envelope
 * around that tool's `data`. `statuses` lists only the outcomes the tool can
 * actually report, so a read-only tool advertises `ok` and nothing else.
 */
export function buildOutputSchema(
  data?: DataSchema,
  statuses: readonly ToolStatus[] = ['ok']
): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: [...statuses],
        description:
          'Outcome of the call. `ok`: done. `confirmation_required`: nothing changed, call again with ' +
          '`confirm: true`. `noop`: nothing to do, no request sent. `rejected`: arguments unusable, no ' +
          'request sent. Failures are reported with `isError` instead and carry no structured output.',
      },
      summary: {
        type: 'string',
        description: 'One-line human-readable headline of the result.',
      },
      ...(data && {
        data: {
          type: 'object',
          description: data.description ?? 'Tool-specific payload. Absent when status is not `ok` unless noted.',
          properties: data.properties,
          ...(data.required && { required: data.required }),
        },
      }),
    },
    required: ['status', 'summary'],
  };
}
