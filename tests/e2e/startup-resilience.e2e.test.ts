// End-to-end startup resilience: the built CLI must come up and answer
// introspection with no credentials, and with Directus unreachable. A registry
// probe (Glama's listing check) runs the server with an empty environment and
// expects the handshake to complete; only tool calls need a token, and they
// report the failure themselves.
//
// This file previously pinned the opposite contract — exit(1) on a missing
// token or a failed health check — which made the server unintrospectable.
import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const REPO = process.cwd();

function inheritedEnv(): Record<string, string> {
  // Filter undefined values out of process.env for the spawn env type.
  return Object.fromEntries(
    Object.entries(process.env).filter(([, v]) => v !== undefined)
  ) as Record<string, string>;
}

// Empty string masks any token from the repo .env (dotenv never overrides).
const NO_TOKEN = { DIRECTUS_TOKEN: '', DIRECTUS_URL: 'http://127.0.0.1:9' };

// A token, but a closed port behind it: the startup health check cannot pass.
const UNREACHABLE = {
  DIRECTUS_TOKEN: 'a-token',
  DIRECTUS_URL: 'http://127.0.0.1:9',
  DIRECTUS_RETRIES: '1',
  DIRECTUS_RETRY_DELAY: '1',
  DIRECTUS_MAX_RETRY_DELAY: '2',
};

async function connect(env: Record<string, string>): Promise<Client> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['dist/index.js'],
    cwd: REPO,
    env: { ...inheritedEnv(), LOG_LEVEL: 'ERROR', ...env },
  });
  const client = new Client({ name: 'startup-e2e', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

describe('startup resilience', () => {
  it('completes the handshake and lists tools with no token configured', async () => {
    const client = await connect(NO_TOKEN);
    try {
      expect(client.getServerVersion()).toMatchObject({
        name: 'directus-mcp-server-enhanced',
      });
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(34);
    } finally {
      await client.close();
    }
  }, 30_000);

  it('completes the handshake when Directus is unreachable', async () => {
    const client = await connect(UNREACHABLE);
    try {
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(34);
    } finally {
      await client.close();
    }
  }, 30_000);

  it('warns about the missing token and keeps running instead of exiting', async () => {
    // stdin must be a pipe, not /dev/null: the stdio transport closes on EOF,
    // which would end the process for reasons unrelated to the token.
    const child = spawn(process.execPath, ['dist/index.js'], {
      cwd: REPO,
      env: { ...inheritedEnv(), LOG_LEVEL: 'WARN', ...NO_TOKEN },
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d.toString()));

    try {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      expect(child.exitCode).toBeNull();
      expect(stderr).toContain('DIRECTUS_TOKEN');
    } finally {
      child.kill('SIGKILL');
    }
  }, 15_000);
});
