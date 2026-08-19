// Unit tests for src/client/https-agent.ts.
//
// Relocated from directus-client.test.ts during the @directus/sdk migration.
// They previously reached into (client as any).axios.defaults.httpsAgent; now
// they exercise the exported factory directly.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHttpsAgent } from '../../src/client/https-agent.js';

const PEM = '-----BEGIN CERTIFICATE-----\nMIIBfake\n-----END CERTIFICATE-----\n';
const KEY = '-----BEGIN PRIVATE KEY-----\nMIIEfake\n-----END PRIVATE KEY-----\n';

describe('createHttpsAgent', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'directus-https-agent-test-'));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('accepts inline PEM strings (existsSync=false branch) plus pfx/passphrase/options', () => {
    const agent = createHttpsAgent({
      ca: PEM,
      cert: PEM,
      key: KEY,
      pfx: 'inline-pfx-content-not-a-path',
      passphrase: 'secret',
      rejectUnauthorized: false,
      servername: 'secure.directus.test',
    });

    expect(agent).toBeDefined();
    expect(agent!.options.rejectUnauthorized).toBe(false);
    expect((agent!.options as any).servername).toBe('secure.directus.test');
    expect(agent!.options.passphrase).toBe('secret');
    expect(agent!.options.ca).toBe(PEM);
  });

  it('loads ca/cert/key/pfx from real file paths (existsSync=true branch)', () => {
    const caPath = path.join(tmpDir, 'ca.pem');
    const certPath = path.join(tmpDir, 'cert.pem');
    const keyPath = path.join(tmpDir, 'key.pem');
    const pfxPath = path.join(tmpDir, 'bundle.pfx');
    fs.writeFileSync(caPath, PEM);
    fs.writeFileSync(certPath, PEM);
    fs.writeFileSync(keyPath, KEY);
    fs.writeFileSync(pfxPath, Buffer.from('pfx-bytes'));

    const agent = createHttpsAgent({ ca: caPath, cert: certPath, key: keyPath, pfx: pfxPath });
    const options = agent!.options as any;

    expect(Buffer.isBuffer(options.ca)).toBe(true);
    expect(options.ca.toString()).toBe(PEM);
    expect(options.cert.toString()).toBe(PEM);
    expect(options.key.toString()).toBe(KEY);
    expect(options.pfx.toString()).toBe('pfx-bytes');
  });

  it('accepts a non-string ca (Buffer branch)', () => {
    const agent = createHttpsAgent({ ca: Buffer.from(PEM) });
    expect(Buffer.isBuffer((agent!.options as any).ca)).toBe(true);
  });

  it('returns null when no https config is given', () => {
    expect(createHttpsAgent(undefined)).toBeNull();
  });
});
