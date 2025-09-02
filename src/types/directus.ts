// Complete TypeScript types for Directus entities and API responses

export interface DirectusUser {
  id: string;
  first_name?: string;
  last_name?: string;
  email: string;
  password?: string;
  location?: string;
  title?: string;
  description?: string;
  tags?: string[];
  avatar?: string;
  language?: string;
  theme?: 'auto' | 'light' | 'dark';
  tfa_secret?: string;
  status: 'active' | 'invited' | 'draft' | 'suspended' | 'deleted';
  role?: string;
  token?: string;
  last_access?: string;
  last_page?: string;
  provider?: string;
  external_identifier?: string;
  auth_data?: Record<string, any>;
  email_notifications?: boolean;
  date_created?: string;
  date_updated?: string;
}

export interface DirectusRole {
  id: string;
  name: string;
  icon?: string;
  description?: string;
  ip_access?: string[];
  enforce_tfa?: boolean;
  admin_access?: boolean;
  app_access?: boolean;
  users?: string[];
  date_created?: string;
  date_updated?: string;
}

export interface DirectusCollection {
  collection: string;
  meta?: {
    collection: string;
    icon?: string;
    note?: string;
    display_template?: string;
    hidden?: boolean;
    singleton?: boolean;
    translations?: Record<string, any>;
    archive_field?: string;
    archive_app_filter?: boolean;
    archive_value?: string;
    unarchive_value?: string;
    sort_field?: string;
    accountability?: 'all' | 'activity' | null;
    color?: string;
    item_duplication_fields?: string[];
    sort?: number;
    group?: string;
    collapse?: 'open' | 'closed' | 'locked';
    preview_url?: string;
    versioning?: boolean;
    date_created?: string;
    date_updated?: string;
  };
  schema?: {
    name: string;
    comment?: string;
  };
}

// Enhanced field types with comprehensive relationship support
export type DirectusFieldType = 
  | 'string' | 'text' | 'boolean' | 'integer' | 'bigInteger' | 'float' | 'decimal'
  | 'date' | 'time' | 'dateTime' | 'timestamp' | 'json' | 'csv' | 'uuid'
  | 'hash' | 'geometry' | 'geometry.Point' | 'geometry.LineString' | 'geometry.Polygon'
  | 'geometry.MultiPoint' | 'geometry.MultiLineString' | 'geometry.MultiPolygon';

export type DirectusRelationType = 'o2m' | 'm2o' | 'm2m' | 'o2o' | 'm2a' | 'files' | 'translations';

export type DirectusInterface = 
  | 'input' | 'input-rich-text-html' | 'input-rich-text-md' | 'textarea' | 'wysiwyg'
  | 'select-dropdown' | 'select-dropdown-m2o' | 'select-multiple-dropdown'
  | 'tags' | 'checkboxes' | 'checkboxes-relational' | 'radio-buttons'
  | 'toggle' | 'slider' | 'input-code' | 'datetime' | 'file' | 'file-image'
  | 'files' | 'system-collection' | 'system-field' | 'presentation-divider'
  | 'presentation-notice' | 'group-accordion' | 'group-detail' | 'group-raw'
  | 'list-o2m' | 'list-o2m-tree-view' | 'list-m2m' | 'list-m2a'
  | 'map' | 'translations' | 'repeater';

export interface DirectusFieldValidation {
  _and?: DirectusFieldValidation[];
  _or?: DirectusFieldValidation[];
  required?: boolean;
  unique?: boolean;
  regex?: { pattern: string; flags?: string };
  length?: { min?: number; max?: number };
  range?: { min?: number; max?: number };
  in?: any[];
  nin?: any[];
  custom?: string;
}

export interface DirectusField {
  collection: string;
  field: string;
  type: DirectusFieldType;
  meta?: {
    id?: number;
    collection: string;
    field: string;
    special?: string[];
    interface?: DirectusInterface;
    options?: Record<string, any>;
    display?: string;
    display_options?: Record<string, any>;
    readonly?: boolean;
    hidden?: boolean;
    sort?: number;
    width?: 'half' | 'half-left' | 'half-right' | 'full' | 'fill';
    translations?: Record<string, any>;
    note?: string;
    conditions?: any[];
    required?: boolean;
    group?: string;
    validation?: DirectusFieldValidation;
    validation_message?: string;
    date_created?: string;
    date_updated?: string;
  };
  schema?: {
    name: string;
    table: string;
    data_type: string;
    default_value?: any;
    max_length?: number;
    numeric_precision?: number;
    numeric_scale?: number;
    is_nullable?: boolean;
    is_unique?: boolean;
    is_primary_key?: boolean;
    is_generated?: boolean;
    generation_expression?: string;
    has_auto_increment?: boolean;
    foreign_key_table?: string;
    foreign_key_column?: string;
    comment?: string;
  };
}

// Enhanced relationship types with comprehensive support for all Directus relationship patterns
export interface DirectusRelationSchema {
  table: string;
  column: string;
  foreign_key_table: string;
  foreign_key_column: string;
  constraint_name?: string;
  on_update: 'NO ACTION' | 'RESTRICT' | 'CASCADE' | 'SET NULL' | 'SET DEFAULT';
  on_delete: 'NO ACTION' | 'RESTRICT' | 'CASCADE' | 'SET NULL' | 'SET DEFAULT';
}

export interface DirectusRelationMeta {
  id?: number;
  many_collection: string;
  many_field: string;
  one_collection?: string;
  one_field?: string;
  one_collection_field?: string;
  one_allowed_collections?: string[];
  junction_field?: string;
  sort_field?: string;
  one_deselect_action?: 'nullify' | 'delete';
  date_created?: string;
  date_updated?: string;
}

export interface DirectusRelation {
  collection: string;
  field: string;
  related_collection?: string;
  schema?: DirectusRelationSchema;
  meta?: DirectusRelationMeta;
}

// Comprehensive relationship configuration interfaces
export interface OneToManyRelation {
  type: 'o2m';
  collection: string; // Parent collection
  field: string; // Field in parent collection
  related_collection: string; // Child collection
  related_field: string; // Foreign key field in child collection
  sort_field?: string;
  on_delete?: 'CASCADE' | 'SET NULL' | 'RESTRICT';
  on_update?: 'CASCADE' | 'SET NULL' | 'RESTRICT';
}

export interface ManyToOneRelation {
  type: 'm2o';
  collection: string; // Child collection
  field: string; // Foreign key field in child collection
  related_collection: string; // Parent collection
  related_field?: string; // Primary key field in parent (usually 'id')
  on_delete?: 'CASCADE' | 'SET NULL' | 'RESTRICT';
  on_update?: 'CASCADE' | 'SET NULL' | 'RESTRICT';
}

export interface ManyToManyRelation {
  type: 'm2m';
  collection: string; // First collection
  field: string; // Field in first collection
  related_collection: string; // Second collection
  junction_collection: string; // Junction table
  junction_field: string; // Field in junction pointing to first collection
  related_junction_field: string; // Field in junction pointing to second collection
  sort_field?: string;
  on_delete?: 'CASCADE' | 'SET NULL' | 'RESTRICT';
}

export interface OneToOneRelation {
  type: 'o2o';
  collection: string; // First collection
  field: string; // Field in first collection
  related_collection: string; // Second collection
  related_field: string; // Foreign key field in second collection
  on_delete?: 'CASCADE' | 'SET NULL' | 'RESTRICT';
  on_update?: 'CASCADE' | 'SET NULL' | 'RESTRICT';
}

export interface ManyToAnyRelation {
  type: 'm2a';
  collection: string; // Source collection
  field: string; // Field in source collection
  allowed_collections: string[]; // Allowed target collections
  collection_field: string; // Field storing collection name
  primary_key_field: string; // Field storing primary key
}

export type DirectusRelationConfig = 
  | OneToManyRelation 
  | ManyToOneRelation 
  | ManyToManyRelation 
  | OneToOneRelation 
  | ManyToAnyRelation;

export interface DirectusFile {
  id: string;
  storage: string;
  filename_disk: string;
  filename_download: string;
  title?: string;
  type?: string;
  folder?: string;
  uploaded_by?: string;
  uploaded_on: string;
  modified_by?: string;
  modified_on?: string;
  charset?: string;
  filesize?: number;
  width?: number;
  height?: number;
  duration?: number;
  embed?: string;
  description?: string;
  location?: string;
  tags?: string[];
  metadata?: Record<string, any>;
  focal_point_x?: number;
  focal_point_y?: number;
}

export interface DirectusFolder {
  id: string;
  name: string;
  parent?: string;
  date_created?: string;
  date_updated?: string;
}

export interface DirectusPermission {
  id?: number;
  role?: string;
  collection: string;
  action: 'create' | 'read' | 'update' | 'delete' | 'comment' | 'explain';
  permissions?: Record<string, any>;
  validation?: Record<string, any>;
  presets?: Record<string, any>;
  fields?: string[];
  date_created?: string;
  date_updated?: string;
}

export interface DirectusActivity {
  id: number;
  action: string;
  user?: string;
  timestamp: string;
  ip?: string;
  user_agent?: string;
  collection: string;
  item: string;
  comment?: string;
  origin?: string;
  revisions?: number[];
}

export interface DirectusRevision {
  id: number;
  activity: number;
  collection: string;
  item: string;
  data?: Record<string, any>;
  delta?: Record<string, any>;
  parent?: number;
  version?: string;
  date_created?: string;
  date_updated?: string;
}

export interface DirectusFlow {
  id: string;
  name: string;
  icon?: string;
  color?: string;
  description?: string;
  status: 'active' | 'inactive';
  trigger?: string;
  accountability?: 'all' | 'activity' | null;
  options?: Record<string, any>;
  operation?: string;
  date_created?: string;
  date_updated?: string;
  operations?: DirectusOperation[];
}

export interface DirectusOperation {
  id: string;
  name?: string;
  key: string;
  type: string;
  position_x: number;
  position_y: number;
  options?: Record<string, any>;
  resolve?: string;
  reject?: string;
  flow: string;
  date_created?: string;
  date_updated?: string;
}

// API Configuration Types
export interface DirectusConfig {
  url: string;
  token?: string;
  email?: string;
  password?: string;
  timeout?: number;
  retries?: number;
  retryDelay?: number;
  maxRetryDelay?: number;
  websocket?: boolean;
  websocketUrl?: string;
  // HTTPS Certificate Configuration
  https?: {
    ca?: string | Buffer | Array<string | Buffer>; // Certificate Authority
    cert?: string | Buffer; // Client certificate
    key?: string | Buffer; // Client private key
    pfx?: string | Buffer; // PFX or PKCS12 encoded private key and certificate chain
    passphrase?: string; // Passphrase for the private key or pfx
    rejectUnauthorized?: boolean; // Whether to reject self-signed certificates (default: true)
    servername?: string; // Server name for SNI (Server Name Indication)
  };
}

// Query Options
export interface QueryOptions {
  fields?: string[] | undefined;
  filter?: Record<string, any> | undefined;
  sort?: string[] | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
  page?: number | undefined;
  search?: string | undefined;
  meta?: string[] | undefined;
  deep?: Record<string, any> | undefined;
  alias?: Record<string, string> | undefined;
  aggregate?: Record<string, any> | undefined;
  groupBy?: string[] | undefined;
  export?: 'json' | 'csv' | 'xml' | undefined;
}

// API Response Types
export interface DirectusResponse<T = any> {
  data: T;
  meta?: {
    total_count?: number;
    filter_count?: number;
  };
}

export interface DirectusError {
  message: string;
  extensions: {
    code: string;
    collection?: string;
    field?: string;
  };
}

// WebSocket Event Types
export interface WebSocketEvent {
  type: 'auth' | 'subscribe' | 'unsubscribe' | 'ping' | 'pong';
  collection?: string | undefined;
  query?: QueryOptions | undefined;
  uid?: string | undefined;
  data?: any;
}

export interface WebSocketMessage {
  type: 'auth' | 'subscription' | 'ping' | 'pong' | 'error';
  event?: string;
  collection?: string;
  data?: any;
  uid?: string;
  error?: DirectusError;
}

// Bulk Operations
export interface BulkOperation<T = any> {
  create?: T[];
  update?: Array<{ id: string | number } & Partial<T>>;
  delete?: Array<string | number>;
}

export interface BulkResult<T = any> {
  created?: T[];
  updated?: T[];
  deleted?: Array<string | number>;
  errors?: Array<{
    operation: 'create' | 'update' | 'delete';
    item?: any;
    error: DirectusError;
  }>;
}

// Upload Types
export interface UploadOptions {
  filename?: string;
  title?: string;
  folder?: string;
  storage?: string;
  metadata?: Record<string, any>;
}

export interface UploadResult extends DirectusFile {
  url?: string;
}
