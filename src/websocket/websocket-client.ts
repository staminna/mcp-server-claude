// Real-time WebSocket Support with Auto-reconnection and Event Management

import WebSocket from 'ws';
import { logger } from '../utils/logger.js';
import {
  WebSocketEvent,
  WebSocketMessage,
  QueryOptions,
  DirectusConfig
} from '../types/directus.js';

export interface SubscriptionOptions extends QueryOptions {
  event?: 'create' | 'update' | 'delete';
}

export interface Subscription {
  uid: string;
  collection: string;
  query?: QueryOptions;
  event?: string;
  callback: (data: any) => void;
}

export class DirectusWebSocketClient {
  private ws: WebSocket | null = null;
  private config: DirectusConfig;
  private subscriptions: Map<string, Subscription> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private maxReconnectDelay = 30000;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private heartbeatTimeout: NodeJS.Timeout | null = null;
  private isConnecting = false;
  private isAuthenticated = false;

  constructor(config: DirectusConfig) {
    this.config = config;
    
    // Build WebSocket URL
    if (!this.config.websocketUrl) {
      const wsProtocol = this.config.url.startsWith('https') ? 'wss' : 'ws';
      const baseUrl = this.config.url.replace(/^https?:\/\//, '');
      this.config.websocketUrl = `${wsProtocol}://${baseUrl}/websocket`;
    }
  }

  private async connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    // Only log connection attempts every 5th attempt to reduce noise
    if (this.reconnectAttempts % 5 === 0) {
      logger.websocketEvent('Connecting to WebSocket', {
        url: this.config.websocketUrl,
        attempt: this.reconnectAttempts + 1
      });
    }

    this.isConnecting = true;

    try {
      this.ws = new WebSocket(this.config.websocketUrl!);
      this.setupEventHandlers();

      // Wait for connection to open
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('WebSocket connection timeout'));
        }, 10000);

        this.ws!.once('open', () => {
          clearTimeout(timeout);
          resolve();
        });

        this.ws!.once('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });

      this.isConnecting = false;
      this.reconnectAttempts = 0;
      logger.websocketEvent('WebSocket connection opened');
      
      // Authenticate immediately after connection
      await this.authenticate();
      
    } catch (error) {
      this.isConnecting = false;
      logger.websocketError(error as Error, { 
        url: this.config.websocketUrl,
        attempt: this.reconnectAttempts + 1
      });
      
      // Schedule reconnection
      this.scheduleReconnect();
      throw error;
    }
  }

  private setupEventHandlers(): void {
    if (!this.ws) return;

    this.ws.on('open', () => {
      logger.websocketEvent('WebSocket connection opened');
    });

    this.ws.on('message', (data: WebSocket.Data) => {
      try {
        const message: WebSocketMessage = JSON.parse(data.toString());
        this.handleMessage(message);
      } catch (error) {
        logger.websocketError(error as Error, { 
          data: data.toString(),
          type: 'message_parse_error'
        });
      }
    });

    this.ws.on('close', (code: number, reason: Buffer) => {
      logger.websocketEvent('WebSocket connection closed', {
        code,
        reason: reason.toString()
      });

      this.cleanup();
      
      // Attempt reconnection unless it was a clean close
      if (code !== 1000) {
        this.scheduleReconnect();
      }
    });

    this.ws.on('error', (error: Error) => {
      logger.websocketError(error, { type: 'connection_error' });
    });

    this.ws.on('pong', () => {
      logger.debug('WebSocket pong received');
      this.clearHeartbeatTimeout();
    });
  }

  private handleMessage(message: WebSocketMessage): void {
    // Reduced logging for message handling
    switch (message.type) {
      case 'auth':
        this.handleAuthMessage(message);
        break;
      
      case 'subscription':
        this.handleSubscriptionMessage(message);
        break;
      
      case 'ping':
        this.sendPong();
        break;
      
      case 'pong':
        this.clearHeartbeatTimeout();
        break;
      
      case 'error':
        logger.websocketError(new Error(message.error?.message || 'Unknown WebSocket error'), {
          code: message.error?.extensions?.code,
          uid: message.uid
        });
        break;
      
      default:
        logger.warn('Unknown WebSocket message type', { type: message.type });
    }
  }

  private handleAuthMessage(message: WebSocketMessage): void {
    if (message.data?.status === 'ok') {
      this.isAuthenticated = true;
      logger.websocketEvent('WebSocket authentication successful');
    } else {
      this.isAuthenticated = false;
      logger.websocketError(new Error('WebSocket authentication failed'), {
        data: message.data
      });
    }
  }

  private handleSubscriptionMessage(message: WebSocketMessage): void {
    if (!message.uid) return;

    const subscription = this.subscriptions.get(message.uid);
    if (!subscription) {
      logger.warn('Received message for unknown subscription', { uid: message.uid });
      return;
    }

    try {
      subscription.callback(message.data);
      logger.debug('Subscription callback executed', {
        uid: message.uid,
        collection: subscription.collection,
        event: message.event
      });
    } catch (error) {
      logger.websocketError(error as Error, {
        uid: message.uid,
        collection: subscription.collection,
        type: 'callback_error'
      });
    }
  }

  private async authenticate(): Promise<void> {
    if (!this.config.token || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const authMessage: WebSocketEvent = {
      type: 'auth',
      data: {
        access_token: this.config.token
      }
    };

    this.sendMessage(authMessage);

    // Wait for authentication response
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Authentication timeout'));
      }, 5000);

      const checkAuth = () => {
        if (this.isAuthenticated) {
          clearTimeout(timeout);
          resolve();
        } else {
          setTimeout(checkAuth, 100);
        }
      };

      checkAuth();
    });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.sendPing();
        
        // Set timeout for pong response
        this.heartbeatTimeout = setTimeout(() => {
          logger.warn('WebSocket heartbeat timeout, closing connection');
          this.ws?.close();
        }, 5000);
      }
    }, 30000); // Send ping every 30 seconds
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    this.clearHeartbeatTimeout();
  }

  private clearHeartbeatTimeout(): void {
    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = null;
    }
  }

  private sendPing(): void {
    const pingMessage: WebSocketEvent = { type: 'ping' };
    this.sendMessage(pingMessage);
  }

  private sendPong(): void {
    const pongMessage: WebSocketEvent = { type: 'pong' };
    this.sendMessage(pongMessage);
  }

  private sendMessage(message: WebSocketEvent): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      logger.warn('Cannot send message, WebSocket not connected', { message });
      return;
    }

    try {
      this.ws.send(JSON.stringify(message));
      logger.debug('WebSocket message sent', { type: message.type });
    } catch (error) {
      logger.websocketError(error as Error, { 
        message,
        type: 'send_error'
      });
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.websocketError(new Error('Max reconnection attempts reached'), {
        attempts: this.reconnectAttempts,
        maxAttempts: this.maxReconnectAttempts
      });
      return;
    }

    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts),
      30000 // Max 30 seconds
    );

    // Only log every 3rd reconnection attempt to reduce noise
    if (this.reconnectAttempts % 3 === 0) {
      logger.websocketEvent('Scheduling WebSocket reconnection', {
        attempt: this.reconnectAttempts + 1,
        delay,
        maxAttempts: this.maxReconnectAttempts
      });
    }

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectAttempts++;
      this.connect();
    }, delay);
  }

  private cleanup(): void {
    this.isAuthenticated = false;
    this.stopHeartbeat();
    
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws = null;
    }
  }

  private async resubscribeAll(): Promise<void> {
    if (this.subscriptions.size === 0) return;

    logger.websocketEvent('Resubscribing to all subscriptions', {
      count: this.subscriptions.size
    });

    for (const [uid, subscription] of this.subscriptions) {
      try {
        await this.subscribe(
          subscription.collection,
          subscription.callback,
          subscription.query,
          subscription.event,
          uid
        );
      } catch (error) {
        logger.websocketError(error as Error, {
          uid,
          collection: subscription.collection,
          type: 'resubscribe_error'
        });
      }
    }
  }

  // Public API methods
  async subscribe(
    collection: string,
    callback: (data: any) => void,
    query?: QueryOptions,
    event?: string,
    uid?: string
  ): Promise<string> {
    const subscriptionUid = uid || this.generateUID();

    // Store subscription
    this.subscriptions.set(subscriptionUid, {
      uid: subscriptionUid,
      collection,
      query,
      event,
      callback
    });

    // Send subscription message if connected
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.isAuthenticated) {
      const subscribeMessage: WebSocketEvent = {
        type: 'subscribe',
        collection,
        query,
        uid: subscriptionUid
      };

      if (event) {
        subscribeMessage.data = { event };
      }

      this.sendMessage(subscribeMessage);

      logger.websocketEvent('Subscription created', {
        uid: subscriptionUid,
        collection,
        event
      });
    }

    return subscriptionUid;
  }

  async unsubscribe(uid: string): Promise<void> {
    const subscription = this.subscriptions.get(uid);
    if (!subscription) {
      logger.warn('Attempted to unsubscribe from unknown subscription', { uid });
      return;
    }

    // Remove from local storage
    this.subscriptions.delete(uid);

    // Send unsubscribe message if connected
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const unsubscribeMessage: WebSocketEvent = {
        type: 'unsubscribe',
        uid
      };

      this.sendMessage(unsubscribeMessage);
    }

    logger.websocketEvent('Subscription removed', {
      uid,
      collection: subscription.collection
    });
  }

  async unsubscribeAll(): Promise<void> {
    const uids = Array.from(this.subscriptions.keys());
    
    for (const uid of uids) {
      await this.unsubscribe(uid);
    }

    logger.websocketEvent('All subscriptions removed', { count: uids.length });
  }

  disconnect(): void {
    logger.websocketEvent('Disconnecting WebSocket');
    
    this.cleanup();
    
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
    }
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && this.isAuthenticated;
  }

  getSubscriptionCount(): number {
    return this.subscriptions.size;
  }

  private generateUID(): string {
    return `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
