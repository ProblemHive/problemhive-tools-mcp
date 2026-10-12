// Packs: one optional set of tools each, built as a Docker image on top of the base pack. A pack is
// a folder under packs/ with a Dockerfile and a pack.json that lists its tools. Every tool has a
// "check" command and the text its output must contain; `test` runs them, so the catalogue cannot
// promise a tool that does not work.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, STATE, readJson, writeJson } from './config.js';
import { docker } from './docker.js';

const DIR = path.join(ROOT, 'packs');
const MEASURED = path.join(STATE, 'packs.json');

export function allPacks() {
  return fs
    .readdirSync(DIR)
    .filter((d) => fs.existsSync(path.join(DIR, d, 'pack.json')))
    .map((d) => {
      const p = JSON.parse(fs.readFileSync(path.join(DIR, d, 'pack.json'), 'utf8'));
      return { ...p, dir: path.join(DIR, d), image: `problemhive-sandbox-${p.name}:${p.version}` };
    })
    .sort((a, b) => (a.name === 'base' ? -1 : b.name === 'base' ? 1 : a.name.localeCompare(b.name)));
}

export const getPack = (name) => allPacks().find((p) => p.name === name) ?? null;

/** The image's id and size if this pack is installed, or null. */
export async function installed(pack) {
  const r = await docker(['image', 'inspect', '--format', '{{.Id}} {{.Size}}', pack.image]);
  if (r.code !== 0) return null;
  const [id, size] = r.out.toString().trim().split(' ');
  return { id, size: Number(size) };
}

/** What the last install measured for each pack: size on disk and whether its tools passed their checks. */
export const measured = () => readJson(MEASURED, {});
export function recordMeasured(name, value) {
  const all = measured();
  all[name] = value;
  writeJson(MEASURED, all);
}

/**
 * Tools matching a plain-language query, best first. Words in a tool's name count most, then its
 * keywords, then its description.
 */
export function findTools(query, limit = 8) {
  const words = String(query).toLowerCase().split(/[^a-z0-9+#-]+/).filter((w) => w.length > 1);
  const hits = [];
  for (const pack of allPacks()) {
    for (const tool of pack.tools) {
      const name = tool.name.toLowerCase();
      const keys = tool.keywords.join(' ').toLowerCase();
      const does = tool.does.toLowerCase();
      let score = 0;
      for (const w of words) score += (name.includes(w) ? 3 : 0) + (keys.includes(w) ? 2 : 0) + (does.includes(w) ? 1 : 0);
      if (score) hits.push({ score, pack: pack.name, tool });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
