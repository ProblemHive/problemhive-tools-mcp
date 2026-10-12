// Where runs keep their files, and how that is kept from growing without limit.
//
// - A workspace is one problem's files. By default it is a Docker volume, which only containers can
//   see; the owner may choose a folder on the machine instead ("workspaces" in the config).
// - The data area is one Docker volume for downloaded and imported files. Runs see it read-only at /data.
// - Nothing on the host reads these files. Every file operation runs in a small locked-down
//   container that has only the one workspace (or the data area) mounted, so a path can never
//   reach anything else, whatever it contains.
import fs from 'node:fs';
import path from 'node:path';
import { STATE, readJson, writeJson } from './config.js';
import { docker, LOCKED } from './docker.js';
import { getPack } from './packs.js';

export const DATA_VOLUME = 'phs-data';
const META = path.join(STATE, 'workspaces.json');
const DATA_META = path.join(STATE, 'data.json');

export class UserError extends Error {}

export function checkName(name) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/.test(name)) {
    throw new UserError('A workspace name is 1 to 63 letters, digits, dots, dashes or underscores, starting with a letter or digit (for example the id of the post you are working on).');
  }
  return name;
}

/** A path inside a workspace: relative, forward slashes, no "..", and not in the trash. */
export function checkPath(p, { allowRoot = false } = {}) {
  if (typeof p !== 'string' || p.length > 300 || /[\u0000-\u001f\\]/.test(p)) throw new UserError('A path is at most 300 characters, uses forward slashes, and has no control characters.');
  const clean = p.replace(/^\.\//, '').replace(/\/+$/, '');
  if (clean === '' || clean === '.') {
    if (allowRoot) return '.';
    throw new UserError('Give the path of a file inside the workspace.');
  }
  const parts = clean.split('/');
  if (clean.startsWith('/') || parts.some((s) => s === '' || s === '.' || s === '..')) throw new UserError('A path is relative to the workspace: no leading slash and no "..".');
  if (parts[0] === '.trash') throw new UserError('The .trash folder is managed by the sandbox.');
  return clean;
}

/** What to mount for a workspace: a volume name, or the folder on the host. */
export function workspaceSource(cfg, name) {
  checkName(name);
  return cfg.workspaces === 'volume' ? `phs-ws-${name}` : path.join(cfg.workspaces, name);
}

export async function ensureWorkspace(cfg, name) {
  const source = workspaceSource(cfg, name);
  if (cfg.workspaces === 'volume') {
    await ensureVolume(source, 'workspace');
  } else {
    fs.mkdirSync(source, { recursive: true });
  }
  const meta = readJson(META, {});
  const t = Math.floor(Date.now() / 1000);
  meta[name] = { created: t, bytes: 0, ...meta[name], used: t };
  writeJson(META, meta);
  return source;
}

export async function listWorkspaces(cfg) {
  let names;
  if (cfg.workspaces === 'volume') {
    const r = await docker(['volume', 'ls', '--filter', 'label=phs=workspace', '--format', '{{.Name}}']);
    names = r.out.toString().split('\n').map((s) => s.trim()).filter((s) => s.startsWith('phs-ws-')).map((s) => s.slice(7));
  } else {
    names = fs.existsSync(cfg.workspaces) ? fs.readdirSync(cfg.workspaces, { withFileTypes: true }).filter((d) => d.isDirectory() && /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/.test(d.name)).map((d) => d.name) : [];
  }
  const meta = readJson(META, {});
  return names.sort().map((name) => ({ name, ...(meta[name] ?? {}) }));
}

export function noteWorkspaceSize(name, bytes) {
  const meta = readJson(META, {});
  meta[name] = { ...(meta[name] ?? {}), bytes };
  writeJson(META, meta);
}

export async function removeWorkspace(cfg, name) {
  const source = workspaceSource(cfg, name);
  if (cfg.workspaces === 'volume') {
    const r = await docker(['volume', 'rm', source]);
    if (r.code !== 0) throw new Error(r.err.trim());
  } else {
    fs.rmSync(source, { recursive: true, force: true });
  }
  const meta = readJson(META, {});
  delete meta[name];
  writeJson(META, meta);
}

export async function ensureData() {
  await ensureVolume(DATA_VOLUME, 'data');
}

/**
 * Create a volume if it does not exist yet. While a volume is empty, Docker gives it the owner of the
 * image folder it is mounted on, so volumes are only ever mounted at /work and /data, which belong to
 * the unprivileged user in every pack's image. No container ever runs as root.
 */
async function ensureVolume(name, kind) {
  if ((await docker(['volume', 'inspect', name])).code === 0) return;
  const r = await docker(['volume', 'create', '--label', `phs=${kind}`, name]);
  if (r.code !== 0) throw new Error(`Could not create the ${kind} volume: ${r.err.trim()}`);
}

/**
 * Run a small command in a throwaway container with the given mounts and nothing else: no network,
 * no privileges, a read-only system. `argv` is a program and its arguments, not a shell line.
 */
export async function helper(mounts, argv, { input, maxOut, workdir = '/work' } = {}) {
  const image = getPack('base').image;
  const args = ['run', '--rm', '-i', '--network', 'none', ...LOCKED, '--tmpfs', '/tmp:rw,size=64m', '--pids-limit', '256', '--memory', '1g'];
  for (const m of mounts) args.push('-v', m);
  args.push('-w', workdir, image, ...argv);
  return docker(args, { input, maxOut });
}

const sh = (script, ...args) => ['sh', '-c', script, 'sh', ...args];

export async function writeFile(cfg, ws, file, content) {
  const rel = checkPath(file);
  const source = await ensureWorkspace(cfg, ws);
  const r = await helper([`${source}:/work`], sh('mkdir -p -- "$(dirname -- "$1")" && cat > "$1" && stat -c %s -- "$1"', rel), { input: content });
  if (r.code !== 0) throw new UserError(`Could not write ${rel}: ${r.err.trim() || 'unknown error'}`);
  return Number(r.out.toString().trim());
}

export async function readFile(cfg, ws, file, offset = 0, maxBytes = 60000) {
  const rel = checkPath(file);
  const source = workspaceSource(cfg, ws);
  const r = await helper([`${source}:/work:ro`], sh('[ -f "$1" ] || { echo "no such file" >&2; exit 3; }; stat -c %s -- "$1"; tail -c "+$2" -- "$1" | head -c "$3"', rel, String(offset + 1), String(maxBytes)), { maxOut: maxBytes + 64 });
  if (r.code !== 0) throw new UserError(`Could not read ${rel}: ${r.err.trim() || 'unknown error'}`);
  const nl = r.out.indexOf(10);
  return { size: Number(r.out.subarray(0, nl).toString()), bytes: r.out.subarray(nl + 1) };
}

export async function listFiles(cfg, ws, dir = '.') {
  const rel = checkPath(dir, { allowRoot: true });
  const source = workspaceSource(cfg, ws);
  const r = await helper([`${source}:/work:ro`], sh('[ -d "$1" ] || { echo "no such folder" >&2; exit 3; }; cd -- "$1" && find . -mindepth 1 -maxdepth 3 -not -path "./.trash*" -printf "%y\\t%s\\t%TY-%Tm-%Td %TH:%TM\\t%P\\n" | sort -t "\t" -k4 | head -n 400', rel));
  if (r.code !== 0) throw new UserError(`Could not list ${rel}: ${r.err.trim() || 'unknown error'}`);
  return r.out.toString().split('\n').filter(Boolean).map((line) => {
    const [type, size, when, name] = line.split('\t');
    return { type: type === 'd' ? 'folder' : 'file', size: Number(size), when, name };
  });
}

/** Deleting moves the file to the workspace's trash, where it stays for `trash_days`. */
export async function trashFile(cfg, ws, file) {
  const rel = checkPath(file);
  const source = workspaceSource(cfg, ws);
  const stamp = String(Math.floor(Date.now() / 1000));
  const r = await helper([`${source}:/work`], sh('[ -e "$1" ] || { echo "no such file" >&2; exit 3; }; d=".trash/$2/$(dirname -- "$1")"; mkdir -p -- "$d" && mv -- "$1" "$d/"', rel, stamp));
  if (r.code !== 0) throw new UserError(`Could not delete ${rel}: ${r.err.trim() || 'unknown error'}`);
  return `.trash/${stamp}/${rel}`;
}

/** Remove trash older than the limit from one workspace. Returns the bytes in the workspace afterwards. */
export async function emptyOldTrash(cfg, ws, { all = false } = {}) {
  const source = workspaceSource(cfg, ws);
  const cutoff = all ? 9999999999 : Math.floor(Date.now() / 1000) - cfg.trash_days * 86400;
  const r = await helper([`${source}:/work`], sh('for d in .trash/*; do [ -d "$d" ] || continue; n="${d##*/}"; [ "$n" -lt "$1" ] 2>/dev/null && rm -rf -- "$d"; done; du -sb . | cut -f1', String(cutoff)));
  const bytes = Number(r.out.toString().trim()) || 0;
  noteWorkspaceSize(ws, bytes);
  return bytes;
}

export async function workspaceBytes(cfg, ws) {
  const r = await helper([`${workspaceSource(cfg, ws)}:/work:ro`], sh('du -sb . | cut -f1'));
  const bytes = Number(r.out.toString().trim()) || 0;
  noteWorkspaceSize(ws, bytes);
  return bytes;
}

/** sha256 of the files that exist among `paths` (workspace-relative, or under /data). */
export async function hashFiles(cfg, ws, paths) {
  if (paths.length === 0) return [];
  const r = await helper([`${workspaceSource(cfg, ws)}:/work:ro`, `${DATA_VOLUME}:/data:ro`], sh('for f in "$@"; do [ -f "$f" ] && sha256sum -- "$f"; done; true', ...paths.slice(0, 200)), { maxOut: 2 ** 20 });
  return parseSums(r.out.toString());
}

/** sha256 of the files in the workspace changed since `epoch` (what a run wrote). */
export async function hashChangedSince(cfg, ws, epoch) {
  const r = await helper([`${workspaceSource(cfg, ws)}:/work:ro`], sh('find . -type f -newermt "@$1" -not -path "./.trash/*" -not -path "*/.olean/*" -printf "%P\\n" | sort | head -n 200 | while IFS= read -r f; do sha256sum -- "$f"; done; echo "size $(du -sb . | cut -f1)"', String(epoch)), { maxOut: 2 ** 20 });
  const text = r.out.toString();
  const size = /^size (\d+)$/m.exec(text);
  if (size) noteWorkspaceSize(ws, Number(size[1]));
  return parseSums(text);
}

const parseSums = (text) =>
  text.split('\n').filter(Boolean).map((line) => ({ sha256: line.slice(0, 64), path: line.slice(66) })).filter((x) => /^[0-9a-f]{64}$/.test(x.sha256));

// ---- The data area ----

export const dataRegistry = () => readJson(DATA_META, {});
export function noteData(name, entry) {
  const all = dataRegistry();
  if (entry) all[name] = entry;
  else delete all[name];
  writeJson(DATA_META, all);
}

export async function listData() {
  await ensureData();
  const r = await helper([`${DATA_VOLUME}:/data:ro`], sh('find /data -type f -not -name "*.part" -printf "%s\\t%P\\n" | sort -t "\t" -k2 | head -n 1000'), { workdir: '/data' });
  const reg = dataRegistry();
  return r.out.toString().split('\n').filter(Boolean).map((line) => {
    const [size, name] = line.split('\t');
    return { name, size: Number(size), ...(reg[name] ?? {}) };
  });
}

export async function dataBytes() {
  await ensureData();
  const r = await helper([`${DATA_VOLUME}:/data:ro`], sh('du -sb /data | cut -f1'), { workdir: '/data' });
  return Number(r.out.toString().trim()) || 0;
}

/**
 * Make room in the data area: while it is over `limitBytes`, drop the files that were read longest
 * ago. Safe because every fetched file's address and checksum are on record, so it can be fetched again.
 */
export async function evictData(limitBytes) {
  await ensureData();
  const script = 'limit="$1"; total=$(du -sb /data | cut -f1); [ "$total" -le "$limit" ] && exit 0; find /data -type f -printf "%A@ %s %P\\n" | sort -n | while read -r a s p; do [ "$total" -le "$limit" ] && break; rm -f -- "/data/$p"; total=$((total - s)); echo "$p"; done';
  const r = await helper([`${DATA_VOLUME}:/data`], sh(script, String(Math.floor(limitBytes))), { workdir: '/data' });
  const dropped = r.out.toString().split('\n').filter(Boolean);
  for (const name of dropped) noteData(name, null);
  return dropped;
}

export async function removeData(name) {
  const rel = checkPath(name);
  const r = await helper([`${DATA_VOLUME}:/data`], sh('[ -e "$1" ] || { echo "no such file" >&2; exit 3; }; rm -rf -- "$1"', rel), { workdir: '/data' });
  if (r.code !== 0) throw new UserError(`Could not remove ${rel}: ${r.err.trim()}`);
  noteData(rel, null);
}
