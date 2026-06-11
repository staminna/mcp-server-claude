// Tests for the thin CLI entry (src/index.ts), which has import-time side
// effects: env guard, server creation, and main() startup. The server module
// and stdio transport are mocked; process.exit is recorded but does not throw,
// so each scenario pins which exits and connects happen.
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
  it('exits with code 1 when DIRECTUS_TOKEN is missing', async () => {
    vi.stubEnv('DIRECTUS_TOKEN', '');
    await importEntry();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits with code 1 when the Directus health check fails', async () => {
    vi.stubEnv('DIRECTUS_TOKEN', 'a-real-token');
    mocks.ping.mockResolvedValue(false);
    await importEntry();
    expect(mocks.ping).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits with code 1 when the ping rejects', async () => {
    vi.stubEnv('DIRECTUS_TOKEN', 'a-real-token');
    mocks.ping.mockRejectedValue(new Error('connection refused'));
    await importEntry();
    expect(exitSpy).toHaveBeenCalledWith(1);
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
