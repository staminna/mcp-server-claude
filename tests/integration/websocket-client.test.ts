// Integration tests for DirectusWebSocketClient against a local ws server.
// connect() is private in the source; tests invoke it via (client as any).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { DirectusWebSocketClient } from '../../src/websocket/websocket-client.js';
import { startWsHarness, type WsHarness } from '../helpers/ws-server.js';

function makeClient(url: string, extra: Record<string, unknown> = {}): DirectusWebSocketClient {
  return new DirectusWebSocketClient({
    url: 'http://placeholder.test',
    token: 'ws-token',
    websocket: true,
    websocketUrl: url,
    ...extra,
  } as any);
}

/** Connect a client and complete the auth handshake against the harness. */
async function connectAuthenticated(harness: WsHarness): Promise<DirectusWebSocketClient> {
  const client = makeClient(harness.url);
  await (client as any).connect();
  return client;
}

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
  vi.restoreAllMocks();
});

function track(harness: WsHarness, client?: DirectusWebSocketClient) {
  cleanups.push(async () => {
    if (client) {
      // Prevent reconnect timers from leaking past the test.
      (client as any).maxReconnectAttempts = 0;
      if ((client as any).reconnectTimeout) clearTimeout((client as any).reconnectTimeout);
      client.disconnect();
    }
    await harness.close();
  });
}

describe('WebSocket URL building', () => {
  it('derives wss:// + /websocket from an https base URL', () => {
    const client = new DirectusWebSocketClient({ url: 'https://directus.example.com', token: 't' } as any);
    expect((client as any).config.websocketUrl).toBe('wss://directus.example.com/websocket');
  });

  it('derives ws:// from an http base URL', () => {
    const client = new DirectusWebSocketClient({ url: 'http://localhost:8065', token: 't' } as any);
    expect((client as any).config.websocketUrl).toBe('ws://localhost:8065/websocket');
  });

  it('respects an explicit websocketUrl', () => {
    const client = makeClient('ws://custom:1234/realtime');
    expect((client as any).config.websocketUrl).toBe('ws://custom:1234/realtime');
  });
});

describe('connection and authentication', () => {
  it('connects, authenticates with the token, and reports connected', async () => {
    const harness = await startWsHarness();
    const client = await connectAuthenticated(harness);
    track(harness, client);

    const authMsg = await harness.waitForMessage((m) => m?.type === 'auth');
    expect(authMsg.data).toEqual({ access_token: 'ws-token' });
    expect(client.isConnected()).toBe(true);
  });

  it('marks authentication failed on an auth error message', async () => {
    const harness = await startWsHarness();
    track(harness);
    const client = makeClient(harness.url);
    (client as any).handleAuthMessage({ type: 'auth', data: { status: 'error', error: 'bad token' } });
    expect((client as any).isAuthenticated).toBe(false);
    (client as any).handleAuthMessage({ type: 'auth', data: { status: 'ok' } });
    expect((client as any).isAuthenticated).toBe(true);
  });

  it('skips authentication without a token', async () => {
    const harness = await startWsHarness();
    const client = makeClient(harness.url, { token: '' });
    track(harness, client);
    await expect((client as any).authenticate()).resolves.toBeUndefined();
  });

  it('rejects and schedules reconnect when the endpoint is unreachable', async () => {
    const client = makeClient('ws://127.0.0.1:9');
    (client as any).maxReconnectAttempts = 0; // scheduleReconnect bails immediately
    await expect((client as any).connect()).rejects.toBeDefined();
    expect(client.isConnected()).toBe(false);
  });
});

describe('subscriptions', () => {
  it('sends a subscribe message and dispatches pushed events to the callback', async () => {
    const harness = await startWsHarness();
    const client = await connectAuthenticated(harness);
    track(harness, client);

    const received: any[] = [];
    const uid = await client.subscribe('articles', (data) => received.push(data), { limit: 1 }, 'create');
    expect(client.getSubscriptionCount()).toBe(1);

    const subMsg = await harness.waitForMessage((m) => m?.type === 'subscribe');
    expect(subMsg.collection).toBe('articles');
    expect(subMsg.uid).toBe(uid);
    expect(subMsg.query).toEqual({ limit: 1 });
    expect(subMsg.data).toEqual({ event: 'create' });

    harness.broadcast({ type: 'subscription', uid, event: 'create', data: { id: 7 } });
    await vi.waitFor(() => expect(received).toEqual([{ id: 7 }]));
  });

  it('swallows callback errors', async () => {
    const harness = await startWsHarness();
    const client = await connectAuthenticated(harness);
    track(harness, client);

    const uid = await client.subscribe('articles', () => {
      throw new Error('callback exploded');
    });
    harness.broadcast({ type: 'subscription', uid, data: {} });
    // The pushed message must not crash the client.
    await new Promise((r) => setTimeout(r, 50));
    expect(client.isConnected()).toBe(true);
  });

  it('warns on subscription messages for unknown uids', async () => {
    const harness = await startWsHarness();
    const client = await connectAuthenticated(harness);
    track(harness, client);
    harness.broadcast({ type: 'subscription', uid: 'sub_unknown', data: {} });
    harness.broadcast({ type: 'subscription', data: {} }); // no uid at all
    await new Promise((r) => setTimeout(r, 50));
    expect(client.isConnected()).toBe(true);
  });

  it('stores subscriptions made while disconnected without sending', async () => {
    const client = makeClient('ws://127.0.0.1:9');
    const uid = await client.subscribe('articles', () => undefined);
    expect(uid).toMatch(/^sub_/);
    expect(client.getSubscriptionCount()).toBe(1);
  });

  it('unsubscribe removes the subscription and notifies the server', async () => {
    const harness = await startWsHarness();
    const client = await connectAuthenticated(harness);
    track(harness, client);

    const uid = await client.subscribe('articles', () => undefined);
    await client.unsubscribe(uid);
    expect(client.getSubscriptionCount()).toBe(0);
    const unsub = await harness.waitForMessage((m) => m?.type === 'unsubscribe');
    expect(unsub.uid).toBe(uid);
  });

  it('unsubscribe on an unknown uid is a no-op warn', async () => {
    const client = makeClient('ws://127.0.0.1:9');
    await expect(client.unsubscribe('sub_nope')).resolves.toBeUndefined();
  });

  it('unsubscribeAll drains every subscription', async () => {
    const harness = await startWsHarness();
    const client = await connectAuthenticated(harness);
    track(harness, client);
    await client.subscribe('articles', () => undefined);
    await client.subscribe('authors', () => undefined);
    await client.unsubscribeAll();
    expect(client.getSubscriptionCount()).toBe(0);
  });

  it('resubscribeAll replays stored subscriptions over the connection', async () => {
    const harness = await startWsHarness();
    const client = await connectAuthenticated(harness);
    track(harness, client);

    await (client as any).resubscribeAll(); // zero subscriptions: early return
    await client.subscribe('articles', () => undefined, undefined, undefined, 'sub_fixed');
    await (client as any).resubscribeAll();
    await vi.waitFor(() => {
      const replays = harness.received.filter((m) => m?.type === 'subscribe' && m.uid === 'sub_fixed');
      expect(replays.length).toBe(2);
    });
  });
});

describe('protocol messages', () => {
  it('replies pong to server pings', async () => {
    const harness = await startWsHarness();
    const client = await connectAuthenticated(harness);
    track(harness, client);
    harness.broadcast({ type: 'ping' });
    const pong = await harness.waitForMessage((m) => m?.type === 'pong');
    expect(pong.type).toBe('pong');
  });

  it('clears the heartbeat timeout on pong messages', async () => {
    const harness = await startWsHarness();
    const client = await connectAuthenticated(harness);
    track(harness, client);
    (client as any).heartbeatTimeout = setTimeout(() => undefined, 60_000);
    (client as any).handleMessage({ type: 'pong' });
    expect((client as any).heartbeatTimeout).toBeNull();
  });

  it('logs server error messages and unknown types without crashing', async () => {
    const harness = await startWsHarness();
    const client = await connectAuthenticated(harness);
    track(harness, client);
    harness.broadcast({ type: 'error', error: { message: 'server broke', extensions: { code: 'X' } } });
    harness.broadcast({ type: 'error' }); // no error payload
    harness.broadcast({ type: 'mystery' });
    harness.broadcast('not json at all');
    await new Promise((r) => setTimeout(r, 50));
    expect(client.isConnected()).toBe(true);
  });

  it('startHeartbeat and stopHeartbeat manage the interval handles', async () => {
    const harness = await startWsHarness();
    const client = await connectAuthenticated(harness);
    track(harness, client);
    (client as any).startHeartbeat();
    expect((client as any).heartbeatInterval).not.toBeNull();
    (client as any).stopHeartbeat();
    expect((client as any).heartbeatInterval).toBeNull();
  });

  it('sendMessage warns instead of throwing when disconnected', () => {
    const client = makeClient('ws://127.0.0.1:9');
    expect(() => (client as any).sendPing()).not.toThrow();
  });
});

describe('disconnect and reconnection', () => {
  it('disconnect cleans up state (current behavior: socket reference dropped before close)', async () => {
    const harness = await startWsHarness();
    const client = await connectAuthenticated(harness);
    track(harness, client);
    client.disconnect();
    expect(client.isConnected()).toBe(false);
    expect((client as any).ws).toBeNull();
  });

  it('reconnects after an abnormal close', async () => {
    const harness = await startWsHarness();
    const client = await connectAuthenticated(harness);
    track(harness, client);
    (client as any).reconnectDelay = 1;
    (client as any).maxReconnectAttempts = 2;

    let connections = 0;
    harness.wss.on('connection', () => connections++);
    for (const socket of harness.sockets) socket.terminate();

    await vi.waitFor(() => expect(connections).toBeGreaterThanOrEqual(1), { timeout: 3000 });
    await vi.waitFor(
      () => expect(harness.received.filter((x) => x?.type === 'auth').length).toBeGreaterThanOrEqual(2),
      { timeout: 3000 }
    );
    // A successful reconnect resets the attempt counter.
    expect((client as any).reconnectAttempts).toBe(0);
  });

  it('stops scheduling once max reconnection attempts are reached', () => {
    const client = makeClient('ws://127.0.0.1:9');
    (client as any).reconnectAttempts = 10; // == default maxReconnectAttempts
    (client as any).scheduleReconnect();
    expect((client as any).reconnectTimeout).toBeNull();
  });
});
