#!/usr/bin/env node

import 'dotenv/config';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import WebSocket from 'ws';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';

// ===== TYPE DEFINITIONS =====

interface DirectusConfig {
  url: string;
  token: string;
  timeout?: number;
  retries?: number;
  websocket?: boolean;
}

interface DirectusCollection {
  collection: string;
  meta?: {
    collection: string;
    icon?: string;
    note?: string;
    display_template?: string;
    hidden?: boolean;
    singleton?: boolean;
    translations?: Record<string, string>;
    color?: string;
    sort_field?: string;
    archive_field?: string;
    archive_app_filter?: boolean;
    archive_value?: string;
    unarchive_value?: string;
    accountability?: string;
    item_duplication_fields?: string[];
    sort?: number;
    group?: string;
    collapse?: string;
    preview_url?: string;
    versioning?: boolean;
  };
  schema?: {
    name: string;
    comment?: string;
  };
}

interface DirectusField {
  collection: string;
  field: string;
  type: FieldType;
  meta?: FieldMeta;
  schema?: FieldSchema;
}

type FieldType = 
  | 'string' | 'text' | 'boolean' | 'integer' | 'bigInteger' 
  | 'float' | 'decimal' | 'date' | 'dateTime' | 'time' 
  | 'timestamp' | 'json' | 'csv' | 'uuid' | 'hash' | 'geometry';

interface FieldMeta {
  id?: number;
  collection: string;
  field: string;
  special?: string[];
  interface?: string;
  options?: Record<string, any>;
  display?: string;
  display_options?: Record<string, any>;
  readonly?: boolean;
  hidden?: boolean;
  sort?: number;
  width?: string;
  translations?: Record<string, string>;
  note?: string;
  conditions?: any[];
  required?: boolean;
  group?: string;
  validation?: Record<string, any>;
  validation_message?: string;
}

interface FieldSchema {
  name: string;
  table: string;
  data_type: string;
  default_value?: any;
  max_length?: number;
  numeric_precision?: number;
  numeric_scale?: number;
  is_generated?: boolean;
  generation_expression?: string;
  is_nullable?: boolean;
  is_unique?: boolean;
  is_primary_key?: boolean;
  has_auto_increment?: boolean;
  foreign_key_column?: string;
  foreign_key_table?: string;
  comment?: string;
}

interface DirectusRelation {
  collection: string;
  field: string;
  related_collection: string;
  schema?: {
    table: string;
    column: string;
    foreign_key_table: string;
    foreign_key_column: string;
    constraint_name?: string;
    on_update?: string;
    on_delete?: string;
  };
  meta?: {
    id?: number;
    many_collection: string;
    many_field: string;
    one_collection?: string;
    one_field?: string;
    one_collection_field?: string;
    one_allowed_collections?: string[];
    junction_field?: string;
    sort_field?: string;
    one_deselect_action?: string;
  };
}

interface DirectusUser {
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
  tfa_secret?: string;
  status?: 'invited' | 'draft' | 'active' | 'suspended' | 'deleted';
  role?: string;
  token?: string;
  last_access?: string;
  last_page?: string;
  provider?: string;
  external_identifier?: string;
  auth_data?: Record<string, any>;
  email_notifications?: boolean;
  appearance?: string;
  theme_dark?: string;
  theme_light?: string;
  theme_light_overrides?: Record<string, any>;
  theme_dark_overrides?: Record<string, any>;
}

interface DirectusRole {
  id: string;
  name: string;
  icon?: string;
  description?: string;
  ip_access?: string[];
  enforce_tfa?: boolean;
  admin_access?: boolean;
  app_access?: boolean;
  users?: string[];
}

interface DirectusFile {
  id: string;
  storage: string;
  filename_disk: string;
  filename_download: string;
  title?: string;
  type?: string;
  folder?: string;
  uploaded_by?: string;
  uploaded_on?: string;
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
}

interface WebSocketMessage {
  type: 'auth' | 'subscribe' | 'unsubscribe' | 'message';
  event?: string;
  data?: any;
  uid?: string;
}

interface LogContext {
  operation?: string;
  collection?: string;
  field?: string;
  duration?: number;
  error?: Error;
  [key: string]: any;
}

interface QueryOptions {
  filter?: Record<string, any>;
  sort?: string[];
  limit?: number;
  offset?: number;
  fields?: string[];
  search?: string;
  deep?: Record<string, any>;
  aggregate?: Record<string, any>;
}

// ===== CONFIGURATION =====

const config: DirectusConfig = {
  url: process.env.DIRECTUS_URL || 'http://localhost:8065',
  token: process.env.DIRECTUS_TOKEN || '',
  timeout: parseInt(process.env.DIRECTUS_TIMEOUT || '30000'),
  retries: parseInt(process.env.DIRECTUS_RETRIES || '3'),
  websocket: process.env.DIRECTUS_WEBSOCKET !== 'false'
};

if (!config.token) {
  console.error('DIRECTUS_TOKEN environment variable is required');
  process.exit(1);
}

// ===== LOGGER CLASS =====

class Logger {
  private context: Record<string, any>;

  constructor(context: Record<string, any> = {}) {
    this.context = {
      version: process.version,
      pid: process.pid,
      timestamp: new Date().toISOString(),
      ...context
    };
  }

  private log(level: string, message: string, data: any = null): void {
    const timestamp = new Date().toISOString();
    const contextStr = data ? JSON.stringify({ ...data, ...this.context }) : JSON.stringify(this.context);
    
    // Use stderr to avoid interfering with MCP protocol on stdout
    console.error(`[${level.toUpperCase()}] [${timestamp}] ${message} ${contextStr}`);
  }

  debug(message: string, data?: LogContext): void {
    if (process.env.NODE_ENV === 'development') {
      this.log('debug', message, data);
    }
  }

  info(message: string, data?: LogContext): void {
    this.log('info', message, data);
  }

  warn(message: string, data?: LogContext): void {
    this.log('warn', message, data);
  }

  error(message: string, data?: LogContext): void {
    this.log('error', message, data);
  }

  startTimer(operation: string): { end: () => void } {
    const start = performance.now();
    return {
      end: () => {
        const duration = performance.now() - start;
        this.info(`Operation completed: ${operation}`, { operation, duration: Math.round(duration) });
      }
    };
  }
}

// ===== WEBSOCKET HANDLER =====

class DirectusWebSocketHandler {
  private ws: WebSocket | null = null;
  private logger: Logger;
  private url: string;
  private token: string;
  private subscriptions: Set<string> = new Set();
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectInterval: number = 5000;
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor(url: string, token: string) {
    this.url = url.replace(/^http/, 'ws') + '/websocket';
    this.token = token;
    this.logger = new Logger({ service: 'WebSocketHandler' });
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);

        this.ws.on('open', () => {
          this.logger.info('WebSocket connected');
          this.reconnectAttempts = 0;
          this.authenticate();
          this.startHeartbeat();
          resolve();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          try {
            const message: WebSocketMessage = JSON.parse(data.toString());
            this.handleMessage(message);
          } catch (error) {
            this.logger.error('Failed to parse WebSocket message', { error, data: data.toString() });
          }
        });

        this.ws.on('close', (code: number, reason: Buffer) => {
          this.logger.warn('WebSocket closed', { code, reason: reason.toString() });
          this.stopHeartbeat();
          this.scheduleReconnect();
        });

        this.ws.on('error', (error: Error) => {
          this.logger.error('WebSocket error', { error });
          reject(error);
        });

        setTimeout(() => {
          if (this.ws?.readyState !== WebSocket.OPEN) {
            reject(new Error('WebSocket connection timeout'));
          }
        }, 10000);

      } catch (error) {
        reject(error);
      }
    });
  }

  private authenticate(): void {
    this.sendMessage({
      type: 'auth',
      data: { token: this.token }
    });
  }

  private sendMessage(message: WebSocketMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      this.logger.warn('Cannot send message, WebSocket not open', { message });
    }
  }

  private handleMessage(message: WebSocketMessage): void {
    switch (message.type) {
      case 'auth':
        if (message.data?.status === 'ok') {
          this.logger.info('WebSocket authenticated');
          this.subscriptions.forEach(event => this.subscribe(event));
        } else {
          this.logger.error('WebSocket authentication failed', { data: message.data });
        }
        break;
      case 'message':
        this.logger.info('Received real-time update', {
          event: message.event,
          data: message.data
        });
        break;
    }
  }

  subscribe(event: string): void {
    this.subscriptions.add(event);
    this.sendMessage({ type: 'subscribe', event });
    this.logger.info(`Subscribed to event: ${event}`);
  }

  unsubscribe(event: string): void {
    this.subscriptions.delete(event);
    this.sendMessage({ type: 'unsubscribe', event });
    this.logger.info(`Unsubscribed from event: ${event}`);
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, 30000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      this.logger.info(`Scheduling WebSocket reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
      
      setTimeout(() => {
        this.connect().catch(error => {
          this.logger.error('WebSocket reconnect failed', { error });
        });
      }, this.reconnectInterval * this.reconnectAttempts);
    } else {
      this.logger.error('Max WebSocket reconnect attempts reached');
    }
  }

  disconnect(): void {
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.subscriptions.clear();
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

// ===== DIRECTUS API CLIENT =====

class DirectusAPIClient {
  private axios: AxiosInstance;
  private logger: Logger;
  private config: DirectusConfig;

  constructor(config: DirectusConfig) {
    this.config = config;
    this.logger = new Logger({ service: 'DirectusAPIClient' });

    this.axios = axios.create({
      baseURL: config.url,
      timeout: config.timeout || 30000,
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Content-Type': 'application/json'
      }
    });

    this.setupInterceptors();
  }

  private setupInterceptors(): void {
    // Request interceptor
    this.axios.interceptors.request.use(
      (config) => {
        this.logger.debug(`API Request: ${config.method?.toUpperCase()} ${config.url}`, {
          url: config.url,
          method: config.method
        });
        return config;
      },
      (error) => {
        this.logger.error('Request interceptor error', { error });
        return Promise.reject(error);
      }
    );

    // Response interceptor
    this.axios.interceptors.response.use(
      (response: AxiosResponse) => {
        this.logger.debug(`API Response: ${response.status} ${response.config.url}`, {
          status: response.status,
          url: response.config.url,
          dataSize: JSON.stringify(response.data).length
        });
        return response;
      },
      (error) => {
        const parsedError = this.parseDirectusError(error);
        this.logger.error('API Error', {
          url: error.config?.url,
          method: error.config?.method,
          status: error.response?.status,
          code: parsedError.code,
          message: parsedError.message
        });
        return Promise.reject(error);
      }
    );
  }

  private parseDirectusError(error: any): { code: string; message: string; details?: any } {
    if (error?.response?.data?.errors) {
      const err = error.response.data.errors[0];
      return {
        code: err.extensions?.code || 'DIRECTUS_ERROR',
        message: err.message,
        details: err.extensions
      };
    }

    if (error?.response?.data?.message) {
      return {
        code: error?.response?.status?.toString() || 'HTTP_ERROR',
        message: error.response.data.message
      };
    }

    return {
      code: 'UNKNOWN_ERROR',
      message: error?.message || 'An unknown error occurred'
    };
  }

  private async retry<T>(fn: () => Promise<T>, retries: number = this.config.retries || 3): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;
        
        if (attempt === retries) break;

        const backoffDelay = 1000 * Math.pow(2, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, backoffDelay));
      }
    }

    throw lastError!;
  }

  // Collections API
  async getCollections(): Promise<DirectusCollection[]> {
    const timer = this.logger.startTimer('getCollections');
    try {
      const response = await this.retry(() => this.axios.get('/collections'));
      timer.end();
      return response.data.data;
    } catch (error) {
      timer.end();
      throw error;
    }
  }

  async createCollection(collection: DirectusCollection): Promise<DirectusCollection> {
    const timer = this.logger.startTimer(`createCollection.${collection.collection}`);
    try {
      const response = await this.retry(() => this.axios.post('/collections', collection));
      timer.end();
      return response.data.data;
    } catch (error) {
      timer.end();
      throw error;
    }
  }

  async updateCollection(name: string, updates: Partial<DirectusCollection>): Promise<DirectusCollection> {
    const timer = this.logger.startTimer(`updateCollection.${name}`);
    try {
      const response = await this.retry(() => this.axios.patch(`/collections/${name}`, updates));
      timer.end();
      return response.data.data;
    } catch (error) {
      timer.end();
      throw error;
    }
  }

  async deleteCollection(name: string): Promise<void> {
    const timer = this.logger.startTimer(`deleteCollection.${name}`);
    try {
      await this.retry(() => this.axios.delete(`/collections/${name}`));
      timer.end();
    } catch (error) {
      timer.end();
      throw error;
    }
  }

  // Fields API
  async getFields(collection: string): Promise<DirectusField[]> {
    const timer = this.logger.startTimer(`getFields.${collection}`);
    try {
      const response = await this.retry(() => this.axios.get(`/fields/${collection}`));
      timer.end();
      return response.data.data;
    } catch (error) {
      timer.end();
      throw error;
    }
  }

  async createField(field: DirectusField): Promise<DirectusField> {
    const timer = this.logger.startTimer(`createField.${field.collection}.${field.field}`);
    try {
      const response = await this.retry(() => 
        this.axios.post(`/fields/${field.collection}`, field)
      );
      timer.end();
      return response.data.data;
    } catch (error) {
      timer.end();
      throw error;
    }
  }

  async updateField(collection: string, field: string, updates: Partial<DirectusField>): Promise<DirectusField> {
    const timer = this.logger.startTimer(`updateField.${collection}.${field}`);
    try {
      const response = await this.retry(() => 
        this.axios.patch(`/fields/${collection}/${field}`, updates)
      );
      timer.end();
      return response.data.data;
    } catch (error) {
      timer.end();
      throw error;
    }
  }

  async deleteField(collection: string, field: string): Promise<void> {
    const timer = this.logger.startTimer(`deleteField.${collection}.${field}`);
    try {
      await this.retry(() => this.axios.delete(`/fields/${collection}/${field}`));
      timer.end();
    } catch (error) {
      timer.end();
      throw error;
    }
  }

  // Relations API
  async getRelations(): Promise<DirectusRelation[]> {
    const timer = this.logger.startTimer('getRelations');
    try {
      const response = await this.retry(() => this.axios.get('/relations'));
      timer.end();
      return response.data.data;
    } catch (error) {
      timer.end();
      throw error;
    }
  }

  async createRelation(relation: DirectusRelation): Promise<DirectusRelation> {
    const timer = this.logger.startTimer(`createRelation.${relation.collection}.${relation.field}`);
    try {
      const response = await this.retry(() => this.axios.post('/relations', relation));
      timer.end();
      return response.data.data;
    } catch (error) {
      timer.end();
      throw error;
    }
  }

  async deleteRelation(collection: string, field: string): Promise<void> {
    const timer = this.logger.startTimer(`deleteRelation.${collection}.${field}`);
    try {
      await this.retry(() => this.axios.delete(`/relations/${collection}/${field}`));
      timer.end();
    } catch (error) {
      timer.end();
      throw error;
    }
  }

  // Items API - Generic CRUD operations
  async getItems<T = any>(collection: string, options?: QueryOptions): Promise<T[]> {
    const timer = this.logger.startTimer(`getItems.${collection}`);
    try {
      const params = new URLSearchParams();
      
      if (options?.limit) params.append('limit', options.limit.toString());
      if (options?.offset) params.append('offset', options.offset.toString());
      if (options?.fields) params.append('fields', options.fields.join(','));
      if (options?.search) params.append('search', options.search);
      if (options?.filter) params.append('filter', JSON.stringify(options.filter));
      if (options?.sort) params.append('sort', options.sort.join(','));
      if (options?.deep) params.append('deep', JSON.stringify(options.deep));
      if (options?.aggregate) params.append('aggregate', JSON.stringify(options.aggregate));

      const response = await this.retry(() => 
        this.axios.get(`/items/${collection}?${params.toString()}`)
      );
      timer.end();
      return response.data.data;
    } catch (error) {
      timer.end();
      throw error;
    }
  }

  async createItem<T = any>(collection: string, data: Partial<T>): Promise<T> {
    const timer = this.logger.startTimer(`createItem.${collection}`);
    try {
      const response = await this.retry(() => 
        this.axios.post(`/items/${collection}`, data)
      );
      timer.end();
      return response.data.data;
    } catch (error) {
      timer.end();
      throw error;
    }
  }

  async createItems<T = any>(collection: string, data: Partial<T>[]): Promise<T[]> {
    const timer = this.logger.startTimer(`createItems.${collection}`);
    try {
      const response = await this.retry(() => 
        this.axios.post(`/items/${collection}`, data)
      );
      timer.end();
      return response.data.data;
    } catch (error) {
      timer.end();
      throw error;
    }
  }

  async updateItem<T = any>(collection: string, id: string, data: Partial<T>): Promise<T> {
    const timer = this.logger.startTimer(`updateItem.${collection}.${id}`);
    try {
      const response = await this.retry(() => 
        this.axios.patch(`/items/${collection}/${id}`, data)
      );
      timer.end();
      return response.data.data;
    } catch (error) {
      timer.end();
      throw error;
    }
  }

  async deleteItem(collection: string, id: string): Promise<void> {
    const timer = this.logger.startTimer(`deleteItem.${collection}.${id}`);
    try {
      await this.retry(() => this.axios.delete(`/items/${collection}/${id}`));
      timer.end();
    } catch (error) {
      timer.end();
      throw error;
    }
  }

  // Users API
  async getUsers(): Promise<DirectusUser[]> {
    return (await this.retry(() => this.axios.get('/users'))).data.data;
  }

  async createUser(user: Partial<DirectusUser>): Promise<DirectusUser> {
    return (await this.retry(() => this.axios.post('/users', user))).data.data;
  }

  // Roles API
  async getRoles(): Promise<DirectusRole[]> {
    return (await this.retry(() => this.axios.get('/roles'))).data.data;
  }

  // Files API
  async getFiles(): Promise<DirectusFile[]> {
    return (await this.retry(() => this.axios.get('/files'))).data.data;
  }

  async uploadFile(formData: FormData): Promise<DirectusFile> {
    const response = await this.axios.post('/files', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
    return response.data.data;
  }

  async deleteFile(id: string): Promise<void> {
    await this.axios.delete(`/files/${id}`);
  }

  // Schema API
  async getSchema(): Promise<any> {
    return (await this.retry(() => this.axios.get('/schema/snapshot'))).data;
  }

  // Server info
  async getServerInfo(): Promise<any> {
    return (await this.retry(() => this.axios.get('/server/info'))).data.data;
  }
}

// ===== UTILITY FUNCTIONS =====

function getInterfaceForType(type: FieldType): string {
  const interfaceMap: Record<string, string> = {
    'string': 'input',
    'text': 'input-multiline',
    'boolean': 'boolean',
    'integer': 'input',
    'bigInteger': 'input',
    'float': 'input',
    'decimal': 'input',
    'date': 'date',
    'dateTime': 'datetime',
    'time': 'time',
    'timestamp': 'datetime',
    'json': 'input-code',
    'csv': 'tags',
    'uuid': 'input',
    'hash': 'input',
    'geometry': 'map'
  };
  return interfaceMap[type] || 'input';
}

function extractVariables(text: string): string[] {
  if (!text) return [];
  const matches = text.match(/\{\{([^}]+)\}\}/g);
  if (!matches) return [];
  return [...new Set(matches.map(match => match.slice(2, -2).trim()))];
}

// ===== MCP SERVER IMPLEMENTATION =====

class DirectusMCPServer {
  private server: Server;
  private logger: Logger;
  private directus: DirectusAPIClient;
  private websocket: DirectusWebSocketHandler | null = null;

  constructor() {
    this.logger = new Logger({ service: 'DirectusMCPServer' });
    
    this.server = new Server(
      { name: 'directus-enhanced-mcp', version: '4.0.0' },
      { capabilities: { tools: {}, prompts: {} } }
    );

    this.directus = new DirectusAPIClient(config);
    
    if (config.websocket) {
      this.websocket = new DirectusWebSocketHandler(config.url, config.token);
      this.initializeWebSocket();
    }

    this.registerHandlers();
    this.setupErrorHandlers();
  }

  private async initializeWebSocket(): Promise<void> {
    if (this.websocket) {
      try {
        await this.websocket.connect();
        this.logger.info('WebSocket connection established');
      } catch (error) {
        this.logger.warn('WebSocket connection failed, continuing without real-time features', { error });
      }
    }
  }

  private registerHandlers(): void {
    // Prompts handlers
    this.server.setRequestHandler(ListPromptsRequestSchema, async () => {
      const prompts = await this.getPrompts();
      return {
        prompts: prompts.map(prompt => {
          const systemVars = extractVariables(prompt.system_prompt);
          const messageVars = prompt.messages ? extractVariables(JSON.stringify(prompt.messages)) : [];
          const allVars = [...new Set([...systemVars, ...messageVars])];

          return {
            name: prompt.name,
            description: prompt.description || `AI prompt: ${prompt.name}`,
            arguments: allVars.map(variable => ({
              name: variable,
              description: `Value for ${variable}`,
              required: false,
            })),
          };
        }),
      };
    });

    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const { name, arguments: args = {} } = request.params;
      const prompt = await this.getPromptByName(name);
      
      if (!prompt) {
        throw new Error(`Prompt not found: ${name}`);
      }

      let systemPrompt = prompt.system_prompt || '';
      let messages: any[] = [];

      if (prompt.messages) {
        try {
          const parsedMessages = typeof prompt.messages === 'string' 
            ? JSON.parse(prompt.messages) 
            : prompt.messages;

          if (Array.isArray(parsedMessages)) {
            messages = parsedMessages;
          }
        } catch (error) {
          this.logger.error('Error parsing messages:', { error });
        }
      }

      for (const [key, value] of Object.entries(args)) {
        const placeholder = `{{${key}}}`;
        const regex = new RegExp(placeholder, 'g');
        systemPrompt = systemPrompt.replace(regex, value as string);

        messages = messages.map(msg => ({
          ...msg,
          content: msg.content ? msg.content.replace(regex, value as string) : msg.content,
          text: msg.text ? msg.text.replace(regex, value as string) : msg.text,
        }));
      }

      return {
        description: prompt.description || `AI prompt: ${name}`,
        messages: [
          ...(systemPrompt ? [{ role: 'system', content: { type: 'text', text: systemPrompt } }] : []),
          ...messages.map(msg => ({
            role: msg.role || 'user',
            content: { type: 'text', text: msg.content || msg.text || '' }
          }))
        ]
      };
    });

    // Tools handlers
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.getToolDefinitions()
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      this.logger.info(`Tool called: ${name}`, { tool: name, args });

      try {
        return await this.handleToolCall(name, args);
      } catch (error) {
        this.logger.error(`Tool execution failed: ${name}`, { error, tool: name });
        return {
          content: [{
            type: 'text',
            text: `Error executing tool '${name}': ${(error as Error).message}`
          }]
        };
      }
    });
  }

  private async handleToolCall(name: string, args: any): Promise<any> {
    switch (name) {
      // Collection management
      case 'list_collections':
        return this.handleListCollections();
      case 'create_collection':
        return this.handleCreateCollection(args);
      case 'update_collection':
        return this.handleUpdateCollection(args);
      case 'delete_collection':
        return this.handleDeleteCollection(args);

      // Field management
      case 'create_field':
        return this.handleCreateField(args);
      case 'get_fields':
        return this.handleGetFields(args);
      case 'update_field':
        return this.handleUpdateField(args);
      case 'delete_field':
        return this.handleDeleteField(args);

      // Relation management
      case 'create_relation':
        return this.handleCreateRelation(args);
      case 'get_relations':
        return this.handleGetRelations();
      case 'delete_relation':
        return this.handleDeleteRelation(args);

      // Content operations
      case 'get_collection_items':
        return this.handleGetCollectionItems(args);
      case 'create_item':
        return this.handleCreateItem(args);
      case 'create_batch_items':
        return this.handleCreateBatchItems(args);
      case 'update_item':
        return this.handleUpdateItem(args);
      case 'delete_item':
        return this.handleDeleteItem(args);
      case 'query_items':
        return this.handleQueryItems(args);

      // User management
      case 'get_users':
        return this.handleGetUsers();
      case 'create_user':
        return this.handleCreateUser(args);
      case 'get_roles':
        return this.handleGetRoles();

      // File management
      case 'get_files':
        return this.handleGetFiles();
      case 'upload_from_url':
        return this.handleUploadFromUrl(args);
      case 'upload_from_path':
        return this.handleUploadFromPath(args);
      case 'delete_file':
        return this.handleDeleteFile(args);

      // Real-time features
      case 'subscribe_realtime':
        return this.handleSubscribeRealtime(args);
      case 'unsubscribe_realtime':
        return this.handleUnsubscribeRealtime(args);

      // Schema management
      case 'get_schema':
        return this.handleGetSchema();
      case 'get_server_info':
        return this.handleGetServerInfo();

      // E-commerce specific tools
      case 'get_products':
        return this.handleGetProducts(args);
      case 'create_product':
        return this.handleCreateProduct(args);
      case 'update_product':
        return this.handleUpdateProduct(args);
      case 'get_orders':
        return this.handleGetOrders(args);
      case 'create_order':
        return this.handleCreateOrder(args);
      case 'get_customers':
        return this.handleGetCustomers(args);
      case 'create_customer':
        return this.handleCreateCustomer(args);
      case 'get_brands':
        return this.handleGetBrands(args);
      case 'get_categories':
        return this.handleGetCategories(args);
      case 'get_product_images':
        return this.handleGetProductImages(args);

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  // Tool handlers implementation
  private async handleListCollections(): Promise<any> {
    const collections = await this.directus.getCollections();
    const nonSystemCollections = collections.filter(c => !c.collection.startsWith('directus_'));
    
    return {
      content: [{
        type: 'text',
        text: `Available collections (${nonSystemCollections.length}):\n\n${nonSystemCollections.map(c => 
          `• ${c.collection}: ${c.meta?.note || 'No description'}`
        ).join('\n')}`
      }]
    };
  }

  private async handleCreateCollection(args: any): Promise<any> {
    const { collection, meta = {} } = args;
    
    const collectionData: DirectusCollection = {
      collection,
      meta: {
        collection,
        icon: 'folder',
        color: '#6644FF',
        note: null,
        display_template: null,
        hidden: false,
        singleton: false,
        sort_field: 'sort',
        archive_field: 'status',
        archive_app_filter: true,
        archive_value: 'archived',
        unarchive_value: 'draft',
        accountability: 'all',
        ...meta
      }
    };

    const result = await this.directus.createCollection(collectionData);
    
    return {
      content: [{
        type: 'text',
        text: `Collection '${collection}' created successfully\n\n${JSON.stringify(result, null, 2)}`
      }]
    };
  }

  private async handleCreateField(args: any): Promise<any> {
    const { collection, field, type = 'string', meta = {}, schema = {} } = args;
    
    const fieldData: DirectusField = {
      collection,
      field,
      type,
      meta: {
        collection,
        field,
        interface: getInterfaceForType(type),
        display: 'raw',
        readonly: false,
        hidden: false,
        width: 'full',
        required: false,
        ...meta
      }
    };

    if (Object.keys(schema).length > 0) {
      fieldData.schema = {
        name: field,
        table: collection,
        data_type: type,
        is_nullable: true,
        is_unique: false,
        is_primary_key: false,
        has_auto_increment: false,
        default_value: null,
        ...schema
      };
    }

    const result = await this.directus.createField(fieldData);
    
    return {
      content: [{
        type: 'text',
        text: `Field '${field}' created in collection '${collection}'\n\n${JSON.stringify(result, null, 2)}`
      }]
    };
  }

  private async handleSubscribeRealtime(args: any): Promise<any> {
    const { event, collection } = args;
    const eventName = collection ? `${collection}.${event}` : event;
    
    if (this.websocket?.isConnected()) {
      this.websocket.subscribe(eventName);
      return {
        content: [{
          type: 'text',
          text: `Subscribed to real-time updates for event: ${eventName}`
        }]
      };
    } else {
      return {
        content: [{
          type: 'text',
          text: 'WebSocket not connected. Real-time subscriptions are not available.'
        }]
      };
    }
  }

  private async handleUnsubscribeRealtime(args: any): Promise<any> {
    const { event, collection } = args;
    const eventName = collection ? `${collection}.${event}` : event;
    
    if (this.websocket?.isConnected()) {
      this.websocket.unsubscribe(eventName);
      return {
        content: [{
          type: 'text',
          text: `Unsubscribed from real-time updates for event: ${eventName}`
        }]
      };
    } else {
      return {
        content: [{
          type: 'text',
          text: 'WebSocket not connected. Cannot unsubscribe from real-time updates.'
        }]
      };
    }
  }

  private async handleGetProducts(args: any): Promise<any> {
    const { limit = 25, offset = 0, filter = {}, search } = args;
    
    const products = await this.directus.getItems('products', {
      limit,
      offset,
      filter: { ...filter, status: { _eq: 'published' } },
      search,
      fields: ['id', 'reference', 'name', 'name_en', 'description', 'description_en', 'price_without_discount', 'price_with_discount', 'stock', 'brand_id', 'primary_image_file']
    });

    return {
      content: [{
        type: 'text',
        text: `Found ${products.length} products:\n\n${products.map(p => 
          `• ${p.name} (${p.reference}) - $${p.price_with_discount || p.price_without_discount} - Stock: ${p.stock}`
        ).join('\n')}`
      }]
    };
  }

  private async handleCreateProduct(args: any): Promise<any> {
    const { name, description, price_without_discount, stock = 0, reference, brand_id } = args;
    
    const product = await this.directus.createItem('products', {
      name,
      description,
      price_without_discount,
      stock,
      reference,
      brand_id,
      status: 'draft'
    });

    return {
      content: [{
        type: 'text',
        text: `Product "${name}" created successfully with ID: ${product.id}`
      }]
    };
  }

  private async handleUpdateProduct(args: any): Promise<any> {
    const { id, ...updates } = args;
    
    const product = await this.directus.updateItem('products', id, updates);

    return {
      content: [{
        type: 'text',
        text: `Product "${product.name}" updated successfully`
      }]
    };
  }

  private async handleGetOrders(args: any): Promise<any> {
    const { limit = 25, offset = 0, filter = {}, status } = args;
    
    const orders = await this.directus.getItems('orders', {
      limit,
      offset,
      filter: status ? { ...filter, status: { _eq: status } } : filter,
      fields: ['id', 'order_number', 'status', 'total', 'customer_id', 'created_at']
    });

    return {
      content: [{
        type: 'text',
        text: `Found ${orders.length} orders:\n\n${orders.map(o => 
          `• Order #${o.order_number} - ${o.status} - $${o.total} - Customer: ${o.customer_id}`
        ).join('\n')}`
      }]
    };
  }

  private async handleCreateOrder(args: any): Promise<any> {
    const { customer_id, order_items, total } = args;
    
    // Generate order number
    const orderNumber = `ORD-${Date.now()}`;
    
    const order = await this.directus.createItem('orders', {
      order_number: orderNumber,
      customer_id,
      total,
      status: 'pending'
    });

    // Create order items
    if (order_items && Array.isArray(order_items)) {
      for (const item of order_items) {
        await this.directus.createItem('order_items', {
          order_id: order.id,
          product_id: item.product_id,
          quantity: item.quantity,
          price: item.price
        });
      }
    }

    return {
      content: [{
        type: 'text',
        text: `Order #${orderNumber} created successfully with ${order_items?.length || 0} items`
      }]
    };
  }

  private async handleGetCustomers(args: any): Promise<any> {
    const { limit = 25, offset = 0, filter = {}, search } = args;
    
    const customers = await this.directus.getItems('customers', {
      limit,
      offset,
      filter: { ...filter, status: { _eq: 'active' } },
      search,
      fields: ['id', 'first_name', 'last_name', 'email', 'status']
    });

    return {
      content: [{
        type: 'text',
        text: `Found ${customers.length} customers:\n\n${customers.map(c => 
          `• ${c.first_name} ${c.last_name} - ${c.email}`
        ).join('\n')}`
      }]
    };
  }

  private async handleCreateCustomer(args: any): Promise<any> {
    const { first_name, last_name, email } = args;
    
    const customer = await this.directus.createItem('customers', {
      first_name,
      last_name,
      email,
      status: 'active'
    });

    return {
      content: [{
        type: 'text',
        text: `Customer "${first_name} ${last_name}" created successfully with ID: ${customer.id}`
      }]
    };
  }

  private async handleGetBrands(args: any): Promise<any> {
    const { limit = 25, offset = 0, filter = {} } = args;
    
    const brands = await this.directus.getItems('brands', {
      limit,
      offset,
      filter: { ...filter, status: { _eq: 'active' } },
      fields: ['id', 'name', 'status']
    });

    return {
      content: [{
        type: 'text',
        text: `Found ${brands.length} brands:\n\n${brands.map(b => 
          `• ${b.name}`
        ).join('\n')}`
      }]
    };
  }

  private async handleGetCategories(args: any): Promise<any> {
    const { limit = 25, offset = 0, filter = {} } = args;
    
    const categories = await this.directus.getItems('categories', {
      limit,
      offset,
      filter: { ...filter, status: { _eq: 'published' } },
      fields: ['id', 'name', 'name_en', 'parent_id']
    });

    return {
      content: [{
        type: 'text',
        text: `Found ${categories.length} categories:\n\n${categories.map(c => 
          `• ${c.name} (${c.name_en || 'No translation'})`
        ).join('\n')}`
      }]
    };
  }

  private async handleGetProductImages(args: any): Promise<any> {
    const { product_id, limit = 50 } = args;
    
    const images = await this.directus.getItems('product_images', {
      limit,
      filter: product_id ? { product_id: { _eq: product_id } } : {},
      fields: ['id', 'title', 'description', 'sort', 'product_id']
    });

    return {
      content: [{
        type: 'text',
        text: `Found ${images.length} product images:\n\n${images.map(img => 
          `• ${img.title || 'Untitled'} - Product: ${img.product_id}`
        ).join('\n')}`
      }]
    };
  }

  private async getPrompts(): Promise<any[]> {
    try {
      return await this.directus.getItems('prompts', { 
        filter: { status: { _eq: 'published' } } 
      });
    } catch (error) {
      this.logger.error('Error fetching prompts:', { error });
      return [];
    }
  }

  private async getPromptByName(name: string): Promise<any> {
    try {
      const results = await this.directus.getItems('prompts', {
        filter: { name: { _eq: name } },
        limit: 1
      });
      return results[0] || null;
    } catch (error) {
      this.logger.error('Error fetching prompt:', { error });
      return null;
    }
  }

  private getToolDefinitions(): any[] {
    // Return all your tool definitions here
    // This would include all the tools from your original script
    return [
      {
        name: 'list_collections',
        description: 'List all available Directus collections',
        inputSchema: { type: 'object', properties: {} }
      },
      {
        name: 'create_collection',
        description: 'Create a new collection in Directus',
        inputSchema: {
          type: 'object',
          properties: {
            collection: { type: 'string', description: 'Collection name' },
            meta: { type: 'object', description: 'Collection metadata options' }
          },
          required: ['collection']
        }
      },
      // E-commerce specific tools
      {
        name: 'get_products',
        description: 'Get products from the products collection with filtering and pagination',
        inputSchema: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Number of products to return (default: 25)', default: 25 },
            offset: { type: 'number', description: 'Offset for pagination', default: 0 },
            filter: { type: 'object', description: 'Additional filters' },
            search: { type: 'string', description: 'Search query' }
          }
        }
      },
      {
        name: 'create_product',
        description: 'Create a new product in the products collection',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Product name' },
            description: { type: 'string', description: 'Product description' },
            price_without_discount: { type: 'number', description: 'Base price' },
            stock: { type: 'number', description: 'Stock quantity', default: 0 },
            reference: { type: 'string', description: 'Product SKU/reference' },
            brand_id: { type: 'number', description: 'Brand ID (optional)' }
          },
          required: ['name', 'price_without_discount']
        }
      },
      {
        name: 'update_product',
        description: 'Update an existing product',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'number', description: 'Product ID' },
            name: { type: 'string', description: 'Product name' },
            description: { type: 'string', description: 'Product description' },
            price_without_discount: { type: 'number', description: 'Base price' },
            stock: { type: 'number', description: 'Stock quantity' },
            reference: { type: 'string', description: 'Product SKU/reference' },
            brand_id: { type: 'number', description: 'Brand ID' }
          },
          required: ['id']
        }
      },
      {
        name: 'get_orders',
        description: 'Get orders from the orders collection',
        inputSchema: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Number of orders to return', default: 25 },
            offset: { type: 'number', description: 'Offset for pagination', default: 0 },
            filter: { type: 'object', description: 'Additional filters' },
            status: { type: 'string', description: 'Order status filter' }
          }
        }
      },
      {
        name: 'create_order',
        description: 'Create a new order with order items',
        inputSchema: {
          type: 'object',
          properties: {
            customer_id: { type: 'number', description: 'Customer ID' },
            order_items: { 
              type: 'array', 
              description: 'Array of order items',
              items: {
                type: 'object',
                properties: {
                  product_id: { type: 'number', description: 'Product ID' },
                  quantity: { type: 'number', description: 'Quantity' },
                  price: { type: 'number', description: 'Price per item' }
                },
                required: ['product_id', 'quantity', 'price']
              }
            },
            total: { type: 'number', description: 'Total order amount' }
          },
          required: ['customer_id', 'total']
        }
      },
      {
        name: 'get_customers',
        description: 'Get customers from the customers collection',
        inputSchema: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Number of customers to return', default: 25 },
            offset: { type: 'number', description: 'Offset for pagination', default: 0 },
            filter: { type: 'object', description: 'Additional filters' },
            search: { type: 'string', description: 'Search query' }
          }
        }
      },
      {
        name: 'create_customer',
        description: 'Create a new customer',
        inputSchema: {
          type: 'object',
          properties: {
            first_name: { type: 'string', description: 'Customer first name' },
            last_name: { type: 'string', description: 'Customer last name' },
            email: { type: 'string', description: 'Customer email' }
          },
          required: ['first_name', 'last_name', 'email']
        }
      },
      {
        name: 'get_brands',
        description: 'Get brands from the brands collection',
        inputSchema: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Number of brands to return', default: 25 },
            offset: { type: 'number', description: 'Offset for pagination', default: 0 },
            filter: { type: 'object', description: 'Additional filters' }
          }
        }
      },
      {
        name: 'get_categories',
        description: 'Get categories from the categories collection',
        inputSchema: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Number of categories to return', default: 25 },
            offset: { type: 'number', description: 'Offset for pagination', default: 0 },
            filter: { type: 'object', description: 'Additional filters' }
          }
        }
      },
      {
        name: 'get_product_images',
        description: 'Get product images from the product_images collection',
        inputSchema: {
          type: 'object',
          properties: {
            product_id: { type: 'number', description: 'Filter by product ID' },
            limit: { type: 'number', description: 'Number of images to return', default: 50 }
          }
        }
      },
      // Add all other tool definitions...
    ];
  }

  private setupErrorHandlers(): void {
    const shutdown = async (signal: string) => {
      this.logger.info(`Received ${signal}, shutting down gracefully...`);
      
      try {
        if (this.websocket) {
          this.websocket.disconnect();
        }
        await this.server.close();
        process.exit(0);
      } catch (error) {
        this.logger.error('Error during shutdown', { error });
        process.exit(1);
      }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('uncaughtException', (error) => {
      this.logger.error('Uncaught Exception', { error });
      process.exit(1);
    });
    process.on('unhandledRejection', (reason, promise) => {
      this.logger.error('Unhandled Rejection', { reason, promise: promise.toString() });
      process.exit(1);
    });
  }

  async start(): Promise<void> {
    try {
      this.logger.info('Starting Enhanced Directus MCP Server', {
        version: '4.0.0',
        directusUrl: config.url,
        websocketEnabled: config.websocket
      });

      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      
      this.logger.info('Directus MCP Server started successfully');
    } catch (error) {
      this.logger.error('Failed to start MCP server', { error });
      process.exit(1);
    }
  }
}

// ===== MAIN =====

async function main() {
  const mcpServer = new DirectusMCPServer();
  await mcpServer.start();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
