#!/usr/bin/env node
/**
 * Live verification harness: drives every tool the server exposes against a
 * real Directus instance over real stdio.
 *
 *   node tests/live/demo.mjs            # read-only + guard phases
 *   node tests/live/demo.mjs --write    # also create/mutate a scratch collection
 *   node tests/live/demo.mjs --write --apply-schema
 *
 * Reads DIRECTUS_URL / DIRECTUS_TOKEN from the environment. Deliberately kept
 * out of `npm test`: it needs a credential and a reachable instance, so it is a
 * manual gate rather than a CI one.
 *
 * Every mutation is confined to a collection named mcp_demo_<stamp> that this
 * script creates and drops. Cleanup runs even when an earlier phase fails.
 */
import { spawn } from 'node:child_process';
import process from 'node:process';
import { readFileSync } from 'node:fs';

const WRITE = process.argv.includes('--write');
const APPLY_SCHEMA = process.argv.includes('--apply-schema');
const STAMP = process.env.DEMO_STAMP ?? String(Math.floor(Date.now() / 1000));
const SCRATCH = `mcp_demo_${STAMP}`;

// Load an env file directly rather than requiring the caller to source it, so
// credentials never pass through shell history.
const ENV_FILE = process.env.ENV_FILE ?? '.env.mdbaudio';
try {
  const raw = readFileSync(ENV_FILE, 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
} catch {
  // fall through to whatever is already in the environment
}

if (!process.env.DIRECTUS_URL || !process.env.DIRECTUS_TOKEN) {
  console.error(`DIRECTUS_URL and DIRECTUS_TOKEN must be set (tried ${ENV_FILE}).`);
  process.exit(2);
}
console.log(`>> target: ${process.env.DIRECTUS_URL}  (creds from ${ENV_FILE})\n`);

const server = spawn('node', ['dist/index.js'], {
  cwd: process.env.REPO ?? process.cwd(),
  env: { ...process.env },
  stdio: ['pipe', 'pipe', 'pipe'],
});

let stderr = '';
let finished = false;
const pending = new Map();

server.stderr.on('data', (d) => { stderr += d.toString(); });
server.on('exit', (code) => {
  for (const [, resolve] of pending) resolve({ error: { message: `server exited (code ${code})` } });
  pending.clear();
  if (!finished) {
    console.error(`\nSERVER EXITED (code ${code}) before the run finished.\n${stderr.slice(-1200)}`);
    process.exit(2);
  }
});

let buf = '';
server.stdout.on('data', (d) => {
  buf += d.toString();
  let nl;
  while ((nl = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

let nextId = 1;
function rpc(method, params, timeoutMs = 60000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timeout after ${timeoutMs}ms: ${method}`));
    }, timeoutMs);
    pending.set(id, (m) => { clearTimeout(timer); resolve(m); });
    server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}
const notify = (method, params) =>
  server.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');

/** The server wraps each tool's {content:[...]} inside another one; unwrap to text. */
function unwrap(res) {
  if (res.error) return `RPC error: ${res.error.message}`;
  const outer = res.result?.content?.[0]?.text ?? '';
  try {
    const inner = JSON.parse(outer);
    if (inner?.content?.[0]?.text) return String(inner.content[0].text);
  } catch { /* not double-wrapped */ }
  return String(outer);
}

const results = [];
const firstLines = (t, n = 4) => t.split('\n').filter(Boolean).slice(0, n).join('\n');

function record(name, status, detail) {
  results.push({ name, status, detail });
  const tag = { pass: 'PASS', fail: 'FAIL', skip: 'SKIP', refused: 'RFSD' }[status];
  console.log(`[${tag}] ${name}\n       ${detail.replace(/\n/g, '\n       ').slice(0, 600)}`);
}

/**
 * `expect` returns true, or a string explaining the mismatch.
 * A tool answering "the instance refused this" is recorded as `refused`, not
 * `fail` — the point is to separate "our tool is broken" from "this Directus
 * would not do it".
 */
async function call(label, name, args, expect) {
  let res;
  try {
    res = await rpc('tools/call', { name, arguments: args });
  } catch (e) {
    record(label, 'fail', e.message);
    return '';
  }
  const out = unwrap(res);

  // A rejected credential is never a pass, and it makes every later result
  // meaningless — so it is counted separately and aborts the run. Without this
  // an expired token produced a clean sheet of PASSes.
  if (AUTH_FAILURE.test(out)) {
    authFailures++;
    record(label, 'fail', `credential rejected — ${firstLines(out, 1)}`);
    return out;
  }

  // An explicit expectation is the contract and always wins. Guard tests assert
  // that a tool *refuses* — their correct output starts with ❌, which must not
  // be mistaken for a failure.
  if (typeof expect === 'function') {
    const verdict = expect(out);
    if (verdict === true) record(label, 'pass', firstLines(out));
    else record(label, 'fail', `${verdict}\n  got: ${firstLines(out)}`);
    return out;
  }

  // With no expectation, error text is a failure unless the instance declined,
  // which is recorded separately. Previously the default expect() returned true
  // for everything, so any error was silently recorded green.
  const failed = /^(Error|❌)/m.test(out) || /^Error /.test(out.trim());
  const refused = failed &&
    /FORBIDDEN|permission|does not exist|404|not found/i.test(out);

  if (refused) record(label, 'refused', firstLines(out));
  else if (failed) record(label, 'fail', firstLines(out));
  else record(label, 'pass', firstLines(out));
  return out;
}

const has = (needle) => (t) =>
  t.includes(needle) ? true : `expected to contain ${JSON.stringify(needle)}`;

/** Pull the first fenced JSON block out of a tool's markdown answer. */
function fencedJson(text) {
  const m = text.match(/```json\n([\s\S]*?)\n```/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

/** A credential problem on our side, not the instance declining a request. */
const AUTH_FAILURE = /Token expired|Invalid user credentials|INVALID_CREDENTIALS|TOKEN_EXPIRED/i;
let authFailures = 0;

async function main() {
  // ---- protocol ----------------------------------------------------------
  const init = await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'live-harness', version: '1.0.0' },
  });
  record('initialize', init.result?.serverInfo ? 'pass' : 'fail', JSON.stringify(init.result?.serverInfo));
  notify('notifications/initialized', {});

  const tools = (await rpc('tools/list', {})).result?.tools ?? [];
  const ro = tools.filter((t) => t.annotations?.readOnlyHint === true).length;
  const de = tools.filter((t) => t.annotations?.destructiveHint === true).length;
  const ad = tools.filter((t) => t.annotations?.destructiveHint === false && !t.annotations?.readOnlyHint).length;
  record('tools/list', tools.length === 34 ? 'pass' : 'fail',
    `tools=${tools.length} annotated=${tools.filter((t) => t.annotations).length} readOnly=${ro} destructive=${de} additive=${ad}`);

  // ---- local discovery ---------------------------------------------------
  await call('search_tools("schema")', 'search_tools', { query: 'schema' }, has('get_schema_snapshot'));
  await call('search_tools("delete item")', 'search_tools', { query: 'delete item' }, has('delete_items'));
  await call('search_tools(no match)', 'search_tools', { query: 'zzqqxx' }, has('No tools matched'));
  await call('search_tools(limit=2)', 'search_tools', { query: 'flow', limit: 2 },
    (t) => /Found 2 tool\(s\)/.test(t) ? true : 'expected exactly 2 results');

  // ---- read-only ---------------------------------------------------------
  const cols = await call('list_collections', 'list_collections', {});
  const names = [...cols.matchAll(/^[-•]\s*\*\*([a-zA-Z0-9_]+)\*\*/gm)].map((m) => m[1]);
  const probe = names.find((n) => !n.startsWith('directus_'));
  console.log(`\n   >> ${names.length} collection(s) visible; probe target: ${probe ?? '(none)'}\n`);

  if (probe) {
    await call('get_collection_schema', 'get_collection_schema', { collection: probe });
    await call('get_collection_items', 'get_collection_items', { collection: probe, limit: 3 });
    await call('get_collection_items(version=published)', 'get_collection_items',
      { collection: probe, limit: 2, version: 'published' });
    await call('analyze_collection_schema', 'analyze_collection_schema',
      { collection: probe, includeRelations: true });
    await call('analyze_relationships', 'analyze_relationships', { collection: probe });
    await call('validate_collection_schema', 'validate_collection_schema', { collection: probe });
    await call('diagnose_collection_access', 'diagnose_collection_access', { collection: probe });
  } else {
    for (const n of ['get_collection_schema', 'get_collection_items', 'analyze_collection_schema',
      'analyze_relationships', 'validate_collection_schema', 'diagnose_collection_access']) {
      record(n, 'skip', 'no non-system collection visible');
    }
  }

  if (authFailures > 0) {
    throw new Error(
      `credential rejected by ${process.env.DIRECTUS_URL} — every later result would be meaningless. ` +
      'Mint a fresh token and re-run.'
    );
  }

  await call('validate_collection_creation', 'validate_collection_creation',
    { collection: probe ?? 'directus_users', waitTime: 500 });

  const users = await call('get_users', 'get_users', { limit: 3 });
  // Match the labelled ID; the first bare UUID on the line is the role, not the user.
  const uid = users.match(new RegExp(`ID:\\s*(${UUID.source})`))?.[1];
  if (uid) await call('get_user', 'get_user', { id: uid });
  else record('get_user', 'skip', 'get_users output exposed no user id');

  await call('get_files', 'get_files', { limit: 3 });
  const flows = await call('get_flows', 'get_flows', {});
  const fid = flows.match(UUID)?.[0];
  if (fid) {
    await call('get_flow', 'get_flow', { id: fid });
    await call('get_operations', 'get_operations', { flow_id: fid });
  } else {
    record('get_flow', 'skip', 'no flow exists on this instance');
    await call('get_operations', 'get_operations', {});
  }

  await call('refresh_collection_cache', 'refresh_collection_cache', {});

  // ---- schema read -------------------------------------------------------
  const snapText = await call('get_schema_snapshot', 'get_schema_snapshot', {});
  const fullSnap = fencedJson(snapText);
  await call('get_schema_snapshot(include)', 'get_schema_snapshot',
    probe ? { include_collections: [probe] } : {});
  await call('get_schema_snapshot(include+exclude rejected)', 'get_schema_snapshot',
    { include_collections: ['a'], exclude_collections: ['b'] }, has('mutually exclusive'));

  if (fullSnap) {
    await call('diff_schema(self, mirror)', 'diff_schema', { snapshot: fullSnap, mode: 'mirror' });
    await call('diff_schema(self, merge)', 'diff_schema', { snapshot: fullSnap, mode: 'merge' });
  } else {
    for (const n of ['diff_schema(self, mirror)', 'diff_schema(self, merge)']) {
      record(n, 'skip', 'no snapshot returned to diff against');
    }
  }

  // ---- guards: must issue no destructive HTTP ----------------------------
  const before = stderr.length;

  await call('delete_items(ids: []) no-op', 'delete_items',
    { collection: probe ?? 'x', ids: [], confirm: true }, has('no request was sent'));
  await call('delete_items(ids+query rejected)', 'delete_items',
    { collection: probe ?? 'x', ids: ['1'], query: { limit: 1 }, confirm: true }, has('not both'));
  await call('delete_items(unconfirmed refused)', 'delete_items',
    { collection: probe ?? 'x', ids: ['1'] }, has('confirm: true'));
  await call('bulk_operations(empty) no-op', 'bulk_operations',
    { collection: probe ?? 'x', operations: {} }, has('no request was sent'));
  await call('update_item(version=published refused)', 'update_item',
    { collection: probe ?? 'x', id: '1', data: { a: 1 }, version: 'published' }, has('read-only'));
  await call('apply_schema(unconfirmed refused)', 'apply_schema',
    { diff: { hash: 'x', diff: {} } }, has('Warning'));

  const wire = [...stderr.slice(before).matchAll(/"method":"(GET|POST|PATCH|DELETE)","url":"([^"]+)"/g)]
    .map((m) => `${m[1]} ${m[2]}`);
  const destructive = wire.filter((c) => /^(DELETE|PATCH)/.test(c));
  record('guards issue no destructive HTTP', destructive.length === 0 ? 'pass' : 'fail',
    destructive.length === 0
      ? `0 DELETE/PATCH across 6 guard calls (any wire calls: ${wire.length || 'none'})`
      : `expected none, saw: ${destructive.join(', ')}`);

  // ---- writes ------------------------------------------------------------
  const WRITE_TOOLS = ['create_collection', 'create_field', 'update_field', 'create_item',
    'update_item', 'bulk_operations(real)', 'import_data', 'delete_items(real)',
    'create_relationship', 'delete_field', 'create_flow', 'update_flow', 'trigger_flow',
    'delete_flow', 'delete_collection'];

  if (!WRITE) {
    for (const n of WRITE_TOOLS) record(n, 'skip', 'write phase off (pass --write)');
    record('apply_schema(real)', 'skip', 'write phase off');
    return;
  }

  await call('create_collection', 'create_collection',
    { collection: SCRATCH, meta: { note: 'temporary MCP live-test collection' } });
  await call('create_field', 'create_field', { collection: SCRATCH, field: 'title', type: 'string' });
  await call('update_field', 'update_field',
    { collection: SCRATCH, field: 'title', meta: { note: 'demo field' } });

  const created = await call('create_item', 'create_item', { collection: SCRATCH, data: { title: 'hello' } });
  const itemId = created.match(/"id":\s*"?([A-Za-z0-9-]+)"?/)?.[1];

  if (itemId) {
    await call('update_item', 'update_item',
      { collection: SCRATCH, id: itemId, data: { title: 'hello (edited)' } });
    await call('update_item(empty data no-op)', 'update_item',
      { collection: SCRATCH, id: itemId, data: {} }, has('no request was sent'));
  } else {
    record('update_item', 'skip', 'create_item returned no id');
  }

  await call('bulk_operations(real)', 'bulk_operations',
    { collection: SCRATCH, operations: { create: [{ title: 'bulk-a' }, { title: 'bulk-b' }] } });
  await call('import_data', 'import_data',
    { collection: SCRATCH, file_data: Buffer.from(JSON.stringify([{ title: 'imported' }])).toString('base64'),
      filename: 'rows.json' });

  if (itemId) {
    await call('delete_items(real)', 'delete_items', { collection: SCRATCH, ids: [itemId], confirm: true });
  } else {
    record('delete_items(real)', 'skip', 'no item id');
  }

  await call('create_relationship', 'create_relationship',
    { type: 'm2o', collection: SCRATCH, field: 'owner', related_collection: 'directus_users' });
  await call('delete_field', 'delete_field', { collection: SCRATCH, field: 'title', confirm: true });

  const flow = await call('create_flow', 'create_flow',
    { name: `MCP Live Demo ${STAMP}`, trigger: 'webhook', status: 'inactive' });
  const newFlow = flow.match(UUID)?.[0];
  if (newFlow) {
    await call('update_flow', 'update_flow', { id: newFlow, data: { description: 'updated by live harness' } });
    await call('trigger_flow', 'trigger_flow', { id: newFlow, data: {} });
    await call('delete_flow', 'delete_flow', { id: newFlow, confirm: true });
  } else {
    for (const n of ['update_flow', 'trigger_flow', 'delete_flow']) record(n, 'skip', 'flow not created');
  }

  // ---- apply_schema, confined to the scratch collection ------------------
  if (!APPLY_SCHEMA) {
    record('apply_schema(real)', 'skip', 'pass --apply-schema to run it');
  } else {
    // Snapshot only the scratch collection, drop it, then diff in MERGE mode.
    // merge produces a strictly additive diff, so applying it can only
    // re-create what we made — it cannot drop anything that already existed.
    const partial = fencedJson(await call('get_schema_snapshot(scratch only)', 'get_schema_snapshot',
      { include_collections: [SCRATCH] }));

    await call('delete_collection(pre-apply)', 'delete_collection', { collection: SCRATCH, confirm: true });

    if (partial) {
      const diffText = await call('diff_schema(scratch, merge)', 'diff_schema',
        { snapshot: partial, mode: 'merge' });
      const diff = fencedJson(diffText);
      if (diff) {
        await call('apply_schema(real, additive)', 'apply_schema', { diff, confirm: true });
        await call('verify scratch re-created', 'get_collection_schema', { collection: SCRATCH },
          has(SCRATCH));
      } else {
        record('apply_schema(real, additive)', 'skip', 'diff_schema returned no applicable diff');
      }
    } else {
      record('apply_schema(real, additive)', 'skip', 'partial snapshot unavailable');
    }
  }
}

async function cleanup() {
  if (!WRITE) return;
  console.log('\n--- cleanup ---');
  const out = await call('delete_collection', 'delete_collection', { collection: SCRATCH, confirm: true });
  if (/error/i.test(out) && !/does not exist|not found/i.test(out)) {
    console.log(`   !! scratch collection ${SCRATCH} may still exist — check manually`);
  }
  const left = await call('verify no leftovers', 'list_collections', {},
    (t) => t.includes(SCRATCH) ? `${SCRATCH} still present` : true);
  if (!left.includes(SCRATCH)) console.log(`   >> ${SCRATCH} removed`);
}

let exitCode = 0;
try {
  await main();
} catch (e) {
  console.error('\nHARNESS ERROR:', e.message);
  exitCode = 2;
} finally {
  try { await cleanup(); } catch (e) { console.error('cleanup failed:', e.message); }

  const by = (s) => results.filter((r) => r.status === s).length;
  console.log(`\n${'='.repeat(64)}`);
  console.log(`SUMMARY  pass=${by('pass')}  refused-by-instance=${by('refused')}  fail=${by('fail')}  skip=${by('skip')}  total=${results.length}`);
  if (authFailures > 0) {
    console.log(`\n⚠️  ${authFailures} call(s) failed on the credential itself — this run proves nothing about the instance.`);
  }
  if (by('fail')) {
    console.log('\nFAILURES:');
    for (const r of results.filter((r) => r.status === 'fail')) {
      console.log(`  - ${r.name}: ${firstLines(r.detail, 2)}`);
    }
  }
  if (by('refused')) {
    console.log('\nREFUSED BY INSTANCE (not a server defect):');
    for (const r of results.filter((r) => r.status === 'refused')) {
      console.log(`  - ${r.name}: ${firstLines(r.detail, 1)}`);
    }
  }
  finished = true;
  server.kill();
  process.exit(exitCode || (by('fail') ? 1 : 0));
}
