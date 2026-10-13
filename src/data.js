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
import { DATA_VOLUME, UserError, checkPath, dataRegistry, ensureData, evictData, helper, noteData } from './storage.js';

const DATA_LOG = path.join(HOME, 'data.log');

/**
 * For the archives on the default list: the addresses that answer a program. Shown to the agent,
 * because the obvious address (the page a person would open) is often the one that refuses.
 */
export const SOURCE_HINTS = {
  'arxiv.org': 'PDF: https://arxiv.org/pdf/<id>   page: https://export.arxiv.org/abs/<id>',
  'zenodo.org': 'record: https://zenodo.org/api/records/<id> (lists its files with their download links)',
  'osf.io': 'files of a project: https://api.osf.io/v2/nodes/<id>/files/osfstorage/ (each file has a download link)',
  'figshare.com': 'article: https://api.figshare.com/v2/articles/<id> (lists files with download_url)',
  'ncbi.nlm.nih.gov': 'records and PMC full text: https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=<pmc|pubmed|nuccore|protein>&id=<id>   files: https://ftp.ncbi.nlm.nih.gov/...   The PMC and PubMed web pages refuse programs.',
  'ebi.ac.uk': 'Europe PMC full text: https://www.ebi.ac.uk/europepmc/webservices/rest/<PMCID>/fullTextXML   search: .../rest/search?query=...&format=json   sequences: https://www.ebi.ac.uk/ena/browser/api/fasta/<accession>',
  'rcsb.org': 'structure: https://files.rcsb.org/download/<ID>.pdb or .cif',
  'huggingface.co': 'file of a model or dataset: https://huggingface.co/<name>/resolve/main/<file>',
};

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
  // Some sites answer an automated request with "200 OK" and a page that asks a browser to prove it
  // is human. That is a refusal dressed as a success: do not keep the page as if it were the file.
  const kind = await sniff(rel);
  if (kind === 'challenge') {
    await helper([`${DATA_VOLUME}:/data`], ['rm', '-f', '--', rel], { workdir: '/data' });
    const error = 'the site answered with a bot check (a page asking a browser to prove it is human), not with the file';
    fs.appendFileSync(DATA_LOG, JSON.stringify({ ...line, failed: error }) + '\n');
    throw new UserError(`Not downloaded: ${error}. That is a refusal of automated requests: nothing here tries to get past it. Many archives offer the same content through an interface meant for programs (an API or a file server); use that address if there is one.`);
  }
  const wanted = /\.pdf$/i.test(rel) ? 'pdf' : null;
  const warn = wanted && kind !== wanted ? ` Note: the name ends in .pdf, but what arrived is ${kind === 'html' ? 'a web page' : 'not a PDF'}. The address may be a page about the file and not the file itself.` : kind === 'html' ? ' Note: what arrived is a web page. If you wanted a data file or a PDF, the address may be a page about it and not the file itself.' : '';
  noteData(rel, { url: String(url), sha256, added: new Date().toISOString().slice(0, 10), at: Math.floor(Date.now() / 1000), how, ...(why ? { why } : {}) });
  fs.appendFileSync(DATA_LOG, JSON.stringify({ ...line, bytes: Number(size), sha256 }) + '\n');
  return { name: rel, size: Number(size), sha256, kind, text: `Saved as /data/${rel} (${gb(Number(size))}, sha256 ${sha256}).${warn}` };
}

/** What a downloaded file is, from its first bytes: 'pdf', 'html', 'challenge' (a bot-check page) or 'other'. */
async function sniff(rel) {
  const script =
    'h=$(head -c 12000 -- "$1" | tr -d "\\000" | tr "A-Z" "a-z"); html=0; case "$h" in *"<html"*|*"<!doctype html"*) html=1;; esac; ' +
    'if [ $html = 1 ] && printf %s "$h" | grep -qE "recaptcha|checking your browser|just a moment\\.\\.\\.|cf-chl|challenge-platform|captcha-delivery|verify you are human|are you a robot"; then echo challenge; ' +
    'elif [ "$(head -c 4 -- "$1")" = "%PDF" ]; then echo pdf; elif [ $html = 1 ]; then echo html; else echo other; fi';
  const r = await helper([`${DATA_VOLUME}:/data:ro`], ['sh', '-c', script, 'sh', rel], { workdir: '/data' });
  return r.out.toString().trim() || 'other';
}

/** How many downloads the agent has asked for in the last hour. */
export function requestsLastHour() {
  const since = Math.floor(Date.now() / 1000) - 3600;
  return Object.values(dataRegistry()).filter((e) => e.how === 'requested' && (e.at ?? 0) > since).length;
}
