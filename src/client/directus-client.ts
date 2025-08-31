// Enhanced Directus API Client with Axios, Retry Logic, and Comprehensive Error Handling

import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';
import FormData from 'form-data';
import { logger } from '../utils/logger.js';
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

export class DirectusClient {
  private axios: AxiosInstance;
  private config: DirectusConfig;
  private retryCount: number = 0;

  constructor(config: DirectusConfig) {
    this.config = {
      timeout: 30000,
      retries: 3,
      retryDelay: 1000,
      maxRetryDelay: 10000,
      ...config
    };

    this.axios = axios.create({
      baseURL: this.config.url,
      timeout: this.config.timeout,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Directus-MCP-Server/1.0.0'
      }
    });

    this.setupInterceptors();
    this.setupAuth();
  }

  private setupAuth(): void {
    if (this.config.token) {
      this.axios.defaults.headers.common['Authorization'] = `Bearer ${this.config.token}`;
    }
  }

  private setupInterceptors(): void {
    // Request interceptor for logging and timing
    this.axios.interceptors.request.use(
      (config) => {
        const requestId = this.generateRequestId();
        // Add request metadata for logging
        (config as any).metadata = { requestId, startTime: Date.now() };
        
        logger.apiRequest(
          config.method?.toUpperCase() || 'GET',
          `${config.baseURL}${config.url}`,
          { requestId }
        );

        return config;
      },
      (error) => {
        logger.apiError('REQUEST_SETUP', 'Failed to setup request', error);
        return Promise.reject(error);
      }
    );

    // Response interceptor for logging and error handling
    this.axios.interceptors.response.use(
      (response) => {
        const { requestId, startTime } = (response.config as any).metadata || {};
        const duration = startTime ? Date.now() - startTime : 0;

        logger.apiResponse(
          response.config.method?.toUpperCase() || 'GET',
          `${response.config.baseURL}${response.config.url}`,
          response.status,
          duration,
          { requestId }
        );

        return response;
      },
      async (error: AxiosError) => {
        const { requestId, startTime } = (error.config as any)?.metadata || {};
        const duration = startTime ? Date.now() - startTime : 0;

        // Log the error
        logger.apiResponse(
          error.config?.method?.toUpperCase() || 'GET',
          `${error.config?.baseURL}${error.config?.url}`,
          error.response?.status || 0,
          duration,
          { requestId, error: error.message }
        );

        // Handle retry logic
        if (this.shouldRetry(error)) {
          return this.retryRequest(error);
        }

        // Parse and throw Directus-specific error
        throw this.parseDirectusError(error);
      }
    );
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private shouldRetry(error: AxiosError): boolean {
    if (this.retryCount >= (this.config.retries || 3)) {
      return false;
    }

    // Retry on network errors or 5xx server errors
    if (!error.response) {
      return true; // Network error
    }

    const status = error.response.status;
    return status >= 500 || status === 429; // Server error or rate limit
  }

  private async retryRequest(error: AxiosError): Promise<AxiosResponse> {
    this.retryCount++;
    
    // Exponential backoff with jitter
    const baseDelay = this.config.retryDelay || 1000;
    const maxDelay = this.config.maxRetryDelay || 10000;
    const delay = Math.min(
      baseDelay * Math.pow(2, this.retryCount - 1) + Math.random() * 1000,
      maxDelay
    );

    logger.info('Retrying request', {
      attempt: this.retryCount,
      delay,
      maxRetries: this.config.retries
    });

    await new Promise(resolve => setTimeout(resolve, delay));

    if (error.config) {
      return this.axios.request(error.config);
    }

    throw error;
  }

  private parseDirectusError(error: AxiosError): DirectusError {
    // Reset retry count on error parsing
    this.retryCount = 0;

    if (error.response?.data) {
      const data = error.response.data as any;
      
      // Handle Directus API error format
      if (data.errors && Array.isArray(data.errors)) {
        const firstError = data.errors[0];
        return {
          message: firstError.message || 'Unknown Directus error',
          extensions: {
            code: firstError.extensions?.code || 'UNKNOWN',
            collection: firstError.extensions?.collection,
            field: firstError.extensions?.field
          }
        };
      }

      // Handle single error format
      if (data.error) {
        return {
          message: data.error.message || data.error,
          extensions: {
            code: data.error.code || 'UNKNOWN'
          }
        };
      }

      // Handle validation errors
      if (data.message) {
        return {
          message: data.message,
          extensions: {
            code: 'VALIDATION_ERROR'
          }
        };
      }
    }

    // Fallback to axios error
    return {
      message: error.message || 'Network error',
      extensions: {
        code: error.code || 'NETWORK_ERROR'
      }
    };
  }

  // Core API methods
  async get<T = any>(endpoint: string, options: QueryOptions = {}): Promise<DirectusResponse<T>> {
    const params = this.buildQueryParams(options);
    const response = await this.axios.get(endpoint, { params });
    return response.data;
  }

  async post<T = any>(endpoint: string, data?: any, config?: AxiosRequestConfig): Promise<DirectusResponse<T>> {
    const response = await this.axios.post(endpoint, data, config);
    return response.data;
  }

  async patch<T = any>(endpoint: string, data?: any): Promise<DirectusResponse<T>> {
    const response = await this.axios.patch(endpoint, data);
    return response.data;
  }

  async delete<T = any>(endpoint: string): Promise<DirectusResponse<T>> {
    const response = await this.axios.delete(endpoint);
    return response.data;
  }

  // Collection operations
  async getCollections(): Promise<DirectusResponse> {
    return this.get('/collections');
  }

  async getCollection(collection: string): Promise<DirectusResponse> {
    return this.get(`/collections/${collection}`);
  }

  async createCollection(collection: string, meta: Record<string, any> = {}): Promise<DirectusResponse> {
    return this.post('/collections', { collection, meta });
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

  async updateItem<T = any>(collection: string, id: string | number, data: Partial<T>): Promise<DirectusResponse<T>> {
    return this.patch(`/items/${collection}/${id}`, data);
  }

  async updateItems<T = any>(collection: string, ids: (string | number)[], data: Partial<T>): Promise<DirectusResponse<T[]>> {
    return this.patch(`/items/${collection}`, { keys: ids, data });
  }

  async deleteItem(collection: string, id: string | number): Promise<DirectusResponse> {
    return this.delete(`/items/${collection}/${id}`);
  }

  async deleteItems(collection: string, ids: (string | number)[]): Promise<DirectusResponse> {
    return this.delete(`/items/${collection}/${ids.join(',')}`);
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
    const formData = new FormData();
    
    if (Buffer.isBuffer(file)) {
      formData.append('file', file, options.filename || 'upload');
    } else {
      // Assume it's a file path
      const fs = await import('fs');
      const path = await import('path');
      formData.append('file', fs.createReadStream(file), options.filename || path.basename(file));
    }

    if (options.title) formData.append('title', options.title);
    if (options.folder) formData.append('folder', options.folder);
    if (options.storage) formData.append('storage', options.storage);
    if (options.metadata) {
      formData.append('metadata', JSON.stringify(options.metadata));
    }

    const response = await this.post('/files', formData, {
      headers: {
        ...formData.getHeaders(),
        'Content-Type': 'multipart/form-data'
      }
    });

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

  // Health check
  async ping(): Promise<boolean> {
    try {
      await this.get('/server/ping');
      return true;
    } catch {
      return false;
    }
  }

  // Get server info
  async getServerInfo(): Promise<DirectusResponse> {
    return this.get('/server/info');
  }
}
