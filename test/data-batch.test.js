// Data requests and batch runs, through the tools as an agent calls them.
// Needs Docker running, the base pack installed, and network access (it downloads one small page).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'phs-data-'));
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ cpus: 2, memory_gb: 2, max_jobs: 4, compute_minutes: 30, data_sources: ['example.org'], data_requests_per_hour: 2 }));
process.env.PHS_HOME = home;
const { callTool } = await import('../src/tools.js');
const { parsePlan, batchCommand } = await import('../src/batch.js');
const WS = 'd' + Math.random().toString(36).slice(2, 8);
const NAME = `test-${WS}/page.html`;

after(() => {
  spawnSync('docker', ['volume', 'rm', `phs-ws-${WS}`]);
  spawnSync('node', [path.resolve('src/cli.js'), 'data', 'rm', `test-${WS}`], { env: { ...process.env, PHS_HOME: home } });
  fs.rmSync(home, { recursive: true, force: true });
});

test('the agent can download from an approved source, and only from one', { timeout: 120000 }, async () => {
  const no = await callTool('request_data', { url: 'https://www.wikipedia.org/', name: NAME, why: 'A test of a host that is not approved.' });
  assert.match(no.text, /Not downloaded: www\.wikipedia\.org is not among the sources/);
  const http = await callTool('request_data', { url: 'http://example.org/', name: NAME, why: 'A test of a plain http address.' });
  assert.equal(http.isError, true);
  const vague = await callTool('request_data', { url: 'https://example.org/', name: NAME, why: 'x' });
  assert.equal(vague.isError, true);
  const escape = await callTool('request_data', { url: 'https://example.org/', name: '../outside.html', why: 'A test of a path that leaves the data area.' });
  assert.equal(escape.isError, true);

  const ok = await callTool('request_data', { url: 'https://example.org/', name: NAME, why: 'A small public page, to test downloading.' });
  assert.match(ok.text, new RegExp(`Saved as /data/${NAME} \\(.*sha256 [0-9a-f]{64}\\)`));
  const list = await callTool('list_data', {});
  assert.match(list.text, new RegExp(`/data/${NAME}`));
  assert.match(list.text, /request_data, from: example\.org/);
  // A subdomain of an approved host counts; the run reads the file but cannot change it.
  const sub = await callTool('request_data', { url: 'https://www.example.org/', name: NAME + '2', why: 'A subdomain of the approved host, second of two allowed.' });
  assert.match(sub.text, /Saved as/);
  const run = await callTool('run', { workspace: WS, command: `grep -c "Example Domain" /data/${NAME}; (echo x >> /data/${NAME}) 2>/dev/null && echo CHANGED || echo read-only` });
  assert.match(run.text, /read-only/);
  assert.doesNotMatch(run.text, /CHANGED/);
  // The owner's limit on requests per hour.
  const third = await callTool('request_data', { url: 'https://example.org/', name: NAME + '3', why: 'One more than the limit of two per hour.' });
  assert.equal(third.isError, true);
  assert.match(third.text, /asked for 2 downloads in the last hour/);
});

test('a plan file is checked strictly', () => {
  const good = { command: 'python s.py {from} {to} {batch}', batches: { B01: { from: 1, to: 5 }, B02: { from: 6, to: 9 } } };
  assert.equal(batchCommand(parsePlan(JSON.stringify(good)), 'B02'), 'python s.py 6 9 B02');
  const bad = [
    { ...good, batches: { B01: { from: '1; rm -rf x', to: 5 } } },
    { ...good, batches: { 'B 01': { from: 1, to: 5 } } },
    { ...good, batches: { B01: { from: 1 } } },
    { ...good, command: '' },
    { ...good, batches: {} },
    { ...good, control: { command: 'true' } },
  ];
  for (const p of bad) assert.throws(() => parsePlan(JSON.stringify(p)), /./, JSON.stringify(p));
  assert.throws(() => parsePlan('not json'));
});

test('a batch runs only after its control case passes, and its record names the batch', { timeout: 180000 }, async () => {
  await callTool('write_file', { workspace: WS, path: 'count.py', content: 'import sys\na, b = int(sys.argv[1]), int(sys.argv[2])\nprint("primes", sum(1 for n in range(a, b + 1) if n > 1 and all(n % d for d in range(2, int(n ** 0.5) + 1))))\n' });
  const plan = { plan: 'c/abc123', pack: 'base', minutes: 2, files: ['count.py'], control: { command: 'python count.py 1 10', expect: 'primes 4' }, command: 'python count.py {from} {to}', batches: { B01: { from: 1, to: 100 }, B02: { from: 101, to: 200 } } };
  await callTool('write_file', { workspace: WS, path: 'plan.json', content: JSON.stringify(plan) });

  const check = await callTool('run_batch', { workspace: WS });
  assert.match(check.text, /2 batches, pack base/);
  assert.match(check.text, /Control passed/);
  assert.match(check.text, /B02 {2}python count\.py 101 200/);

  const run = await callTool('run_batch', { workspace: WS, batch: 'B02' });
  assert.match(run.text, /Control passed/);
  assert.match(run.text, /primes 21/);
  const id = /job (r[a-z0-9]+), pack/.exec(run.text.split('Batch B02')[1])[1];
  const rec = await callTool('record', { id });
  assert.match(rec.text, /^batch: B02 of plan c\/abc123$/m);
  assert.match(rec.text, /[0-9a-f]{64} {2}plan\.json/);
  assert.match(rec.text, /[0-9a-f]{64} {2}count\.py/);

  const none = await callTool('run_batch', { workspace: WS, batch: 'B09' });
  assert.equal(none.isError, true);

  // With a control that gives the wrong answer, the batch is not run.
  await callTool('write_file', { workspace: WS, path: 'plan.json', content: JSON.stringify({ ...plan, control: { command: 'python count.py 1 10', expect: 'primes 5' } }) });
  const failed = await callTool('run_batch', { workspace: WS, batch: 'B01' });
  assert.match(failed.text, /CONTROL FAILED/);
  assert.match(failed.text, /The batch was not run/);
  assert.doesNotMatch(failed.text, /primes 25/);
});
