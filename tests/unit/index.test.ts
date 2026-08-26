// Tests for the thin CLI entry (src/index.ts), which has import-time side
// effects: config load, server creation, and main() startup. The server module
// and stdio transport are mocked; process.exit is recorded but does not throw,
// so each scenario pins which exits and connects happen.
//
// The contract these pin: startup never gates on credentials or on Directus
// being reachable. A client — or a registry probe such as Glama's, which runs
// the container with no environment at all — must be able to complete the
// initialize/tools-list handshake regardless; only tool calls need a token.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => {
  return {
    ping: vi.fn(),
    connect: vi.fn(),
    loadConfigFromEnv: vi.fn(),
    createServer: vi.fn(),
    transportCtor: vi.fn(),
  };
});

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: mocks.transportCtor,
}));

vi.mock('../../src/server.js', () => ({
  loadConfigFromEnv: mocks.loadConfigFromEnv,
  createServer: mocks.createServer,
}));

let exitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.resetModules();
  mocks.ping.mockReset();
  mocks.connect.mockReset().mockResolvedValue(undefined);
  // Must be constructible: index.ts calls `new StdioServerTransport()`.
  mocks.transportCtor.mockReset().mockImplementation(function () {
    return { kind: 'fake-transport' };
  });
  mocks.loadConfigFromEnv.mockReset().mockImplementation(() => ({
    url: 'http://directus.test',
    token: process.env.DIRECTUS_TOKEN || '',
  }));
  mocks.createServer.mockReset().mockImplementation(() => ({
    server: { connect: mocks.connect },
    deps: { directusClient: { ping: mocks.ping } },
  }));
  exitSpy = vi.spyOn(process, 'exit').mockReturnValue(undefined as never);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function importEntry(): Promise<void> {
  await import('../../src/index.js');
  // main() runs async at import time; flush its microtasks/timers.
  await new Promise((resolve) => setTimeout(resolve, 20));
}

describe('CLI entry startup', () => {
  it('serves over stdio when DIRECTUS_TOKEN is missing', async () => {
    vi.stubEnv('DIRECTUS_TOKEN', '');
    await importEntry();
    expect(mocks.connect).toHaveBeenCalledWith({ kind: 'fake-transport' });
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('skips the health check when there is no token to check with', async () => {
    vi.stubEnv('DIRECTUS_TOKEN', '');
    await importEntry();
    expect(mocks.ping).not.toHaveBeenCalled();
  });

  it('keeps serving when the Directus health check fails', async () => {
    vi.stubEnv('DIRECTUS_TOKEN', 'a-real-token');
    mocks.ping.mockResolvedValue(false);
    await importEntry();
    expect(mocks.ping).toHaveBeenCalled();
    expect(mocks.connect).toHaveBeenCalledWith({ kind: 'fake-transport' });
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('keeps serving when the ping rejects', async () => {
    vi.stubEnv('DIRECTUS_TOKEN', 'a-real-token');
    mocks.ping.mockRejectedValue(new Error('connection refused'));
    await importEntry();
    expect(mocks.connect).toHaveBeenCalledWith({ kind: 'fake-transport' });
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('connects the transport before pinging, so introspection never waits on the network', async () => {
    vi.stubEnv('DIRECTUS_TOKEN', 'a-real-token');
    mocks.ping.mockResolvedValue(true);
    await importEntry();
    expect(mocks.connect.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.ping.mock.invocationCallOrder[0]!
    );
  });

  it('connects the stdio transport when the health check passes', async () => {
    vi.stubEnv('DIRECTUS_TOKEN', 'a-real-token');
    mocks.ping.mockResolvedValue(true);
    await importEntry();
    expect(mocks.createServer).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'a-real-token' })
    );
    expect(mocks.transportCtor).toHaveBeenCalledTimes(1);
    expect(mocks.connect).toHaveBeenCalledWith({ kind: 'fake-transport' });
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
