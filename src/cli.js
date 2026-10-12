#!/usr/bin/env node
// The owner's commands, and the entry point an agent's app uses to start the MCP server
// ("problemhive-sandbox mcp"). Everything that installs software, reaches the network, moves files
// across the sandbox boundary or frees space is here, on the owner's side, and not among the tools
// an agent can call.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_FILE, JOBS, ROOT, RUN_LOG, VERSION, ensureHome, gb, loadConfig } from './config.js';
import { LOCKED, docker, dockerReady, dockerShown } from './docker.js';
import { startJob, tailOutput, waitFor } from './jobs.js';
import { allPacks, getPack, installed, measured, recordMeasured } from './packs.js';
import { DATA_VOLUME, UserError, checkName, checkPath, dataBytes, emptyOldTrash, ensureData, ensureWorkspace, evictData, helper, listData, listWorkspaces, noteData, removeData, removeWorkspace, workspaceBytes, workspaceSource } from './storage.js';

const HELP = `problemhive-sandbox ${VERSION}: a locked-down place on your own machine where an AI agent can run scientific tools.

First time:
  problemhive-sandbox setup              check Docker, build the base pack, test it, show how to connect an agent

Packs of tools:
  problemhive-sandbox packs              what exists, what is installed, sizes and minimum hardware
  problemhive-sandbox install <pack>     build a pack on this machine and test its tools
  problemhive-sandbox test <pack>        run every tool's check again, with the pack's minimum memory
  problemhive-sandbox remove <pack>      remove a pack's image

Files (the only ways across the sandbox boundary):
  problemhive-sandbox import <file> [--as <name>] [--workspace <ws>]    copy a file in: to the data area, or to a workspace
  problemhive-sandbox export <ws> <path> <file>                         copy one file out of a workspace
  problemhive-sandbox fetch <https address> <name>                      download a file into the data area
  problemhive-sandbox data [rm <name>]                                  list the data area, or remove a file from it

Storage:
  problemhive-sandbox storage            what uses space, against your limits
  problemhive-sandbox clean [--stale] [--trash]    empty old trash, drop old logs; --stale also removes workspaces unused for long; --trash empties all trash now
  problemhive-sandbox workspaces [rm <ws>]         list workspaces, or remove one for good

Other:
  problemhive-sandbox runs               the last commands your agent ran
  problemhive-sandbox config             where the settings file is, and what it says
  problemhive-sandbox mcp                start the MCP server (an agent's app runs this; you normally do not)
`;

const say = (s = '') => process.stdout.write(s + '\n');
/** A stored UTC time as the owner's local date and time, to the minute. */
const localTime = (iso) => {
  const d = new Date(iso);
  const two = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
};

async function needDocker() {
  const d = await dockerReady();
  if (!d.ok) throw new UserError(d.why);
  return d;
}

async function testPack(cfg, pack) {
  const ws = `selftest-${pack.name}`;
  let failed = 0;
  say(`Testing the ${pack.tools.length} tools of "${pack.name}" with ${pack.min_cores} cores and ${pack.min_memory_gb} GB, no network:`);
  for (const tool of pack.tools) {
    const job = await startJob({ ...cfg, max_jobs: 99 }, { workspace: ws, command: tool.check, pack: pack.name, minutes: 10, cpus: pack.min_cores, memoryGb: pack.min_memory_gb });
    const done = await waitFor(cfg, job.id, 660);
    const out = (await tailOutput(done.id, 4000)).text;
    const ok = done.status === 'done' && out.includes(tool.expect);
    if (!ok) failed++;
    say(`  ${ok ? 'ok  ' : 'FAIL'}  ${tool.name}${ok ? ` (${done.seconds} s)` : `\n        expected the output to contain: ${tool.expect}\n        status ${done.status}, exit ${done.exit_code}${done.out_of_memory ? ', out of memory' : ''}; output:\n        ${out.trim().split('\n').slice(-8).join('\n        ')}`}`);
  }
  await removeWorkspace(cfg, ws).catch(() => {});
  const img = await installed(pack);
  recordMeasured(pack.name, { version: pack.version, image_id: img?.id, size_bytes: img?.size, tested: failed === 0, failed, date: new Date().toISOString().slice(0, 10) });
  say(failed ? `${failed} of ${pack.tools.length} tools FAILED.` : `All ${pack.tools.length} tools work. Image size: ${gb(img.size)}.`);
  return failed === 0;
}

async function install(cfg, name) {
  const pack = getPack(name);
  if (!pack) throw new UserError(`There is no pack called "${name}". Packs: ${allPacks().map((p) => p.name).join(', ')}.`);
  await needDocker();
  const base = getPack('base');
  if (pack.name !== 'base' && !(await installed(base))) await install(cfg, 'base');
  say(`Building "${pack.name}" (${pack.title}), about ${pack.size_estimate_gb} GB. This downloads software and can take a while.`);
  const code = await dockerShown(['build', '-t', pack.image, '--build-arg', `BASE=${base.image}`, pack.dir]);
  if (code !== 0) throw new UserError(`The build of "${pack.name}" failed (see above). Building again often gets past a failed download.`);
  await ensureData();
  return testPack(cfg, pack);
}

function parseFlags(args, names) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    const name = args[i].startsWith('--') ? args[i].slice(2) : null;
    if (name && name in names) flags[name] = names[name] ? args[++i] : true;
    else rest.push(args[i]);
  }
  return { flags, rest };
}

/** Copy a host file into a volume or folder, through a locked-down container. Returns "size sha256". */
async function copyIn(source, at, rel, file) {
  const r = await helper([`${source}:${at}`], ['sh', '-c', 'mkdir -p -- "$(dirname -- "$1")" && cat > "$1" && echo "$(stat -c %s -- "$1") $(sha256sum -- "$1" | cut -d" " -f1)"', 'sh', rel], { input: fs.createReadStream(file), workdir: at });
  if (r.code !== 0) throw new UserError(`Could not copy the file in: ${r.err.trim()}`);
  const [size, sha256] = r.out.toString().trim().split(' ');
  return { size: Number(size), sha256 };
}

const commands = {
  async setup(cfg) {
    const d = await needDocker();
    say(`Docker ${d.version} is running.`);
    say(`Settings: ${CONFIG_FILE}`);
    const ok = await install(cfg, 'base');
    say();
    say('To connect an agent, add this MCP server to its app. For Claude Code:');
    say(`  claude mcp add problemhive-sandbox -- node "${path.join(ROOT, 'src', 'cli.js')}" mcp`);
    say('For apps that take a JSON entry:');
    say(JSON.stringify({ mcpServers: { 'problemhive-sandbox': { command: 'node', args: [path.join(ROOT, 'src', 'cli.js'), 'mcp'] } } }, null, 2));
    say();
    say('More tools: problemhive-sandbox packs');
    return ok ? 0 : 1;
  },

  async packs() {
    const m = measured();
    const d = await dockerReady();
    for (const p of allPacks()) {
      const img = d.ok ? await installed(p) : null;
      say(`${p.name} ${p.version}  ${p.title}`);
      say(`  ${img ? `installed: ${gb(img.size)} on disk${m[p.name]?.tested ? `, all tools tested ${m[p.name].date}` : m[p.name] ? `, ${m[p.name].failed} tool(s) FAILED their check` : ', not tested yet'}` : `not installed: about ${p.size_estimate_gb} GB`}`);
      say(`  needs at least ${p.min_cores} cores and ${p.min_memory_gb} GB of memory${p.gpu ? `; GPU: ${p.gpu === true ? 'needed' : p.gpu}` : ''}`);
      say(`  ${p.summary}`);
      say(`  tools: ${p.tools.map((t) => t.name).join(', ')}`);
      say();
    }
    if (!d.ok) say(`(${d.why})`);
    say('Packs other than base share its files, so the sizes of installed packs overlap by the size of base.');
  },

  async install(cfg, args) {
    if (!args[0]) throw new UserError('Which pack? See: problemhive-sandbox packs');
    return (await install(cfg, args[0])) ? 0 : 1;
  },

  async test(cfg, args) {
    const pack = getPack(args[0]);
    if (!pack) throw new UserError('Which pack? See: problemhive-sandbox packs');
    await needDocker();
    if (!(await installed(pack))) throw new UserError(`"${pack.name}" is not installed.`);
    return (await testPack(cfg, pack)) ? 0 : 1;
  },

  async remove(cfg, args) {
    const pack = getPack(args[0]);
    if (!pack) throw new UserError('Which pack?');
    if (pack.name === 'base' && (await Promise.all(allPacks().filter((p) => p.name !== 'base').map(installed))).some(Boolean)) throw new UserError('Other packs are built on base. Remove them first.');
    const r = await docker(['image', 'rm', pack.image]);
    say(r.code === 0 ? `Removed "${pack.name}". Docker frees the space when no other image uses the same files.` : r.err.trim());
  },

  async storage(cfg) {
    await needDocker();
    say('PACKS');
    for (const p of allPacks()) {
      const img = await installed(p);
      if (img) say(`  ${p.name.padEnd(8)} ${gb(img.size)}${p.name === 'base' ? '' : '  (includes base)'}`);
    }
    say(`WORKSPACES (limit ${cfg.workspace_gb} GB each, ${cfg.workspaces_total_gb} GB together; kept in ${cfg.workspaces === 'volume' ? 'Docker volumes' : cfg.workspaces})`);
    let total = 0;
    const cutoff = Date.now() / 1000 - cfg.stale_days * 86400;
    for (const w of await listWorkspaces(cfg)) {
      const bytes = await workspaceBytes(cfg, w.name);
      total += bytes;
      say(`  ${w.name.padEnd(24)} ${gb(bytes)}${w.used && w.used < cutoff ? `  STALE: not used for ${Math.floor((Date.now() / 1000 - w.used) / 86400)} days` : ''}`);
    }
    say(`  together: ${gb(total)}`);
    say(`DATA AREA (limit ${cfg.data_gb} GB): ${gb(await dataBytes())}`);
    const logs = fs.readdirSync(JOBS).reduce((n, f) => n + fs.statSync(path.join(JOBS, f)).size, 0);
    say(`RUN RECORDS AND LOGS (${JOBS}): ${gb(logs)}`);
    say();
    say('Not counted here: Docker keeps its own build cache (see "docker system df"; "docker builder prune" frees it).');
    say('On Windows and Mac, Docker\'s virtual disk does not shrink by itself after files are removed; Docker Desktop has a setting to compact it.');
  },

  async clean(cfg, args) {
    await needDocker();
    const { flags } = parseFlags(args, { stale: false, trash: false });
    const cutoff = Date.now() / 1000 - cfg.stale_days * 86400;
    for (const w of await listWorkspaces(cfg)) {
      const before = await workspaceBytes(cfg, w.name);
      if (w.used && w.used < cutoff) {
        if (flags.stale || cfg.auto_remove_stale) {
          await removeWorkspace(cfg, w.name);
          say(`removed stale workspace ${w.name} (${gb(before)})`);
        } else {
          say(`stale: ${w.name} (${gb(before)}, not used for ${Math.floor((Date.now() / 1000 - w.used) / 86400)} days). Remove it with: problemhive-sandbox workspaces rm ${w.name}   or all stale ones with: clean --stale`);
        }
        continue;
      }
      const after = await emptyOldTrash(cfg, w.name, { all: Boolean(flags.trash) });
      if (after < before) say(`${w.name}: emptied ${gb(before - after)} of trash`);
    }
    let logs = 0;
    for (const f of fs.readdirSync(JOBS).filter((f) => f.endsWith('.log'))) {
      const p = path.join(JOBS, f);
      const st = fs.statSync(p);
      if (st.mtimeMs < Date.now() - 30 * 86400 * 1000) {
        logs += st.size;
        fs.rmSync(p);
      }
    }
    if (logs) say(`removed ${gb(logs)} of run output older than 30 days (the run records are kept)`);
    const dropped = await evictData(cfg.data_gb * 2 ** 30);
    if (dropped.length) say(`data area was over ${cfg.data_gb} GB: dropped ${dropped.join(', ')}`);
    say('Done.');
  },

  async workspaces(cfg, args) {
    await needDocker();
    if (args[0] === 'rm') {
      const name = checkName(args[1] ?? '');
      await removeWorkspace(cfg, name);
      return say(`Removed workspace ${name} and everything in it.`);
    }
    const list = await listWorkspaces(cfg);
    say(list.length ? list.map((w) => `${w.name.padEnd(24)} ${gb(w.bytes ?? 0)}  last used ${w.used ? new Date(w.used * 1000).toISOString().slice(0, 10) : '?'}`).join('\n') : 'No workspaces yet.');
  },

  async import(cfg, args) {
    await needDocker();
    const { flags, rest } = parseFlags(args, { as: true, workspace: true });
    const file = rest[0];
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) throw new UserError('Give the path of a file on this machine.');
    const rel = checkPath(flags.as ?? path.basename(file));
    const size = fs.statSync(file).size;
    if (flags.workspace) {
      const source = await ensureWorkspace(cfg, checkName(flags.workspace));
      const r = await copyIn(source, '/work', rel, file);
      return say(`Copied to workspace ${flags.workspace} as ${rel} (${gb(r.size)}, sha256 ${r.sha256}).`);
    }
    if (size > cfg.data_gb * 2 ** 30) throw new UserError(`The file is larger than the whole data area (${cfg.data_gb} GB). Raise "data_gb" in ${CONFIG_FILE} first.`);
    await ensureData();
    const dropped = await evictData(cfg.data_gb * 2 ** 30 - size);
    if (dropped.length) say(`Made room by dropping: ${dropped.join(', ')}`);
    const r = await copyIn(DATA_VOLUME, '/data', rel, file);
    noteData(rel, { sha256: r.sha256, added: new Date().toISOString().slice(0, 10), how: 'imported' });
    say(`Copied to the data area as /data/${rel} (${gb(r.size)}, sha256 ${r.sha256}).`);
  },

  async export(cfg, args) {
    await needDocker();
    const [ws, file, dest] = args;
    if (!ws || !file || !dest) throw new UserError('Usage: problemhive-sandbox export <workspace> <path in it> <file to write here>');
    const rel = checkPath(file);
    if (fs.existsSync(dest)) throw new UserError(`${dest} already exists. Choose another name; export never overwrites.`);
    const source = workspaceSource(cfg, checkName(ws));
    const image = getPack('base').image;
    const code = await new Promise((resolve, reject) => {
      const child = spawn('docker', ['run', '--rm', '--network', 'none', ...LOCKED, '-v', `${source}:/work:ro`, '-w', '/work', image, 'cat', '--', rel], { stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true });
      child.stdout.pipe(fs.createWriteStream(dest));
      child.on('error', reject);
      child.on('close', resolve);
    });
    if (code !== 0) {
      fs.rmSync(dest, { force: true });
      throw new UserError(`Could not read ${rel} from workspace ${ws}.`);
    }
    say(`Wrote ${dest} (${gb(fs.statSync(dest).size)}). It came from the sandbox: treat it like any downloaded file.`);
  },

  async fetch(cfg, args) {
    await needDocker();
    const [url, name] = args;
    if (!url || !/^https:\/\/[^\s]+$/.test(url)) throw new UserError('Usage: problemhive-sandbox fetch <https address> <name>   (https only)');
    const rel = checkPath(name ?? decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? 'download'));
    await ensureData();
    const max = Math.floor(cfg.fetch_max_gb * 2 ** 30);
    await evictData(cfg.data_gb * 2 ** 30 - max);
    say(`Downloading ${url} ...`);
    // The only container that has network access. It can write to the data area and nothing else:
    // no workspace is mounted, and its own system is read-only.
    const r = await docker(['run', '--rm', ...LOCKED, '--tmpfs', '/tmp:rw,size=64m', '--pids-limit', '256', '--memory', '1g', '-v', `${DATA_VOLUME}:/data`, '-w', '/data', getPack('base').image, 'phs-fetch', url, rel, String(max)]);
    if (r.code !== 0) throw new UserError(`The download failed: ${r.err.trim() || 'unknown error'}\nIf the site refused, that is its decision; this tool does not try to get around it. You can download the file yourself and use: problemhive-sandbox import <file>`);
    const [size, sha256] = r.out.toString().trim().split(' ');
    noteData(rel, { url, sha256, added: new Date().toISOString().slice(0, 10), how: 'fetched' });
    say(`Saved as /data/${rel} (${gb(Number(size))}, sha256 ${sha256}). Runs can read it there.`);
  },

  async data(cfg, args) {
    await needDocker();
    if (args[0] === 'rm') {
      await removeData(args[1] ?? '');
      return say(`Removed ${args[1]} from the data area.`);
    }
    const files = await listData();
    say(files.length ? files.map((f) => `${f.name.padEnd(40)} ${gb(f.size)}  ${f.how ?? ''} ${f.added ?? ''}  ${f.url ?? ''}`).join('\n') : 'The data area is empty.');
  },

  async runs() {
    if (!fs.existsSync(RUN_LOG)) return say('No runs yet.');
    const lines = fs.readFileSync(RUN_LOG, 'utf8').trim().split('\n').slice(-30);
    for (const l of lines) {
      const r = JSON.parse(l);
      say(`${localTime(r.time)}  ${r.id}  ${r.workspace}  [${r.pack}]  exit ${r.exit} in ${r.seconds} s${r.stop_reason ? ` (stopped: ${r.stop_reason})` : ''}\n    ${r.command.replace(/\s+/g, ' ').slice(0, 160)}`);
    }
    say(`\nThe full list is ${RUN_LOG}. Output of a run: ${path.join(JOBS, '<id>.log')}`);
  },

  async config(cfg) {
    say(`Settings file: ${CONFIG_FILE}\nEdit it to change limits; an agent cannot. Current values:\n${JSON.stringify(cfg, null, 2)}`);
  },

  async mcp() {
    const { serve } = await import('./mcp.js');
    serve();
    return 'serving';
  },
};

const [name, ...args] = process.argv.slice(2);
try {
  if (!name || name === 'help' || name === '--help' || name === '-h') {
    say(HELP);
  } else if (!(name in commands)) {
    say(`Unknown command "${name}".\n\n${HELP}`);
    process.exitCode = 2;
  } else {
    ensureHome();
    const code = await commands[name](loadConfig(), args);
    if (code !== 'serving') process.exit(typeof code === 'number' ? code : 0);
  }
} catch (e) {
  process.stderr.write((e instanceof UserError ? e.message : `problemhive-sandbox failed: ${e.stack ?? e}`) + '\n');
  process.exit(1);
}
