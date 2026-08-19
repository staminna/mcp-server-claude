// Directus API client: @directus/sdk command layer over an axios transport.
//
// The public surface of this class is deliberately unchanged — it is exported
// from src/lib.ts as package API, and six tool classes plus the test stubs
// depend on it. Only the internals moved to the SDK.
//
// Requests are built by SDK commands and executed through the injected fetch in
// ./transport.ts. See that file for why the transport is axios rather than
// Node's global fetch.

import {
  createDirectus,
  rest,
  staticToken,
  customEndpoint,
  deleteItems as deleteItemsCommand,
  uploadFiles,
  isDirectusError,
  type RestCommand,
} from '@directus/sdk';
import { logger } from '../utils/logger.js';
import { createDirectusFetch, type Envelope } from './transport.js';
import {
  DirectusConfig,
  DirectusResponse,
  DirectusError,
  QueryOptions,
  BulkOperation,
  BulkResult,
  UploadOptions,
  UploadResult
} from '../types/directus.js';

/** Options accepted by the generic post() helper. */
export interface RequestConfig {
  headers?: Record<string, string>;
}

export class DirectusClient {
  private config: DirectusConfig;

  constructor(config: DirectusConfig) {
    this.config = {
      timeout: 30000,
      retries: 3,
      retryDelay: 1000,
      maxRetryDelay: 10000,
      ...config
    };
  }

  /**
   * Execute one SDK command.
   *
   * A fresh SDK client is built per call so the envelope listener can close over
   * this call's `meta` without shared mutable state. createDirectus() is an
   * object literal plus a URL parse and .with() is a spread, so this is cheap —
   * and it makes the retry-counter leak of the previous implementation
   * structurally impossible.
   */
  private async send<T = any>(command: RestCommand<any, any>): Promise<DirectusResponse<T>> {
    let meta: DirectusResponse['meta'] | undefined;

    const capture = (envelope: Envelope): void => {
      if (envelope.meta) meta = envelope.meta;
    };

    const client = createDirectus<any>(this.config.url, {
      globals: { fetch: createDirectusFetch(this.config, capture) },
    })
      .with(staticToken(this.config.token ?? ''))
      .with(rest());

    try {
      const data = (await client.request(command)) as T;
      return meta === undefined ? { data } : { data, meta };
    } catch (error) {
      throw this.parseDirectusError(error);
    }
  }

  /**
   * Map QueryOptions onto the SDK's Query shape.
   *
   * Note `meta`: the SDK's queryToParams does not know that key, so it falls
   * into a generic branch that JSON.stringifies arrays — producing
   * meta=["total_count"], which Directus cannot parse. Joining it here keeps
   * the wire format correct.
   */
  private toSdkQuery(options: QueryOptions = {}): Record<string, any> {
    const query: Record<string, any> = {};

    if (options.fields) query.fields = options.fields;
    if (options.filter) query.filter = options.filter;
    if (options.sort) query.sort = options.sort;
    if (options.limit !== undefined) query.limit = options.limit;
    if (options.offset !== undefined) query.offset = options.offset;
    if (options.page !== undefined) query.page = options.page;
    if (options.search) query.search = options.search;
    if (options.meta) query.meta = options.meta.join(',');
    if (options.deep) query.deep = options.deep;
    if (options.alias) query.alias = options.alias;
    if (options.aggregate) query.aggregate = options.aggregate;
    if (options.groupBy) query.groupBy = options.groupBy;
    if (options.export) query.export = options.export;
    if (options.version) query.version = options.version;
    if (options.versionRaw !== undefined) query.versionRaw = options.versionRaw;

    return query;
  }

  /**
   * Normalise anything thrown by the SDK into a DirectusError.
   *
   * The SDK rejects with a RequestError whose `.errors` is the response body's
   * `errors` array when there is one, and the whole body otherwise — so the
   * legacy body shapes are still reachable and still handled.
   */
  private parseDirectusError(error: unknown): DirectusError {
    if (isDirectusError(error)) {
      const first = (error as any).errors?.[0] ?? {};
      return {
        message: first.message || 'Unknown Directus error',
        extensions: {
          code: first.extensions?.code || 'UNKNOWN',
          collection: first.extensions?.collection,
          field: first.extensions?.field
        }
      };
    }

    const raw = (error as any)?.errors ?? error;

    if (Array.isArray(raw) && raw.length > 0) {
      const first = raw[0] ?? {};
      return {
        message: first.message || 'Unknown Directus error',
        extensions: {
          code: first.extensions?.code || 'UNKNOWN',
          collection: first.extensions?.collection,
          field: first.extensions?.field
        }
      };
    }

    if (raw && typeof raw === 'object' && (raw as any).error) {
      const inner = (raw as any).error;
      return {
        message: inner.message || inner,
        extensions: { code: inner.code || 'UNKNOWN' }
      };
    }

    if (raw && typeof raw === 'object' && typeof (raw as any).message === 'string' && raw !== error) {
      return {
        message: (raw as any).message,
        extensions: { code: 'VALIDATION_ERROR' }
      };
    }

    return {
      message: (error as Error)?.message || 'Network error',
      extensions: { code: (error as any)?.code || 'NETWORK_ERROR' }
    };
  }

  // Core API methods
  async get<T = any>(endpoint: string, options: QueryOptions = {}): Promise<DirectusResponse<T>> {
    return this.send<T>(customEndpoint({ path: endpoint, method: 'GET', params: this.toSdkQuery(options) }));
  }

  async post<T = any>(endpoint: string, data?: any, config?: RequestConfig): Promise<DirectusResponse<T>> {
    return this.send<T>(customEndpoint({
      path: endpoint,
      method: 'POST',
      ...(data !== undefined && { body: typeof data === 'string' ? data : JSON.stringify(data) }),
      ...(config?.headers && { headers: config.headers })
    }));
  }

  async patch<T = any>(endpoint: string, data?: any): Promise<DirectusResponse<T>> {
    return this.send<T>(customEndpoint({
      path: endpoint,
      method: 'PATCH',
      ...(data !== undefined && { body: typeof data === 'string' ? data : JSON.stringify(data) })
    }));
  }

  async delete<T = any>(endpoint: string): Promise<DirectusResponse<T>> {
    return this.send<T>(customEndpoint({ path: endpoint, method: 'DELETE' }));
  }


  // Collection operations
  async getCollections(): Promise<DirectusResponse> {
    return this.get('/collections');
  }

  async getCollection(collection: string): Promise<DirectusResponse> {
    return this.get(`/collections/${collection}`);
  }

  async createCollection(
    collection: string,
    meta: Record<string, any> = {},
    fields?: Record<string, any>[]
  ): Promise<DirectusResponse> {
    const payload: Record<string, any> = { collection, meta };

    if (fields && fields.length > 0) {
      // A collection with fields must be created as a real table (schema: {})
      // in a single atomic POST — adding fields after a schema-less create
      // fails because Directus treats schema:null collections as folders.
      payload.schema = {};
      payload.fields = fields.map((f) => ({
        field: f.field ?? f.name,
        type: f.type,
        meta: f.meta ?? {
          interface: f.interface ?? null,
          note: f.note ?? null,
          options: f.options ?? null,
          required: f.required ?? false,
          special: f.special ?? null,
        },
        schema: f.schema ?? (f.type === 'alias' ? undefined : {}),
      }));

      // Directus requires a primary key on new tables — inject one if missing
      const hasPk = payload.fields.some((f: Record<string, any>) => f.schema?.is_primary_key);
      if (!hasPk) {
        payload.fields.unshift({
          field: 'id',
          type: 'integer',
          meta: { hidden: true, interface: 'input', readonly: true },
          schema: { is_primary_key: true, has_auto_increment: true },
        });
      }
    } else {
      // No fields → collection folder (grouping element), schema must be null
      payload.schema = null;
    }

    return this.post('/collections', payload);
  }

  async updateCollection(collection: string, meta: Record<string, any>): Promise<DirectusResponse> {
    return this.patch(`/collections/${collection}`, { meta });
  }

  async deleteCollection(collection: string): Promise<DirectusResponse> {
    return this.delete(`/collections/${collection}`);
  }

  // Item operations
  async getItems<T = any>(collection: string, options: QueryOptions = {}): Promise<DirectusResponse<T[]>> {
    return this.get(`/items/${collection}`, options);
  }

  async getItem<T = any>(collection: string, id: string | number, options: QueryOptions = {}): Promise<DirectusResponse<T>> {
    return this.get(`/items/${collection}/${id}`, options);
  }

  async createItem<T = any>(collection: string, data: Partial<T>): Promise<DirectusResponse<T>> {
    return this.post(`/items/${collection}`, data);
  }

  async createItems<T = any>(collection: string, data: Partial<T>[]): Promise<DirectusResponse<T[]>> {
    return this.post(`/items/${collection}`, data);
  }

  async updateItem<T = any>(
    collection: string,
    id: string | number,
    data: Partial<T>,
    options?: QueryOptions
  ): Promise<DirectusResponse<T>> {
    return this.send<T>(customEndpoint({
      path: `/items/${collection}/${id}`,
      method: 'PATCH',
      body: JSON.stringify(data),
      ...(options && { params: this.toSdkQuery(options) })
    }));
  }

  async updateItems<T = any>(collection: string, ids: (string | number)[], data: Partial<T>): Promise<DirectusResponse<T[]>> {
    return this.patch(`/items/${collection}`, { keys: ids, data });
  }

  async deleteItem(collection: string, id: string | number): Promise<DirectusResponse> {
    return this.delete(`/items/${collection}/${id}`);
  }

  /**
   * Delete items by explicit keys, or by a query selecting them.
   *
   * Directus 12.3.0 (#27759) stopped treating "nothing to target" as "target
   * everything". Nothing here is a no-op: it returns without issuing a request
   * rather than emitting `DELETE /items/{collection}/`, which the previous
   * comma-joined path produced for an empty id list.
   *
   * To delete every item deliberately, pass `{ limit: -1 }` as the query.
   */
  async deleteItems(
    collection: string,
    keysOrQuery: (string | number)[] | QueryOptions
  ): Promise<DirectusResponse<null>> {
    const isKeys = Array.isArray(keysOrQuery);

    if (isKeys ? keysOrQuery.length === 0 : Object.keys(keysOrQuery ?? {}).length === 0) {
      logger.info('deleteItems called with nothing to target; skipping request', { collection });
      return { data: null };
    }

    return this.send<null>(
      deleteItemsCommand(collection, isKeys ? keysOrQuery : (this.toSdkQuery(keysOrQuery) as any))
    );
  }

  // Bulk operations
  async bulkOperation<T = any>(collection: string, operations: BulkOperation<T>): Promise<BulkResult<T>> {
    const results: BulkResult<T> = {
      created: [],
      updated: [],
      deleted: [],
      errors: []
    };

    // Handle creates
    if (operations.create && operations.create.length > 0) {
      try {
        const response = await this.createItems(collection, operations.create as any);
        results.created = response.data;
      } catch (error) {
        results.errors?.push({
          operation: 'create',
          item: operations.create,
          error: error as DirectusError
        });
      }
    }

    // Handle updates
    if (operations.update && operations.update.length > 0) {
      for (const item of operations.update) {
        try {
          const { id, ...data } = item;
          const response = await this.updateItem(collection, id, data as any);
          results.updated?.push(response.data as T);
        } catch (error) {
          results.errors?.push({
            operation: 'update',
            item,
            error: error as DirectusError
          });
        }
      }
    }

    // Handle deletes
    if (operations.delete && operations.delete.length > 0) {
      try {
        await this.deleteItems(collection, operations.delete);
        results.deleted = operations.delete;
      } catch (error) {
        results.errors?.push({
          operation: 'delete',
          item: operations.delete,
          error: error as DirectusError
        });
      }
    }

    return results;
  }

  // File operations
  async uploadFile(file: Buffer | string, options: UploadOptions = {}): Promise<UploadResult> {
    const path = await import('node:path');
    const fs = await import('node:fs');

    const formData = new FormData();

    if (Buffer.isBuffer(file)) {
      formData.append('file', new Blob([new Uint8Array(file)]), options.filename || 'upload');
    } else {
      // A file path: openAsBlob streams from disk rather than buffering it.
      const blob = await fs.promises.open(file).then(async (handle) => {
        try {
          return new Blob([new Uint8Array(await handle.readFile())]);
        } finally {
          await handle.close();
        }
      });
      formData.append('file', blob, options.filename || path.basename(file));
    }

    if (options.title) formData.append('title', options.title);
    if (options.folder) formData.append('folder', options.folder);
    if (options.storage) formData.append('storage', options.storage);
    if (options.metadata) formData.append('metadata', JSON.stringify(options.metadata));

    const response = await this.send<UploadResult>(uploadFiles(formData));
    return response.data;
  }

  async getFiles(options: QueryOptions = {}): Promise<DirectusResponse> {
    return this.get('/files', options);
  }

  async deleteFile(id: string): Promise<DirectusResponse> {
    return this.delete(`/files/${id}`);
  }

  // User operations
  async getUsers(options: QueryOptions = {}): Promise<DirectusResponse> {
    return this.get('/users', options);
  }

  async getUser(id: string, options: QueryOptions = {}): Promise<DirectusResponse> {
    return this.get(`/users/${id}`, options);
  }

  async createUser(userData: Record<string, any>): Promise<DirectusResponse> {
    return this.post('/users', userData);
  }

  async updateUser(id: string, userData: Record<string, any>): Promise<DirectusResponse> {
    return this.patch(`/users/${id}`, userData);
  }

  async deleteUser(id: string): Promise<DirectusResponse> {
    return this.delete(`/users/${id}`);
  }

  // Role operations
  async getRoles(options: QueryOptions = {}): Promise<DirectusResponse> {
    return this.get('/roles', options);
  }

  async getRole(id: string): Promise<DirectusResponse> {
    return this.get(`/roles/${id}`);
  }

  async createRole(roleData: Record<string, any>): Promise<DirectusResponse> {
    return this.post('/roles', roleData);
  }

  // Flow operations
  async getFlows(options: QueryOptions = {}): Promise<DirectusResponse> {
    return this.get('/flows', options);
  }

  async triggerFlow(id: string, data: Record<string, any> = {}): Promise<DirectusResponse> {
    return this.post(`/flows/trigger/${id}`, data);
  }

  // Schema operations
  async getFields(collection?: string): Promise<DirectusResponse> {
    const endpoint = collection ? `/fields/${collection}` : '/fields';
    return this.get(endpoint);
  }

  async createField(collection: string, fieldData: Record<string, any>): Promise<DirectusResponse> {
    return this.post(`/fields/${collection}`, fieldData);
  }

  async updateField(collection: string, field: string, fieldData: Record<string, any>): Promise<DirectusResponse> {
    return this.patch(`/fields/${collection}/${field}`, fieldData);
  }

  async deleteField(collection: string, field: string): Promise<DirectusResponse> {
    return this.delete(`/fields/${collection}/${field}`);
  }

  async getRelations(): Promise<DirectusResponse> {
    return this.get('/relations');
  }

  async createRelation(relationData: Record<string, any>): Promise<DirectusResponse> {
    return this.post('/relations', relationData);
  }

  async deleteRelation(collection: string, field: string): Promise<DirectusResponse> {
    return this.delete(`/relations/${collection}/${field}`);
  }

  // Permission operations
  async getPermissions(options: QueryOptions = {}): Promise<DirectusResponse> {
    return this.get('/permissions', options);
  }

  async createPermission(permissionData: Record<string, any>): Promise<DirectusResponse> {
    return this.post('/permissions', permissionData);
  }

  // Utility methods
  private buildQueryParams(options: QueryOptions): Record<string, any> {
    const params: Record<string, any> = {};

    if (options.fields) params.fields = options.fields.join(',');
    if (options.filter) params.filter = JSON.stringify(options.filter);
    if (options.sort) params.sort = options.sort.join(',');
    if (options.limit) params.limit = options.limit;
    if (options.offset) params.offset = options.offset;
    if (options.page) params.page = options.page;
    if (options.search) params.search = options.search;
    if (options.meta) params.meta = options.meta.join(',');
    if (options.deep) params.deep = JSON.stringify(options.deep);
    if (options.alias) params.alias = JSON.stringify(options.alias);
    if (options.aggregate) params.aggregate = JSON.stringify(options.aggregate);
    if (options.groupBy) params.groupBy = options.groupBy.join(',');
    if (options.export) params.export = options.export;

    return params;
  }

  // Health check - try multiple endpoints as Directus versions may differ
  async ping(): Promise<boolean> {
    const endpoints = ['/server/ping', '/server/health', '/utils/health', '/admin/server/health'];
    
    for (const endpoint of endpoints) {
      try {
        logger.info(`Attempting health check on ${endpoint}`);
        await this.get(endpoint);
        logger.info(`Health check successful on ${endpoint}`);
        return true;
      } catch (error) {
        logger.warn(`Health check failed on ${endpoint}`, { 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
      }
    }
    
    // If all health endpoints fail, try a simple collections endpoint as fallback
    try {
      logger.info('Attempting fallback health check via collections endpoint');
      await this.get('/collections', { limit: 1 });
      logger.info('Fallback health check successful');
      return true;
    } catch (error) {
      logger.error('All health check attempts failed', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      return false;
    }
  }

  // Get server info
  async getServerInfo(): Promise<DirectusResponse> {
    return this.get('/server/info');
  }
}
