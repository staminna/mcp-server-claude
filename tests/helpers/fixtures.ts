// Shared Directus payload fixtures used across unit, integration and e2e tests.
// All responses follow the Directus REST envelope: { data, meta? }.

export const COLLECTIONS = [
  {
    collection: 'articles',
    meta: {
      collection: 'articles',
      icon: 'article',
      note: 'Blog articles',
      hidden: false,
      singleton: false,
      versioning: false,
    },
    schema: { name: 'articles' },
  },
  {
    collection: 'authors',
    meta: {
      collection: 'authors',
      icon: 'person',
      note: 'Article authors',
      hidden: false,
      singleton: false,
    },
    schema: { name: 'authors' },
  },
  {
    collection: 'articles_tags',
    meta: { collection: 'articles_tags', hidden: true },
    schema: { name: 'articles_tags' },
  },
  {
    collection: 'tags',
    meta: { collection: 'tags' },
    schema: { name: 'tags' },
  },
  {
    collection: 'comments',
    meta: { collection: 'comments' },
    schema: { name: 'comments' },
  },
  // Folder-only collection (no schema) — must be filtered out of MCP resources.
  {
    collection: 'content_group',
    meta: { collection: 'content_group', note: 'A folder' },
    schema: null,
  },
  // System collection — excluded from resources unless configured otherwise.
  {
    collection: 'directus_users',
    meta: { collection: 'directus_users' },
    schema: { name: 'directus_users' },
  },
];

export const FIELDS_ARTICLES = [
  {
    collection: 'articles',
    field: 'id',
    type: 'integer',
    meta: { interface: 'input', required: true, hidden: false },
    schema: { name: 'id', is_primary_key: true, is_nullable: false },
  },
  {
    collection: 'articles',
    field: 'title',
    type: 'string',
    meta: { interface: 'input', required: true, note: 'Article title' },
    schema: { name: 'title', is_nullable: false },
  },
  {
    collection: 'articles',
    field: 'status',
    type: 'string',
    meta: { interface: 'select-dropdown', required: false },
    schema: { name: 'status', is_nullable: true, default_value: 'draft' },
  },
  {
    collection: 'articles',
    field: 'author',
    type: 'integer',
    meta: { interface: 'select-dropdown-m2o', required: false, special: ['m2o'] },
    schema: { name: 'author', is_nullable: true, foreign_key_table: 'authors' },
  },
];

export const RELATIONS = [
  // M2O: articles.author -> authors
  {
    collection: 'articles',
    field: 'author',
    related_collection: 'authors',
    meta: {
      many_collection: 'articles',
      many_field: 'author',
      one_collection: 'authors',
      one_field: 'articles',
    },
    schema: { table: 'articles', column: 'author', foreign_key_table: 'authors' },
  },
  // O2M side is represented by the same relation viewed from authors.articles
  // M2M: articles <-> tags via articles_tags (junction_field set)
  {
    collection: 'articles_tags',
    field: 'articles_id',
    related_collection: 'articles',
    meta: {
      many_collection: 'articles_tags',
      many_field: 'articles_id',
      one_collection: 'articles',
      junction_field: 'tags_id',
    },
    schema: { table: 'articles_tags', column: 'articles_id', foreign_key_table: 'articles' },
  },
  {
    collection: 'articles_tags',
    field: 'tags_id',
    related_collection: 'tags',
    meta: {
      many_collection: 'articles_tags',
      many_field: 'tags_id',
      one_collection: 'tags',
      junction_field: 'articles_id',
    },
    schema: { table: 'articles_tags', column: 'tags_id', foreign_key_table: 'tags' },
  },
  // M2A: comments.item -> articles | authors (one_allowed_collections)
  {
    collection: 'comments',
    field: 'item',
    related_collection: null,
    meta: {
      many_collection: 'comments',
      many_field: 'item',
      one_allowed_collections: ['articles', 'authors'],
      one_collection_field: 'collection',
    },
    schema: { table: 'comments', column: 'item' },
  },
];

export const ITEMS_ARTICLES = [
  { id: 1, title: 'Hello Directus', status: 'published', author: 1 },
  { id: 2, title: 'MCP servers in practice', status: 'draft', author: 1 },
  { id: 3, title: 'Directus 12 upgrade notes', status: 'published', author: 2 },
];

export const USERS = [
  {
    id: 'aaaa-1111',
    email: 'ada@example.com',
    first_name: 'Ada',
    last_name: 'Lovelace',
    status: 'active',
    role: 'role-admin',
  },
  {
    id: 'bbbb-2222',
    email: 'grace@example.com',
    first_name: 'Grace',
    last_name: 'Hopper',
    status: 'active',
    role: 'role-editor',
  },
];

export const ROLES = [
  { id: 'role-admin', name: 'Administrator', admin_access: true },
  { id: 'role-editor', name: 'Editor', admin_access: false },
];

export const FILES = [
  {
    id: 'file-0001',
    filename_download: 'photo.jpg',
    title: 'A photo',
    type: 'image/jpeg',
    filesize: 1024,
    folder: null,
  },
  {
    id: 'file-0002',
    filename_download: 'doc.pdf',
    title: 'A document',
    type: 'application/pdf',
    filesize: 2048,
    folder: 'folder-1',
  },
];

export const FOLDERS = [
  { id: 'folder-1', name: 'Documents', parent: null },
];

export const FLOWS = [
  {
    id: 'flow-0001',
    name: 'Notify on publish',
    status: 'active',
    trigger: 'event',
    description: 'Sends a notification when an article is published',
    operation: 'op-0001',
  },
  {
    id: 'flow-0002',
    name: 'Nightly cleanup',
    status: 'inactive',
    trigger: 'schedule',
    description: 'Removes stale drafts',
    operation: null,
  },
];

export const OPERATIONS = [
  {
    id: 'op-0001',
    flow: 'flow-0001',
    key: 'send_notification',
    type: 'notification',
    position_x: 19,
    position_y: 1,
    options: {},
  },
];

export const PERMISSIONS = [
  { id: 1, collection: 'articles', action: 'read', role: 'role-editor' },
];

// Prompts stored in the ai_prompts collection (DIRECTUS_PROMPTS_COLLECTION).
export const PROMPTS = [
  {
    id: 'prompt-1',
    name: 'summarize_article',
    description: 'Summarize an article',
    status: 'published',
    content: 'Summarize the article titled {{title}} in {{words}} words.',
    arguments: JSON.stringify([
      { name: 'title', description: 'Article title', required: true },
      { name: 'words', description: 'Word budget', required: false },
    ]),
  },
  {
    id: 'prompt-2',
    name: 'translate_article',
    description: 'Translate an article',
    status: 'published',
    template: 'Translate {{title}} to {{language}}.',
    arguments: JSON.stringify([
      { name: 'title', description: 'Article title', required: true },
      { name: 'language', description: 'Target language', required: true },
    ]),
  },
];

export const SERVER_INFO = { project: { project_name: 'Test Project' }, version: '12.0.0' };

/** Wrap a payload in the Directus response envelope. */
export function envelope<T>(data: T, meta?: Record<string, unknown>) {
  return meta === undefined ? { data } : { data, meta };
}

/** Directus-format error body. */
export function directusError(message: string, code = 'INTERNAL_SERVER_ERROR', extensions: Record<string, unknown> = {}) {
  return { errors: [{ message, extensions: { code, ...extensions } }] };
}
