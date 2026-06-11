// Local WebSocket server harness for DirectusWebSocketClient tests.
// Speaks just enough of the Directus realtime protocol: auth handshake,
// subscribe acks, ping/pong, and arbitrary pushed events.
import { WebSocketServer, WebSocket } from 'ws';

export interface WsHarness {
  url: string;
  wss: WebSocketServer;
  /** Messages received from the client, parsed. */
  received: any[];
  /** Currently connected sockets. */
  sockets: Set<WebSocket>;
  /** Send a payload to every connected client. */
  broadcast(payload: unknown): void;
  /** Wait until a received message matches the predicate. */
  waitForMessage(predicate: (msg: any) => boolean, timeoutMs?: number): Promise<any>;
  close(): Promise<void>;
}

export interface WsHarnessOptions {
  /** Respond to {type:'auth'} with ok (default true) or an error status. */
  acceptAuth?: boolean;
  /** Automatically respond to ping messages (default false: tests assert pongs). */
  autoRespond?: boolean;
}

export async function startWsHarness(options: WsHarnessOptions = {}): Promise<WsHarness> {
  const { acceptAuth = true } = options;
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve) => wss.once('listening', resolve));
  const address = wss.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Failed to bind WebSocket harness to an ephemeral port');
  }

  const received: any[] = [];
  const sockets = new Set<WebSocket>();
  const waiters: Array<{ predicate: (msg: any) => boolean; resolve: (msg: any) => void }> = [];

  wss.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('message', (raw) => {
      let msg: any;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        msg = raw.toString();
      }
      received.push(msg);

      if (msg?.type === 'auth') {
        socket.send(
          JSON.stringify(
            acceptAuth
              ? { type: 'auth', data: { status: 'ok' } }
              : { type: 'auth', data: { status: 'error', error: 'invalid token' } }
          )
        );
      }

      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].predicate(msg)) {
          waiters[i].resolve(msg);
          waiters.splice(i, 1);
        }
      }
    });
  });

  return {
    url: `ws://127.0.0.1:${address.port}`,
    wss,
    received,
    sockets,
    broadcast(payload: unknown) {
      const text = JSON.stringify(payload);
      for (const socket of sockets) socket.send(text);
    },
    waitForMessage(predicate, timeoutMs = 5000) {
      const existing = received.find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Timed out waiting for WebSocket message')),
          timeoutMs
        );
        waiters.push({
          predicate,
          resolve: (msg) => {
            clearTimeout(timer);
            resolve(msg);
          },
        });
      });
    },
    close() {
      for (const socket of sockets) socket.terminate();
      return new Promise<void>((resolve, reject) =>
        wss.close((err) => (err ? reject(err) : resolve()))
      );
    },
  };
}
