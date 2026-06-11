// Constructor-injectable stub for DirectusClient. Tool classes only call a
// subset of methods, but the full public surface is stubbed so any suite can
// use it. file-tools' getFileUrl reaches into client['config'].url, so the
// stub carries a config object too.
import { vi, type Mock } from 'vitest';
import type { DirectusClient } from '../../src/client/directus-client.js';
import { envelope } from './fixtures.js';

// Typed as DirectusClient plus Mock methods. The runtime object also carries a
// public config:{url} (file-tools reads client['config'].url), but config is
// deliberately NOT in this type: DirectusClient declares it private, and
// redeclaring it publicly would collapse the intersection to `never`.
export type StubbedClient = DirectusClient & Record<StubMethod, Mock>;
export type ClientStub = StubbedClient;

const METHODS = [
  'get',
  'post',
  'patch',
  'delete',
  'getCollections',
  'getCollection',
  'createCollection',
  'updateCollection',
  'deleteCollection',
  'getItems',
  'getItem',
  'createItem',
  'createItems',
  'updateItem',
  'updateItems',
  'deleteItem',
  'deleteItems',
  'bulkOperation',
  'uploadFile',
  'getFiles',
  'deleteFile',
  'getUsers',
  'getUser',
  'createUser',
  'updateUser',
  'deleteUser',
  'getRoles',
  'getRole',
  'createRole',
  'getFlows',
  'triggerFlow',
  'getFields',
  'createField',
  'updateField',
  'deleteField',
  'getRelations',
  'createRelation',
  'deleteRelation',
  'getPermissions',
  'createPermission',
  'ping',
  'getServerInfo',
] as const;

export type StubMethod = (typeof METHODS)[number];

/**
 * Create a DirectusClient stub. Every method is a vi.fn() resolving to an
 * empty Directus envelope by default; override per test with
 * stub.getItems.mockResolvedValue(envelope([...])).
 */
export function makeClientStub(overrides: Partial<Record<StubMethod, Mock>> = {}): StubbedClient {
  const stub: Record<string, unknown> = {
    config: { url: 'http://directus.test' },
  };
  for (const method of METHODS) {
    stub[method] = overrides[method] ?? vi.fn().mockResolvedValue(envelope([]));
  }
  return stub as unknown as StubbedClient;
}
