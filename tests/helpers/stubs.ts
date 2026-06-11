// Constructor-injectable stub for DirectusClient. Tool classes only call a
// subset of methods, but the full public surface is stubbed so any suite can
// use it. file-tools' getFileUrl reaches into client['config'].url, so the
// stub carries a config object too.
import { vi, type Mock } from 'vitest';
import type { DirectusClient } from '../../src/client/directus-client.js';
import { envelope } from './fixtures.js';

export type ClientStub = {
  config: { url: string };
  [method: string]: any;
};

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
export function makeClientStub(overrides: Partial<Record<StubMethod, Mock>> = {}): ClientStub & DirectusClient {
  const stub: ClientStub = {
    config: { url: 'http://directus.test' },
  };
  for (const method of METHODS) {
    stub[method] = overrides[method] ?? vi.fn().mockResolvedValue(envelope([]));
  }
  return stub as ClientStub & DirectusClient;
}
