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

// Words too common to tell tools apart, and the few short words that do.
const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'how', 'can', 'want', 'need', 'using', 'use', 'run', 'tool', 'check', 'some', 'all']);
const SHORT = new Set(['r', 'md', 'gp', 'lp', 'ml', 'qe', 'm2', 'go']);

/** The words of a text, lower-cased, plurals reduced, filler dropped. */
function words(text) {
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
    .filter((w) => (w.length > 2 || SHORT.has(w)) && !STOP.has(w));
}

/** Whether a word of the query and a word of a tool's text mean the same: equal, or one begins the other ("align", "alignment"). */
const same = (q, t) => q === t || (q.length >= 4 && t.startsWith(q)) || (t.length >= 4 && q.startsWith(t));

/**
 * Tools matching a plain-language query, best first. Whole words are compared, not fragments: a
 * word in a tool's name counts most, then in its keywords, then in its description, and a keyword
 * phrase that appears in the query as a whole ("mixed model") counts extra.
 */
export function findTools(query, limit = 8) {
  const q = words(query);
  const phrase = ' ' + q.join(' ') + ' ';
  const hits = [];
  for (const pack of allPacks()) {
    for (const tool of pack.tools) {
      const name = words(tool.name);
      const keys = words(tool.keywords.join(' '));
      const does = words(tool.does);
      let score = 0;
      for (const w of q) score += (name.some((t) => same(w, t)) ? 3 : 0) + (keys.some((t) => same(w, t)) ? 2 : 0) + (does.some((t) => same(w, t)) ? 1 : 0);
      for (const k of tool.keywords) {
        const kw = words(k);
        if (kw.length > 1 && phrase.includes(' ' + kw.join(' ') + ' ')) score += 3;
      }
      if (score) hits.push({ score, pack: pack.name, tool });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
