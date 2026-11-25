// `outputSchema` for every tool, keyed by tool name.
//
// Each schema is the shared `{ status, summary }` envelope (see result.ts)
// around a tool-specific `data` object. Two rules keep the schemas honest:
//
//   - Values this server builds itself (counts, flags, echoed arguments) are
//     typed. Values that come back from Directus are described but left
//     untyped, because their shape depends on the instance's data model and a
//     client must not reject a valid result over a field nobody can predict.
//   - Nothing inside `data` is `required` unless every `ok` result carries it.
import { buildOutputSchema, type ToolStatus } from './result.js';

const str = (description: string) => ({ type: 'string', description });
const int = (description: string) => ({ type: 'integer', description });
const bool = (description: string) => ({ type: 'boolean', description });
const strings = (description: string) => ({ type: 'array', items: { type: 'string' }, description });
/** A value whose shape Directus decides. */
const directus = (description: string) => ({ description });
const list = (description: string, items: Record<string, unknown> = {}) => ({
  type: 'array',
  items,
  description,
});
const obj = (description: string, properties: Record<string, unknown> = {}) => ({
  type: 'object',
  description,
  properties,
});

const READ: ToolStatus[] = ['ok'];
const CONFIRMED: ToolStatus[] = ['ok', 'confirmation_required'];

const totalCount = directus('Total rows in the collection before pagination, when Directus reported it.');
const diffCounts = obj('How many entries of each kind the diff touches.', {
  collections: int('Collections added, changed or removed.'),
  fields: int('Fields added, changed or removed.'),
  relations: int('Relations added, changed or removed.'),
});
const validation = obj('Result of the schema checks.', {
  isValid: bool('True when no errors were found. Warnings do not affect it.'),
  errors: list('Problems that make the schema invalid.', { type: 'object' }),
  warnings: list('Problems worth fixing that do not invalidate the schema.', { type: 'object' }),
});

export const OUTPUT_SCHEMAS: Record<string, Record<string, unknown>> = {
  // Collections and items
  list_collections: buildOutputSchema({
    properties: {
      count: int('Number of collections returned.'),
      collections: list('One entry per collection.', {
        type: 'object',
        properties: {
          collection: str('Collection name.'),
          note: directus('Description from the collection metadata, or null.'),
          is_folder: bool('True for a grouping folder with no table behind it; it cannot hold items.'),
          is_inactive: bool('True when Directus refuses item reads and writes for this collection.'),
        },
        required: ['collection', 'is_folder', 'is_inactive'],
      }),
    },
    required: ['count', 'collections'],
  }, READ),

  get_collection_schema: buildOutputSchema({
    properties: {
      collection: directus('Collection name.'),
      meta: directus('Directus collection metadata.'),
      schema: directus('Database table information; null for a folder.'),
      fields: list('One entry per field.', {
        type: 'object',
        properties: {
          field: directus('Field name.'),
          type: directus('Directus field type.'),
          required: directus('Whether a value is mandatory.'),
          readonly: directus('Whether the field is read-only in the app.'),
          interface: directus('Admin-app interface, if set.'),
          note: directus('Field description, if set.'),
        },
      }),
    },
    required: ['fields'],
  }, READ),

  get_collection_items: buildOutputSchema({
    properties: {
      collection: str('Collection that was read.'),
      count: int('Number of items in this page (1 for a singleton collection).'),
      total_count: totalCount,
      filter_count: directus('Rows matching the filter before pagination, when Directus reported it.'),
      items: directus('The items: an array, or a single object for a singleton collection.'),
    },
    required: ['count'],
  }, READ),

  create_collection: buildOutputSchema({
    properties: {
      collection: str('Name of the collection that was created.'),
      folder: bool('True when a grouping folder was created instead of a table.'),
      field_count: int('Number of fields created with the collection.'),
    },
    required: ['folder', 'field_count'],
  }, READ),

  delete_collection: buildOutputSchema({
    description: 'Present for `ok` and `confirmation_required`.',
    properties: {
      collection: str('Collection targeted.'),
      deleted: bool('True once the collection and its data are gone; false while confirmation is pending.'),
    },
    required: ['deleted'],
  }, CONFIRMED),

  create_item: buildOutputSchema({
    properties: {
      collection: str('Collection the item was created in.'),
      item: directus('The created item as Directus returned it.'),
    },
  }, READ),

  update_item: buildOutputSchema({
    description: 'Present when status is `ok`.',
    properties: {
      collection: str('Collection the item belongs to.'),
      id: directus('Primary key of the updated item.'),
      item: directus('The updated item as Directus returned it.'),
    },
  }, ['ok', 'noop', 'rejected']),

  delete_items: buildOutputSchema({
    description: 'Present for `ok` and `confirmation_required`.',
    properties: {
      collection: str('Collection targeted.'),
      deleted: bool('True once the items are gone; false while confirmation is pending.'),
      ids: list('Primary keys targeted, when deleting by id.'),
      query: directus('Query targeted, when deleting by query.'),
      cascade: bool('Whether related items are deleted first.'),
      related_items: str('Related items that a cascade would affect; only while confirmation is pending.'),
    },
    required: ['deleted', 'cascade'],
  }, ['ok', 'confirmation_required', 'noop', 'rejected']),

  // Fields
  create_field: buildOutputSchema({
    properties: {
      collection: str('Collection the field was added to.'),
      field: str('Field name.'),
      type: str('Directus field type.'),
      interface: str('Admin-app interface in effect, defaulted from the type when not given.'),
      required: bool('Whether a value is mandatory.'),
      unique: bool('Whether values must be unique.'),
    },
    required: ['required', 'unique'],
  }, READ),

  update_field: buildOutputSchema({
    properties: {
      collection: str('Collection the field belongs to.'),
      field: str('Field name.'),
      changes: strings('Names of the arguments that were sent as changes.'),
    },
    required: ['changes'],
  }, READ),

  delete_field: buildOutputSchema({
    description: 'Present for `ok` and `confirmation_required`.',
    properties: {
      collection: str('Collection the field belongs to.'),
      field: str('Field name.'),
      deleted: bool('True once the field and its column are gone; false while confirmation is pending.'),
      relations: list('Relations that use this field; only while confirmation is pending.', {
        type: 'object',
        properties: {
          collection: directus('Collection holding the foreign key.'),
          field: directus('Foreign-key field.'),
          related_collection: directus('Collection the relation points at.'),
        },
      }),
    },
    required: ['deleted'],
  }, CONFIRMED),

  bulk_operations: buildOutputSchema({
    description: 'Present for `ok` (the per-operation results) and for a `rejected` validation.',
    properties: {
      outcome: {
        type: 'string',
        enum: ['completed', 'partial', 'failed'],
        description: '`completed`: no errors. `partial`: some entries failed. `failed`: nothing was changed.',
      },
      created: list('Items created, as Directus returned them.'),
      updated: list('Items updated, as Directus returned them.'),
      deleted: list('Primary keys deleted.'),
      errors: list('One entry per failed entry.', {
        type: 'object',
        properties: {
          operation: str('`create`, `update` or `delete`.'),
          index: int('Position of the entry in its input array.'),
          id: directus('Primary key, for update failures.'),
          error: str('Error message.'),
        },
        required: ['operation', 'error'],
      }),
      validation_errors: strings('Why validation refused the batch; only when status is `rejected`.'),
    },
  }, ['ok', 'noop', 'rejected']),

  // Schema analysis and relationships
  analyze_collection_schema: buildOutputSchema({
    properties: {
      collection: directus('The collection record.'),
      fields: list('Full Directus field records.'),
      relations: list('Relations where this collection is either side.'),
      relationshipMap: obj('The same relations grouped by kind.', {
        oneToMany: list('One-to-many relations.'),
        manyToOne: list('Many-to-one relations.'),
        manyToMany: list('Many-to-many relations.'),
        oneToOne: list('One-to-one relations.'),
        manyToAny: list('Many-to-any relations.'),
      }),
      validation,
    },
    required: ['fields', 'relations', 'relationshipMap', 'validation'],
  }, READ),

  analyze_relationships: buildOutputSchema({
    properties: {
      analyses: list('One entry per collection analysed.', {
        type: 'object',
        properties: {
          collection: str('Collection name.'),
          totalRelations: int('Incoming plus outgoing relations.'),
          incomingRelations: list('Relations pointing at this collection.'),
          outgoingRelations: list('Relations this collection holds.'),
          circularDependencies: strings('Dependency cycles this collection takes part in.'),
          orphanedFields: strings('Relational fields with no relation behind them.'),
          missingConstraints: strings('Relations with no foreign-key constraint.'),
        },
      }),
    },
    required: ['analyses'],
  }, READ),

  create_relationship: buildOutputSchema({
    properties: {
      type: str('Relationship kind: o2m, m2o, m2m, o2o or m2a.'),
      collection: str('Collection the relationship was created on.'),
      field: str('Relational field.'),
      related_collection: str('Collection on the other side, when the kind has exactly one.'),
      details: str('What was created: fields, junction collection and relation records.'),
    },
  }, READ),

  validate_collection_schema: buildOutputSchema({
    properties: {
      collection: str('Collection that was validated.'),
      validation,
    },
    required: ['validation'],
  }, READ),

  // Diagnostics
  diagnose_collection_access: buildOutputSchema({
    properties: {
      collection: str('Collection that was probed.'),
      timestamp: str('When the probes ran (ISO 8601).'),
      tests: {
        type: 'object',
        description: 'One entry per probe, keyed by probe name.',
        additionalProperties: {
          type: 'object',
          properties: {
            passed: bool('Whether the probe succeeded.'),
            message: str('What the probe found.'),
            error: str('Error message, when the probe failed.'),
            code: directus('Directus error code, when one was reported.'),
            data: directus('What the probe read, when it succeeded.'),
          },
          required: ['passed', 'message'],
        },
      },
      summary: obj('Roll-up of the probes.', {
        passed_tests: int('Probes that succeeded.'),
        total_tests: int('Probes that ran.'),
        success_rate: str('Share of probes that succeeded, as a percentage.'),
        overall_status: { type: 'string', enum: ['HEALTHY', 'PARTIAL', 'FAILED'], description: 'Verdict.' },
        recommendations: strings('What to do next.'),
      }),
    },
    required: ['tests', 'summary'],
  }, READ),

  refresh_collection_cache: buildOutputSchema({
    properties: {
      timestamp: str('When the refresh ran (ISO 8601).'),
      operations: list('One entry per step attempted.', {
        type: 'object',
        properties: {
          operation: str('`clear_cache`, `refresh_collections` or `verify_collection`.'),
          success: bool('Whether the step succeeded.'),
          message: str('What happened.'),
          error: str('Error message, when the step failed.'),
          data: directus('What the step read, when it succeeded.'),
        },
        required: ['operation', 'success', 'message'],
      }),
    },
    required: ['operations'],
  }, READ),

  validate_collection_creation: buildOutputSchema({
    properties: {
      collection: str('Collection that was checked.'),
      validation_steps: list('One entry per check.', {
        type: 'object',
        properties: {
          step: str('`immediate_access`, `delayed_access` or `collections_list_check`.'),
          success: bool('Whether the check passed.'),
          message: str('What the check found.'),
          data: directus('The collection record, when the delayed check read it.'),
        },
        required: ['step', 'success', 'message'],
      }),
      timeline: list('When each phase started.', {
        type: 'object',
        properties: { timestamp: str('ISO 8601 time.'), action: str('Phase name.') },
      }),
      summary: obj('Roll-up of the checks.', {
        success_rate: str('Share of checks that passed, as a percentage.'),
        status: {
          type: 'string',
          enum: ['FULLY_ACCESSIBLE', 'PARTIALLY_ACCESSIBLE', 'NOT_ACCESSIBLE'],
          description: 'Verdict.',
        },
        recommendations: strings('What to do next.'),
      }),
    },
    required: ['validation_steps', 'summary'],
  }, READ),

  // Users and files
  get_users: buildOutputSchema({
    properties: {
      count: int('Number of users in this page.'),
      total_count: totalCount,
      users: directus('The user records, limited to the requested fields.'),
    },
    required: ['count'],
  }, READ),

  get_user: buildOutputSchema({
    properties: { user: directus('The user record, limited to the requested fields.') },
  }, READ),

  get_files: buildOutputSchema({
    properties: {
      count: int('Number of files in this page.'),
      total_count: totalCount,
      files: directus('The file records, limited to the requested fields.'),
    },
    required: ['count'],
  }, READ),

  // Flows
  get_flows: buildOutputSchema({
    properties: {
      count: int('Number of flows in this page.'),
      total_count: totalCount,
      flows: directus('The flow records, limited to the requested fields.'),
    },
    required: ['count'],
  }, READ),

  get_flow: buildOutputSchema({
    properties: { flow: directus('The flow record, with its operations when they were requested.') },
  }, READ),

  create_flow: buildOutputSchema({
    properties: { flow: directus('The created flow as Directus returned it, including its id.') },
  }, READ),

  update_flow: buildOutputSchema({
    properties: {
      id: str('Flow that was updated.'),
      flow: directus('The updated flow as Directus returned it.'),
    },
  }, READ),

  delete_flow: buildOutputSchema({
    description: 'Present for `ok` and `confirmation_required`.',
    properties: {
      id: str('Flow targeted.'),
      deleted: bool('True once the flow and its operations are gone; false while confirmation is pending.'),
    },
    required: ['deleted'],
  }, CONFIRMED),

  trigger_flow: buildOutputSchema({
    properties: {
      id: str('Flow that was triggered.'),
      result: directus('Whatever the flow returned; its shape is defined by the flow.'),
    },
  }, READ),

  get_operations: buildOutputSchema({
    properties: {
      count: int('Number of operations in this page.'),
      total_count: totalCount,
      operations: directus('The operation records.'),
    },
    required: ['count'],
  }, READ),

  // Schema snapshot, diff and apply
  get_schema_snapshot: buildOutputSchema({
    description: 'Present when status is `ok`.',
    properties: {
      partial: bool('True for a partial snapshot (`version: 2`) limited to some collections.'),
      snapshot: directus('The snapshot object. Pass it unchanged to diff_schema.'),
    },
    required: ['partial'],
  }, ['ok', 'rejected']),

  diff_schema: buildOutputSchema({
    description: 'Present when status is `ok`.',
    properties: {
      has_changes: bool('False when the snapshot already matches the data model.'),
      mode: str('`mirror` (includes deletions) or `merge` (additive only).'),
      counts: diffCounts,
      diff: directus('The `{ hash, diff }` object. Pass it unchanged to apply_schema. Absent when nothing changed.'),
    },
    required: ['has_changes', 'counts'],
  }, ['ok', 'rejected']),

  apply_schema: buildOutputSchema({
    description: 'Present for `ok` and `confirmation_required`.',
    properties: {
      applied: bool('True once the data model was changed; false while confirmation is pending.'),
      counts: diffCounts,
    },
    required: ['applied', 'counts'],
  }, ['ok', 'confirmation_required', 'rejected']),

  import_data: buildOutputSchema({
    description: 'Present when status is `ok`.',
    properties: {
      batch: bool('True for a multi-collection batch import, false for a single collection.'),
      collection: str('Target collection, for a single-collection import.'),
      filename: str('File name sent to Directus.'),
      dry_run: bool('True when the batch was only simulated and nothing was written.'),
      result: directus('Per-collection summary Directus returned for a batch import.'),
    },
    required: ['batch'],
  }, ['ok', 'confirmation_required', 'rejected']),

  search_tools: buildOutputSchema({
    description: 'Present when status is `ok`.',
    properties: {
      query: str('The query that was searched.'),
      count: int('Number of tools returned.'),
      tools: list('Matching tool definitions, best match first; empty when nothing matched.', {
        type: 'object',
        properties: {
          name: str('Tool name to call.'),
          description: str('What the tool does.'),
          inputSchema: { type: 'object', description: 'JSON Schema of the tool arguments.' },
        },
        required: ['name'],
      }),
    },
    required: ['query', 'count', 'tools'],
  }, ['ok', 'rejected']),
};
