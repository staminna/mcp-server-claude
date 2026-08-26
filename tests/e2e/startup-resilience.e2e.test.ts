// End-to-end startup failure paths: the CLI must exit(1) on missing token or
// unreachable Directus. Raw child_process spawn — no MCP handshake involved.
import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';

const REPO = process.cwd();

interface RunResult {
  code: number | null;
  stderr: string;
}

function runServer(env: Record<string, string>, timeoutMs = 20_000): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const inherited = Object.fromEntries(
      Object.entries(process.env).filter(([, v]) => v !== undefined)
    ) as Record<string, string>;
    const child = spawn(process.execPath, ['dist/index.js'], {
      cwd: REPO,
      env: { ...inherited, LOG_LEVEL: 'ERROR', ...env },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d.toString()));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Server did not exit within ${timeoutMs}ms. stderr:\n${stderr}`));
    }, timeoutMs);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

describe('startup failures', () => {
  it('exits 1 when DIRECTUS_TOKEN is missing', async () => {
    // Empty string masks any token from the repo .env (dotenv never overrides).
    const { code, stderr } = await runServer({ DIRECTUS_TOKEN: '', DIRECTUS_URL: 'http://127.0.0.1:9' });
    expect(code).toBe(1);
    expect(stderr).toContain('DIRECTUS_TOKEN');
  }, 25_000);

  it('exits 1 when Directus is unreachable', async () => {
    const { code, stderr } = await runServer({
      DIRECTUS_TOKEN: 'a-token',
      DIRECTUS_URL: 'http://127.0.0.1:9', // closed port
      DIRECTUS_RETRIES: '1',
      DIRECTUS_RETRY_DELAY: '1',
      DIRECTUS_MAX_RETRY_DELAY: '2',
    });
    expect(code).toBe(1);
    expect(stderr).toContain('Failed to connect to Directus server');
  }, 25_000);
});
