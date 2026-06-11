import { describe, it, expect, vi, afterEach } from 'vitest';
import * as lib from '../../src/lib.js';
import DefaultExport, { DirectusMCPServer } from '../../src/lib.js';
import { DirectusClient } from '../../src/client/directus-client.js';

const config = { url: 'http://directus.test', token: 'lib-token' };

afterEach(() => vi.restoreAllMocks());

describe('DirectusMCPServer wrapper', () => {
  it('constructs a client and all six tool groups', () => {
    const server = new DirectusMCPServer(config);
    expect(server.getClient()).toBeInstanceOf(DirectusClient);
    expect(Object.keys(server.getTools()).sort()).toEqual(
      ['collection', 'diagnostic', 'file', 'flow', 'schema', 'user'].sort()
    );
  });

  it('returns stable client and tool instances', () => {
    const server = new DirectusMCPServer(config);
    expect(server.getClient()).toBe(server.getClient());
    expect(server.getTools()).toBe(server.getTools());
  });

  it('ping() delegates to the Directus client', async () => {
    const spy = vi.spyOn(DirectusClient.prototype, 'ping').mockResolvedValue(true);
    const server = new DirectusMCPServer(config);
    await expect(server.ping()).resolves.toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('is also the default export', () => {
    expect(DefaultExport).toBe(DirectusMCPServer);
  });
});

describe('library export surface', () => {
  it.each([
    'DirectusClient',
    'DirectusWebSocketClient',
    'CollectionTools',
    'UserTools',
    'FileTools',
    'FlowTools',
    'SchemaTools',
    'DiagnosticTools',
    'logger',
    'Logger',
    'loadConfigFromEnv',
    'createDeps',
    'createHandlers',
    'createServer',
    'TOOL_DEFINITIONS',
    'Server',
    'StdioServerTransport',
    'CallToolRequestSchema',
    'ListToolsRequestSchema',
    'ListPromptsRequestSchema',
    'GetPromptRequestSchema',
    'DirectusMCPServer',
  ] as const)('exports %s', (name) => {
    expect((lib as Record<string, unknown>)[name]).toBeDefined();
  });
});
