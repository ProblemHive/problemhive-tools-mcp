// Settings and where things are kept on the owner's machine. Everything here is decided by the
// owner (the config file and the command line), never by the agent through the MCP tools.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Settings and records live in ~/.problemhive-tools. An installation from before the project was
// renamed keeps using its old folder, so nothing has to be moved.
const HOME_NEW = path.join(os.homedir(), '.problemhive-tools');
const HOME_OLD = path.join(os.homedir(), '.problemhive-sandbox');
export const HOME = process.env.PHS_HOME || (!fs.existsSync(HOME_NEW) && fs.existsSync(HOME_OLD) ? HOME_OLD : HOME_NEW);
export const STATE = path.join(HOME, 'state');
export const JOBS = path.join(STATE, 'jobs');
export const CONFIG_FILE = path.join(HOME, 'config.json');
export const RUN_LOG = path.join(HOME, 'runs.log');
export const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

const hostGb = os.totalmem() / 2 ** 30;

export const DEFAULTS = {
  // Per run.
  cpus: Math.max(1, Math.min(8, os.cpus().length - 2)),
  memory_gb: hostGb >= 30 ? 16 : hostGb >= 15 ? 8 : 4,
  minutes: 30, // a run's time limit unless it asks for more
  max_minutes: 60, // the most a run may ask for
  gpu: false, // whether runs may use the GPU at all
  // Across runs.
  max_jobs: 2, // runs at the same time; more wait in a queue
  // All runs together may use this many minutes of running time in any window of this many hours.
  // Two runs side by side for ten minutes count as twenty. This is what keeps an eager agent from
  // keeping the machine busy all day; a run's own limit is cut to what is left of it.
  compute_minutes: 60,
  compute_window_hours: 3,
  // Storage budgets, in GB.
  workspace_gb: 5, // one workspace; a run that takes it past this is stopped
  workspaces_total_gb: 20,
  data_gb: 20, // downloaded and imported data; least recently used files are dropped when full
  fetch_max_gb: 2, // one downloaded file
  // Archives the agent may download from by itself, with the request_data tool. A host on the list
  // covers its subdomains. Anything else needs the owner's own `fetch` command. An empty list turns
  // the agent's downloads off.
  // Every host on the default list was tested with a real download on 13 October 2026. Two archives
  // that might be expected here are left out because they refuse programs: Dryad (file downloads need
  // a login) and europepmc.org (its full texts are served to programs from ebi.ac.uk instead).
  data_sources: ['arxiv.org', 'zenodo.org', 'osf.io', 'figshare.com', 'ncbi.nlm.nih.gov', 'ebi.ac.uk', 'rcsb.org', 'huggingface.co'],
  data_requests_per_hour: 20,
  // Where `install` looks for a ready-made image of a pack before building it here. Empty: always build.
  registry: 'ghcr.io/problemhive/problemhive-tools-mcp',
  // Where workspaces live: "volume" (inside Docker, invisible to the rest of the machine) or the
  // path of a folder on this machine. Downloaded data is always in a Docker volume.
  workspaces: 'volume',
  trash_days: 7, // deleted files are kept this long
  stale_days: 30, // workspaces untouched this long are listed as stale
  auto_remove_stale: false, // if true, "clean" removes stale workspaces without being asked for each
};

export function loadConfig() {
  let file = {};
  try {
    file = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw new Error(`Cannot read ${CONFIG_FILE}: ${e.message}`);
  }
  const c = { ...DEFAULTS, ...file };
  for (const k of ['cpus', 'memory_gb', 'minutes', 'max_minutes', 'max_jobs', 'compute_minutes', 'compute_window_hours', 'workspace_gb', 'workspaces_total_gb', 'data_gb', 'fetch_max_gb', 'data_requests_per_hour', 'trash_days', 'stale_days']) {
    if (typeof c[k] !== 'number' || !(c[k] > 0)) throw new Error(`${CONFIG_FILE}: "${k}" must be a number above 0.`);
  }
  if (!Array.isArray(c.data_sources) || c.data_sources.some((s) => typeof s !== 'string')) throw new Error(`${CONFIG_FILE}: "data_sources" must be a list of host names.`);
  if (c.workspaces !== 'volume' && !path.isAbsolute(String(c.workspaces))) throw new Error(`${CONFIG_FILE}: "workspaces" must be "volume" or the full path of a folder.`);
  return c;
}

export function ensureHome() {
  fs.mkdirSync(JOBS, { recursive: true });
  if (!fs.existsSync(CONFIG_FILE)) fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULTS, null, 2) + '\n');
}

export const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};
export const writeJson = (file, value) => {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
};
/** A size for people to read: 512 bytes, 34 KB, 2.1 MB, 1.64 GB. */
export const gb = (bytes) =>
  bytes < 1024 ? `${bytes} bytes` : bytes < 2 ** 20 ? `${Math.round(bytes / 1024)} KB` : bytes < 2 ** 30 ? `${(bytes / 2 ** 20).toFixed(1)} MB` : `${(bytes / 2 ** 30).toFixed(2)} GB`;
