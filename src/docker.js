// Every call to Docker goes through here. Arguments are passed as a list, never through a shell on
// the host, so nothing an agent writes can be read as a host command.
import { spawn } from 'node:child_process';

/**
 * Run `docker <args>`. Resolves with { code, out, err }; never rejects for a non-zero exit.
 * `input` is written to its standard input (a string, a Buffer or a readable stream).
 * `maxOut` caps what is kept of the output; the rest is dropped and `cut` is set.
 */
export function docker(args, { input, maxOut = 4 * 2 ** 20, timeoutMs = 0, merge = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { windowsHide: true });
    const out = [];
    const err = [];
    let size = 0;
    let cut = false;
    const keep = (list) => (chunk) => {
      if (size >= maxOut) return void (cut = true);
      const room = maxOut - size;
      list.push(chunk.length > room ? chunk.subarray(0, room) : chunk);
      if (chunk.length > room) cut = true;
      size += Math.min(chunk.length, room);
    };
    child.stdout.on('data', keep(out));
    child.stderr.on('data', keep(merge ? out : err));
    let timer = null;
    if (timeoutMs) timer = setTimeout(() => child.kill(), timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e.code === 'ENOENT' ? new Error('Docker was not found. Install Docker Desktop (or Docker Engine) and make sure the "docker" command works.') : e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, out: Buffer.concat(out), err: Buffer.concat(err).toString('utf8'), cut });
    });
    child.stdin.on('error', () => {});
    if (input && typeof input.pipe === 'function') input.pipe(child.stdin);
    else child.stdin.end(input ?? '');
  });
}

/** Like docker(), but the output goes straight to this process's terminal (for builds). */
export function dockerShown(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true });
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
}

export async function dockerReady() {
  try {
    const r = await docker(['version', '--format', '{{.Server.Version}}'], { timeoutMs: 20000 });
    return r.code === 0 ? { ok: true, version: r.out.toString().trim() } : { ok: false, why: 'Docker is installed but not running. Start Docker Desktop and try again.' };
  } catch (e) {
    return { ok: false, why: e.message };
  }
}

/** The flags every container gets, whatever it is for: no privileges, a read-only system, a small temporary area. */
export const LOCKED = ['--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--read-only', '--user', 'hive'];
