// End-to-end test: starts the MCP server as an agent's app would, and checks what an agent can and
// cannot do. Needs Docker running and the base pack installed (problemhive-sandbox setup).
//   npm test
import { spawn, spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.js');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'phs-test-'));
const WS = 't' + Math.random().toString(36).slice(2, 8);
const SMALL = WS + '-small';
// A tight budget, so the size limit can be tested without writing gigabytes.
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ cpus: 2, memory_gb: 2, minutes: 5, max_minutes: 5, max_jobs: 2, workspace_gb: 0.02, workspaces_total_gb: 1 }));

let server;
let nextId = 1;
const waiting = new Map();

function rpc(method, params) {
  const id = nextId++;
  server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  return new Promise((resolve) => waiting.set(id, resolve));
}
async function call(name, args = {}) {
  const r = await rpc('tools/call', { name, arguments: args });
  return { text: r.result.content[0].text, isError: r.result.isError };
}

before(async () => {
  server = spawn('node', [CLI, 'mcp'], { env: { ...process.env, PHS_HOME: home }, stdio: ['pipe', 'pipe', 'inherit'] });
  readline.createInterface({ input: server.stdout }).on('line', (line) => {
    const msg = JSON.parse(line);
    waiting.get(msg.id)?.(msg);
    waiting.delete(msg.id);
  });
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
  assert.equal(init.result.serverInfo.name, 'problemhive-sandbox');
  assert.equal(init.result.protocolVersion, '2025-06-18');
});

after(() => {
  server.stdin.end();
  for (const ws of [WS, SMALL]) spawnSync('docker', ['volume', 'rm', `phs-ws-${ws}`]);
  fs.rmSync(home, { recursive: true, force: true });
});

test('lists its tools and describes itself', async () => {
  const list = await rpc('tools/list', {});
  const names = list.result.tools.map((t) => t.name);
  for (const n of ['info', 'find_tool', 'run', 'job_status', 'job_stop', 'write_file', 'read_file', 'list_files', 'delete_file', 'record', 'replay', 'storage', 'list_data']) assert.ok(names.includes(n), n);
  const info = await call('info');
  assert.match(info.text, /base 0\.1\.0 \[installed/);
  assert.match(info.text, /2 cpus, 2 GB memory/);
});

test('finds a tool from a plain description', async () => {
  const r = await call('find_tool', { query: 'check a SAT proof of unsatisfiability' });
  assert.match(r.text.split('\n')[0], /drat-trim|kissat/);
  const none = await call('find_tool', { query: 'zzzqqq' });
  assert.match(none.text, /Nothing matches/);
});

test('writes a script, runs it, reads the result', async () => {
  await call('write_file', { workspace: WS, path: 'src/sum.py', content: 'open("out.txt", "w").write(str(sum(range(101))))\nprint("done")\n' });
  const run = await call('run', { workspace: WS, command: 'python src/sum.py' });
  assert.match(run.text, /^exit 0 in /);
  assert.match(run.text, /done/);
  assert.match(run.text, /--- files written ---\nout\.txt$/);
  // A second run straight after must list only what it wrote itself, not the first run's file.
  const next = await call('run', { workspace: WS, command: 'echo two > second.txt' });
  assert.match(next.text, /--- files written ---\nsecond\.txt$/);
  const read = await call('read_file', { workspace: WS, path: 'out.txt' });
  assert.match(read.text, /5050$/);
  const list = await call('list_files', { workspace: WS });
  assert.match(list.text, /src\/sum\.py/);
});

test('a run has no network, no root, and a read-only system', async () => {
  const r = await call('run', {
    workspace: WS,
    command: 'id -u; (curl -sS -m 5 https://example.org >/dev/null 2>&1 && echo NETWORK || echo no-network); (touch /usr/x 2>/dev/null && echo WRITABLE || echo read-only); (touch /data/x 2>/dev/null && echo DATA-WRITABLE || echo data-read-only); touch /tmp/ok && echo tmp-ok',
  });
  assert.match(r.text, /\n1000\n/);
  assert.match(r.text, /no-network/);
  assert.match(r.text, /read-only\n/);
  assert.match(r.text, /data-read-only/);
  assert.match(r.text, /tmp-ok/);
});

test('paths cannot leave the workspace', async () => {
  for (const p of ['../other', '/etc/passwd', 'a/../../b', '.trash/x', 'a\\b']) {
    const w = await call('write_file', { workspace: WS, path: p, content: 'x' });
    assert.equal(w.isError, true, p);
    const r = await call('read_file', { workspace: WS, path: p });
    assert.equal(r.isError, true, p);
  }
  const bad = await call('run', { workspace: '../x', command: 'true' });
  assert.equal(bad.isError, true);
});

test('delete moves to the trash', async () => {
  await call('write_file', { workspace: WS, path: 'old.txt', content: 'keep me a while' });
  const d = await call('delete_file', { workspace: WS, path: 'old.txt' });
  assert.match(d.text, /Moved old\.txt to \.trash\//);
  const list = await call('list_files', { workspace: WS });
  assert.doesNotMatch(list.text, /old\.txt/);
  const still = await call('run', { workspace: WS, command: 'cat .trash/*/old.txt' });
  assert.match(still.text, /keep me a while/);
});

test('a run record can be replayed and compared', async () => {
  await call('write_file', { workspace: WS, path: 'in.cnf', content: 'p cnf 1 2\n1 0\n-1 0\n' });
  const run = await call('run', { workspace: WS, command: 'kissat -q in.cnf > verdict.txt; date +%N > when.txt; cat verdict.txt' });
  assert.match(run.text, /s UNSATISFIABLE/);
  const id = /job (r[a-z0-9]+)/.exec(run.text)[1];
  const rec = await call('record', { id });
  assert.match(rec.text, /^problemhive-sandbox run record v1/);
  assert.match(rec.text, /[0-9a-f]{64} {2}in\.cnf/);
  const block = rec.text.split('end of record')[0] + 'end of record';
  const again = await call('replay', { workspace: WS, record: block });
  assert.match(again.text, /Inputs match the record \(1 file/);
  assert.match(again.text, /same content: 1 file\(s\) \(verdict\.txt\)/);
  assert.match(again.text, /different content: 1 \(when\.txt\)/);
  // With a changed input, the replay refuses to run.
  await call('write_file', { workspace: WS, path: 'in.cnf', content: 'p cnf 1 1\n1 0\n' });
  const refused = await call('replay', { workspace: WS, record: block });
  assert.match(refused.text, /Not run: the input files here do not match/);
});

test('a long run becomes a job that can be followed and stopped', async () => {
  const run = await call('run', { workspace: WS, command: 'echo started > progress.txt; for i in 1 2 3 4 5 6 7 8 9; do echo tick $i; sleep 20; done', wait_seconds: 3 });
  assert.match(run.text, /^RUNNING/);
  const id = /job (r[a-z0-9]+)/.exec(run.text)[1];
  const status = await call('job_status', { id });
  assert.match(status.text, /tick 1/);
  // A job that writes to a file shows that file, so the agent can see it is alive and where to look.
  assert.match(status.text, /files written so far[^\n]*\n +8 {2}progress\.txt/);
  const stopped = await call('job_stop', { id });
  assert.match(stopped.text, /STOPPED: stopped on request/);
  const jobs = await call('jobs');
  assert.match(jobs.text, new RegExp(`${id}  stopped`));
});

test('a run that fills its workspace past the limit is stopped', { timeout: 120000 }, async () => {
  const run = await call('run', { workspace: SMALL, command: 'head -c 40000000 /dev/zero > big.bin; sleep 100', wait_seconds: 50 });
  assert.match(run.text, /STOPPED: the workspace grew to/);
  const next = await call('run', { workspace: SMALL, command: 'true' });
  assert.equal(next.isError, true);
  assert.match(next.text, /over its limit/);
});

test('runs beyond the limit wait in a queue and start when there is room', { timeout: 120000 }, async () => {
  const idOf = (r) => /job (r[a-z0-9]+)/.exec(r.text)[1];
  const a = await call('run', { workspace: WS, command: 'sleep 100', wait_seconds: 1 });
  const b = await call('run', { workspace: WS, command: 'sleep 100', wait_seconds: 1 });
  const c = await call('run', { workspace: WS, command: 'echo third ran', wait_seconds: 3 });
  assert.match(c.text, /^QUEUED/);
  await call('job_stop', { id: idOf(a) });
  const done = await call('job_status', { id: idOf(c), wait_seconds: 40 });
  assert.match(done.text, /^exit 0 in /);
  assert.match(done.text, /third ran/);
  await call('job_stop', { id: idOf(b) });
});

test('a missing pack is explained, not installed', async () => {
  const r = await call('run', { workspace: WS, command: 'true', pack: 'nonexistent' });
  assert.equal(r.isError, true);
  const g = await call('run', { workspace: WS, command: 'true', gpu: true });
  assert.match(g.text, /owner has not allowed/);
});
