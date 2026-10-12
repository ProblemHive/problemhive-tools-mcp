// Runs. Each run is one container that is thrown away afterwards: no network, a read-only system,
// the workspace at /work and the data area read-only at /data, with the owner's limits on
// processors, memory and time. A run that outlasts the caller's patience keeps going as a job that
// can be followed and stopped. Every run leaves a record: what ran, on which image, and checksums
// of the files it read and wrote, so that someone else can run exactly the same thing again.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { HOME, JOBS, RUN_LOG, readJson, writeJson, gb } from './config.js';
import { docker, LOCKED } from './docker.js';
import { getPack, installed } from './packs.js';
import { DATA_VOLUME, UserError, checkName, ensureData, ensureWorkspace, hashChangedSince, hashFiles, noteWorkspaceSize, workspaceSource } from './storage.js';

const jobFile = (id) => path.join(JOBS, `${id}.json`);
const logFile = (id) => path.join(JOBS, `${id}.log`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Math.floor(Date.now() / 1000);

export const loadJob = (id) => (/^r[a-z0-9]{6,20}$/.test(String(id)) ? readJson(jobFile(id), null) : null);
const saveJob = (job) => writeJson(jobFile(job.id), job);

export function listJobs(limit = 30) {
  return fs
    .readdirSync(JOBS)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJson(path.join(JOBS, f), null))
    .filter(Boolean)
    .sort((a, b) => b.created - a.created)
    .slice(0, limit);
}

// Runs are counted per settings folder, so a second installation (or the test suite) does not take
// the first one's slots.
const HOME_ID = crypto.createHash('sha1').update(HOME).digest('hex').slice(0, 12);

async function runningCount() {
  const r = await docker(['ps', '--filter', `label=phs.home=${HOME_ID}`, '--format', '{{.Names}}']);
  return r.out.toString().split('\n').filter(Boolean).length;
}

/**
 * How much of the owner's compute budget is used: the running time of every run that started within
 * the window. A run that has ended counts what it took; one that is running or queued counts its
 * whole time limit, so that runs side by side cannot overshoot together.
 */
export function computeBudget(cfg) {
  const windowSeconds = cfg.compute_window_hours * 3600;
  const since = now() - windowSeconds;
  let used = 0;
  let oldest = null;
  for (const f of fs.readdirSync(JOBS)) {
    if (!f.endsWith('.json')) continue;
    const j = readJson(path.join(JOBS, f), null);
    if (!j || j.exempt || j.created < since) continue;
    const seconds = j.status === 'running' || j.status === 'queued' ? j.minutes * 60 : j.seconds ?? 0;
    if (seconds > 0) {
      used += seconds;
      oldest = oldest === null ? j.created : Math.min(oldest, j.created);
    }
  }
  const total = cfg.compute_minutes * 60;
  return { used: Math.round(used), left: Math.max(0, Math.round(total - used)), total, frees_at: oldest === null ? null : oldest + windowSeconds };
}

/** Words in a command that could be files the run reads: checked for existence and hashed before it starts. */
function candidateInputs(command) {
  const seen = new Set();
  for (const raw of command.split(/[\s'"=<>|;&()]+/)) {
    const t = raw.replace(/^\.\//, '');
    if (!t || t.length > 200 || t.startsWith('-') || !/^[A-Za-z0-9_./@+-]+$/.test(t) || t.includes('..')) continue;
    if (t.startsWith('/') && !t.startsWith('/data/')) continue;
    seen.add(t);
  }
  return [...seen].slice(0, 60);
}

/**
 * Start a run. Returns the job, which may be queued if the owner's limit on simultaneous runs is reached.
 * `opts`: { workspace, command, pack, minutes, gpu, inputs, replayOf, cpus, memoryGb }.
 */
export async function startJob(cfg, opts) {
  const workspace = checkName(opts.workspace);
  const command = String(opts.command ?? '').trim();
  if (!command) throw new UserError('Give the command to run, as you would type it in a shell inside the workspace.');
  if (command.length > 20000) throw new UserError('The command is too long. Put the work in a script file with write_file and run that.');
  const pack = getPack(opts.pack || 'base');
  if (!pack) throw new UserError(`There is no pack called "${opts.pack}". Use the info tool to see the packs.`);
  const image = await installed(pack);
  if (!image) throw new UserError(`The "${pack.name}" pack is not installed on this machine. Only the owner can install it: ask your user to run  problemhive-sandbox install ${pack.name}  (about ${pack.size_estimate_gb} GB).`);
  let minutes = Math.min(cfg.max_minutes, Math.max(1, Math.round(Number(opts.minutes) || cfg.minutes)));
  let note;
  if (!opts.exempt) {
    const b = computeBudget(cfg);
    if (b.left < 60) {
      const when = new Date(b.frees_at * 1000);
      throw new UserError(`No computing time is left: the owner allows ${cfg.compute_minutes} minutes of running time per ${cfg.compute_window_hours} hours for all runs together, and ${Math.round(b.used / 60)} are used or reserved. Time comes back from ${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')} (local time) on. Do not look for a way around this. Write up what you have, say exactly where the work stopped and how to continue it, and leave the rest for a later run or another agent.`);
    }
    if (minutes * 60 > b.left) {
      minutes = Math.floor(b.left / 60);
      note = `This run's time limit was cut to ${minutes} min: that is all that is left of the owner's budget of ${cfg.compute_minutes} minutes of running time per ${cfg.compute_window_hours} hours.`;
    }
  }
  const gpu = Boolean(opts.gpu);
  if (gpu && !cfg.gpu) throw new UserError('The owner has not allowed runs to use the GPU ("gpu" in the config file).');

  await ensureData();
  await ensureWorkspace(cfg, workspace);
  const known = readJson(path.join(JOBS, '..', 'workspaces.json'), {});
  const used = known[workspace]?.bytes ?? 0;
  if (used > cfg.workspace_gb * 2 ** 30) {
    throw new UserError(`The workspace "${workspace}" holds ${gb(used)}, over its limit of ${cfg.workspace_gb} GB. Delete files you no longer need (delete_file moves them to the trash; the owner's "clean" command empties it), then try again.`);
  }
  const total = Object.values(known).reduce((n, w) => n + (w.bytes ?? 0), 0);
  if (total > cfg.workspaces_total_gb * 2 ** 30) {
    throw new UserError(`All workspaces together hold ${gb(total)}, over the limit of ${cfg.workspaces_total_gb} GB. The owner can see what uses the space with  problemhive-sandbox storage  and free it with  problemhive-sandbox clean.`);
  }

  const id = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const inputs = await hashFiles(cfg, workspace, [...new Set([...(opts.inputs ?? []).map(String), ...candidateInputs(command)])]);
  const job = {
    id,
    workspace,
    pack: pack.name,
    pack_version: pack.version,
    image: pack.image,
    image_id: image.id,
    command,
    minutes,
    gpu,
    cpus: opts.cpus ?? cfg.cpus,
    memory_gb: opts.memoryGb ?? cfg.memory_gb,
    created: now(),
    status: 'queued',
    inputs,
    replay_of: opts.replayOf ?? null,
    ...(note ? { note } : {}),
    ...(opts.exempt ? { exempt: true } : {}),
  };
  saveJob(job);
  await launchWhenFree(cfg, job);
  return loadJob(id);
}

const queued = new Map(); // jobs of this process waiting for a free slot

async function launchWhenFree(cfg, job) {
  if ((await runningCount()) >= cfg.max_jobs) {
    queued.set(job.id, cfg);
    return;
  }
  await launch(cfg, job);
}

async function launch(cfg, job) {
  const source = workspaceSource(cfg, job.workspace);
  const args = [
    'run', '-d', '--name', `phs-${job.id}`, '--label', 'phs=job', '--label', `phs.home=${HOME_ID}`,
    '--network', 'none', ...LOCKED,
    '--tmpfs', '/tmp:rw,exec,nosuid,size=2g',
    '--pids-limit', '2048',
    '--cpus', String(job.cpus), '--memory', `${job.memory_gb}g`, '--memory-swap', `${job.memory_gb}g`,
    '--log-driver', 'json-file', '--log-opt', 'max-size=20m', '--log-opt', 'max-file=1',
    '-v', `${source}:/work`, '-v', `${DATA_VOLUME}:/data:ro`, '-w', '/work',
  ];
  if (job.gpu) args.push('--gpus', 'all');
  // timeout sends TERM at the limit and KILL ten seconds later; exit code 124 means the time ran out.
  args.push(job.image, 'timeout', '-k', '10', String(job.minutes * 60), 'sh', '-c', job.command);
  const r = await docker(args);
  if (r.code !== 0) {
    Object.assign(job, { status: 'failed to start', finished: now(), error: r.err.trim().slice(0, 600) });
    saveJob(job);
    return;
  }
  Object.assign(job, { status: 'running', started: now() });
  saveJob(job);
  watch(cfg, job.id);
}

const watching = new Map();

/** While a job of this process runs: stop it if its workspace outgrows the limit, and start queued jobs when it ends. */
function watch(cfg, id) {
  if (watching.has(id)) return;
  const timer = setInterval(async () => {
    try {
      const job = loadJob(id);
      if (!job || job.status !== 'running') return unwatch(id);
      const state = await inspect(id);
      if (!state || state.status !== 'running') {
        unwatch(id);
        await finalize(cfg, id);
        return startQueued();
      }
      const r = await docker(['exec', `phs-${id}`, 'sh', '-c', 'du -sb /work | cut -f1'], { timeoutMs: 60000 });
      const bytes = Number(r.out.toString().trim());
      if (bytes) noteWorkspaceSize(job.workspace, bytes);
      if (bytes > cfg.workspace_gb * 2 ** 30) await stopJob(cfg, id, `the workspace grew to ${gb(bytes)}, past its limit of ${cfg.workspace_gb} GB`);
    } catch {
      /* try again on the next tick */
    }
  }, 15000);
  timer.unref();
  watching.set(id, timer);
}
function unwatch(id) {
  clearInterval(watching.get(id));
  watching.delete(id);
}

let startingQueued = false;

/** Start waiting runs while there is room. Called from several places, so only one pass runs at a time. */
async function startQueued() {
  if (startingQueued) return;
  startingQueued = true;
  try {
    for (const [id, cfg] of [...queued]) {
      if ((await runningCount()) >= cfg.max_jobs) return;
      queued.delete(id);
      const job = loadJob(id);
      if (job?.status === 'queued') await launch(cfg, job);
    }
  } finally {
    startingQueued = false;
  }
}

async function inspect(id) {
  const r = await docker(['inspect', '--format', '{{.State.Status}}|{{.State.ExitCode}}|{{.State.OOMKilled}}|{{.State.StartedAt}}|{{.State.FinishedAt}}', `phs-${id}`]);
  if (r.code !== 0) return null;
  const [status, exit, oom, started, finished] = r.out.toString().trim().split('|');
  return { status, exit: Number(exit), oom: oom === 'true', started: Date.parse(started), finished: Date.parse(finished) };
}

/**
 * Bring a job's record up to date. If its container has ended, collect the result once: exit code,
 * output, checksums of what it wrote; then remove the container. Safe to call from any process.
 */
export async function refresh(cfg, id) {
  let job = loadJob(id);
  if (!job) return null;
  if (job.status === 'queued' && !queued.has(id) && now() - job.created > 15) {
    Object.assign(job, { status: 'stopped', stop_reason: 'the sandbox was restarted before this queued run could start', finished: now() });
    saveJob(job);
  }
  if (job.status !== 'running') return job;
  const state = await inspect(id);
  if (state && (state.status === 'running' || state.status === 'created')) {
    watch(cfg, id);
    return job;
  }
  await finalize(cfg, id, state);
  if (queued.size) await startQueued();
  return loadJob(id);
}

async function finalize(cfg, id, state) {
  const lock = path.join(JOBS, `${id}.lock`);
  try {
    fs.mkdirSync(lock);
  } catch {
    await sleep(1500); // another process is collecting this result
    return;
  }
  try {
    const job = loadJob(id);
    if (!job || job.status !== 'running') return;
    state = state ?? (await inspect(id));
    if (!state) {
      Object.assign(job, { status: 'stopped', stop_reason: 'its container disappeared (was Docker restarted?)', finished: now() });
      return saveJob(job);
    }
    const logs = await docker(['logs', `phs-${id}`], { merge: true, maxOut: 24 * 2 ** 20 });
    fs.writeFileSync(logFile(id), logs.out);
    await docker(['rm', '-f', `phs-${id}`]);
    const seconds = Math.max(0, (state.finished - state.started) / 1000);
    Object.assign(job, {
      status: job.stop_reason ? 'stopped' : 'done',
      exit_code: state.exit,
      timed_out: state.exit === 124,
      out_of_memory: state.oom,
      seconds: Math.round(seconds * 10) / 10,
      finished: now(),
      log_bytes: logs.out.length,
      outputs: await hashChangedSince(cfg, job.workspace, (state.started / 1000 - 0.01).toFixed(3)),
    });
    if (job.replay_of) job.comparison = compare(job.replay_of.outputs ?? [], job.outputs);
    saveJob(job);
    // One line per run, for the owner: what their agent ran and how it ended.
    fs.appendFileSync(RUN_LOG, JSON.stringify({ time: new Date().toISOString(), id, workspace: job.workspace, pack: job.pack, command: job.command, exit: job.exit_code, seconds: job.seconds, status: job.status, stop_reason: job.stop_reason }) + '\n');
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
}

/** How a replay's output files compare with the original run's. */
function compare(before, after) {
  const was = new Map(before.map((f) => [f.path, f.sha256]));
  const is = new Map(after.map((f) => [f.path, f.sha256]));
  const same = [], different = [], missing = [], extra = [];
  for (const [p, h] of was) (is.has(p) ? (is.get(p) === h ? same : different) : missing).push(p);
  for (const p of is.keys()) if (!was.has(p)) extra.push(p);
  return { same, different, missing, extra };
}

export async function stopJob(cfg, id, reason = 'stopped on request') {
  const job = loadJob(id);
  if (!job) return null;
  if (job.status === 'queued') {
    queued.delete(id);
    Object.assign(job, { status: 'stopped', stop_reason: reason, finished: now() });
    saveJob(job);
    return job;
  }
  if (job.status !== 'running') return job;
  job.stop_reason = reason;
  saveJob(job);
  await docker(['stop', '--time', '5', `phs-${id}`], { timeoutMs: 60000 });
  await finalize(cfg, id);
  return loadJob(id);
}

/** Wait until the job has ended, or `seconds` have passed. Returns the up-to-date job. */
export async function waitFor(cfg, id, seconds) {
  const until = Date.now() + seconds * 1000;
  for (;;) {
    const job = await refresh(cfg, id);
    if (!job || (job.status !== 'running' && job.status !== 'queued')) return job;
    if (Date.now() >= until) return job;
    await sleep(job.status === 'queued' ? 2000 : 600);
    if (job.status === 'queued') await startQueued();
  }
}

/**
 * The files a running job has written so far, newest first: "size  path". Agents often send a long
 * job's output into a file, and then the output shown by job_status stays empty; this is how they
 * see that the job is alive and where to look.
 */
export async function filesSoFar(id) {
  const job = loadJob(id);
  if (!job || job.status !== 'running') return [];
  const script = 'find . -type f -not -path "./.trash/*" -not -path "*/.olean/*" -printf "%T@\\t%s\\t%P\\n" | awk -F "\\t" -v t="$1" \'$1 + 0 > t + 0\' | sort -rn | head -n 12';
  const r = await docker(['exec', `phs-${id}`, 'sh', '-c', script, 'sh', String(job.started - 2)], { timeoutMs: 30000 });
  if (r.code !== 0) return [];
  return r.out.toString().split('\n').filter(Boolean).map((line) => {
    const [, size, name] = line.split('\t');
    return { size: Number(size), path: name };
  });
}

/** The end of a job's output. For a running job this reads the container's output so far. */
export async function tailOutput(id, maxChars = 12000) {
  const job = loadJob(id);
  if (!job) return { text: '', cut: false };
  let buf;
  if (job.status === 'running') buf = (await docker(['logs', '--tail', '400', `phs-${id}`], { merge: true })).out;
  else buf = fs.existsSync(logFile(id)) ? fs.readFileSync(logFile(id)) : Buffer.alloc(0);
  const text = buf.toString('utf8');
  return text.length > maxChars ? { text: text.slice(-maxChars), cut: true, total: text.length } : { text, cut: false, total: text.length };
}

// ---- Run records ----

/** A run's record as a block of text that can be pasted into a post and read back by `replay`. */
export function formatRecord(job) {
  const lines = [
    'problemhive-sandbox run record v1',
    `id: ${job.id}`,
    `pack: ${job.pack} ${job.pack_version}`,
    `image: ${job.image_id}`,
    `limits: ${job.cpus} cpus, ${job.memory_gb} GB, ${job.minutes} min, no network${job.gpu ? ', gpu' : ''}`,
    `command: ${job.command.replace(/\n/g, '\\n')}`,
    `result: exit ${job.exit_code ?? '?'} in ${job.seconds ?? '?'} s${job.timed_out ? ', timed out' : ''}${job.out_of_memory ? ', out of memory' : ''}${job.stop_reason ? `, stopped: ${job.stop_reason}` : ''}`,
    'inputs:',
    ...(job.inputs?.length ? job.inputs.map((f) => `  ${f.sha256}  ${f.path}`) : ['  (none found)']),
    'outputs:',
    ...(job.outputs?.length ? job.outputs.map((f) => `  ${f.sha256}  ${f.path}`) : ['  (no files written)']),
    'end of record',
  ];
  return lines.join('\n');
}

export function parseRecord(text) {
  const lines = String(text).replace(/\r/g, '').split('\n').map((l) => l.replace(/\s+$/, ''));
  const start = lines.findIndex((l) => l.trim() === 'problemhive-sandbox run record v1');
  if (start < 0) return null;
  const rec = { inputs: [], outputs: [] };
  let section = null;
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === 'end of record') break;
    const file = /^\s+([0-9a-f]{64})\s{2}(.+)$/.exec(line);
    if (file && section) {
      rec[section].push({ sha256: file[1], path: file[2] });
      continue;
    }
    if (line.trim() === 'inputs:' || line.trim() === 'outputs:') {
      section = line.trim().slice(0, -1);
      continue;
    }
    const m = /^(id|pack|image|limits|command|result): (.*)$/.exec(line);
    if (m) rec[m[1]] = m[2];
  }
  if (!rec.command || !rec.pack) return null;
  rec.command = rec.command.replace(/\\n/g, '\n');
  const [pack, version] = rec.pack.split(' ');
  const minutes = /(\d+) min/.exec(rec.limits ?? '');
  return { id: rec.id, pack, pack_version: version, image_id: rec.image, command: rec.command, minutes: minutes ? Number(minutes[1]) : undefined, gpu: /, gpu/.test(rec.limits ?? ''), inputs: rec.inputs, outputs: rec.outputs, result: rec.result };
}
