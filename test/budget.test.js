// The compute budget: all runs together get a fixed amount of running time per window.
// Needs Docker running and the base pack installed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'phs-budget-'));
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ cpus: 1, memory_gb: 1, compute_minutes: 2, compute_window_hours: 1, max_jobs: 4 }));
process.env.PHS_HOME = home;
const { callTool } = await import('../src/tools.js');
const WS = 'b' + Math.random().toString(36).slice(2, 8);

after(() => {
  spawnSync('docker', ['volume', 'rm', `phs-ws-${WS}`]);
  fs.rmSync(home, { recursive: true, force: true });
});

test('a run is cut to what is left of the budget, and refused when nothing is left', { timeout: 120000 }, async () => {
  const info = await callTool('info', {});
  assert.match(info.text, /may use 2 minutes of running time per 1 hours/);
  // Asks for the default 30 minutes; only 2 are in the budget.
  const first = await callTool('run', { workspace: WS, command: 'sleep 70; echo done', wait_seconds: 2 });
  assert.match(first.text, /time limit was cut to 2 min/);
  // While it runs, its whole limit is reserved, so nothing is left for a second run.
  const second = await callTool('run', { workspace: WS, command: 'echo second' });
  assert.equal(second.isError, true);
  assert.match(second.text, /No computing time is left/);
  const id = /job (r[a-z0-9]+)/.exec(first.text)[1];
  // Once it has ended (stopped here), it counts only what it took, and there is room again.
  await callTool('job_stop', { id });
  const third = await callTool('run', { workspace: WS, command: 'echo third' });
  assert.match(third.text, /^exit 0 in /);
  assert.match(third.text, /third/);
});
