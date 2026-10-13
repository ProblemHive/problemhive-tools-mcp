// Getting files into the data area from the network. This is the only code that starts a container
// with network access. That container can write to the data area and nothing else: no workspace is
// mounted, its own system is read-only, and it runs one fixed program (phs-fetch) that only speaks
// https and says honestly what it is.
//
// Two callers: the owner's `fetch` command, which may download from anywhere, and the agent's
// request_data tool, which may only download from the archives the owner lists in "data_sources".
import fs from 'node:fs';
import path from 'node:path';
import { HOME, gb } from './config.js';
import { LOCKED, docker } from './docker.js';
import { getPack } from './packs.js';
import { DATA_VOLUME, UserError, checkPath, dataRegistry, ensureData, evictData, noteData } from './storage.js';

const DATA_LOG = path.join(HOME, 'data.log');

/** The host of an https address, lower-cased; throws for anything that is not a plain https address. */
export function httpsHost(url) {
  let u;
  try {
    u = new URL(String(url));
  } catch {
    throw new UserError('That is not a web address. Give the full https address of the file.');
  }
  if (u.protocol !== 'https:' || u.username || u.password) throw new UserError('Only plain https addresses can be downloaded.');
  return u.hostname.toLowerCase();
}

/** Whether a host is one of the owner's approved sources, or a subdomain of one. */
export function sourceAllowed(cfg, host) {
  return (cfg.data_sources ?? []).some((s) => {
    const src = String(s).toLowerCase().replace(/^\*?\./, '');
    return src && (host === src || host.endsWith('.' + src));
  });
}

/**
 * Download `url` into the data area as `name`. `how` says who asked ("fetched" by the owner,
 * "requested" by the agent) and `why` is the agent's stated reason; both are kept on record.
 */
export async function fetchData(cfg, url, name, { how = 'fetched', why = '' } = {}) {
  httpsHost(url);
  const rel = checkPath(name);
  await ensureData();
  const max = Math.floor(cfg.fetch_max_gb * 2 ** 30);
  await evictData(cfg.data_gb * 2 ** 30 - max);
  const r = await docker(['run', '--rm', ...LOCKED, '--tmpfs', '/tmp:rw,size=64m', '--pids-limit', '256', '--memory', '1g', '-v', `${DATA_VOLUME}:/data`, '-w', '/data', getPack('base').image, 'phs-fetch', String(url), rel, String(max)]);
  const line = { time: new Date().toISOString(), how, url: String(url), name: rel, why };
  if (r.code !== 0) {
    const error = r.err.trim() || 'unknown error';
    fs.appendFileSync(DATA_LOG, JSON.stringify({ ...line, failed: error }) + '\n');
    throw new UserError(`The download failed: ${error}\nIf the site refused (403, 401, a login page), that is its decision: nothing here tries another identity or a way round. A file larger than ${cfg.fetch_max_gb} GB is also refused.`);
  }
  const [size, sha256] = r.out.toString().trim().split(' ');
  noteData(rel, { url: String(url), sha256, added: new Date().toISOString().slice(0, 10), at: Math.floor(Date.now() / 1000), how, ...(why ? { why } : {}) });
  fs.appendFileSync(DATA_LOG, JSON.stringify({ ...line, bytes: Number(size), sha256 }) + '\n');
  return { name: rel, size: Number(size), sha256, text: `Saved as /data/${rel} (${gb(Number(size))}, sha256 ${sha256}).` };
}

/** How many downloads the agent has asked for in the last hour. */
export function requestsLastHour() {
  const since = Math.floor(Date.now() / 1000) - 3600;
  return Object.values(dataRegistry()).filter((e) => e.how === 'requested' && (e.at ?? 0) > since).length;
}
