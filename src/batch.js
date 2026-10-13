// Batch plans. A large computation is cut into batches that each finish; the plan says how one
// batch is run, and a control case with a known answer says whether the setup works at all.
// A plan is a small JSON file in the workspace (by default plan.json):
//
//   {
//     "plan": "c/abc123",                       where the plan was posted (optional)
//     "pack": "base",                           which pack the batches run in
//     "minutes": 10,                            time limit for one batch
//     "files": ["search.py"],                   what a batch reads, for the run record
//     "control": { "command": "python search.py 10 12", "expect": "found 3" },
//     "command": "python search.py {from} {to}",
//     "batches": { "B01": { "from": 150, "to": 199 }, "B02": { "from": 200, "to": 249 } }
//   }
//
// The values of a batch go into the command where their names stand in braces; {batch} is the id.
// Values may hold only letters, digits and a few signs, so a plan cannot smuggle shell syntax in
// through its list of batches. The command itself is the plan author's and must be read like any
// other code before it is run.
import { UserError } from './storage.js';

const ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,19}$/;
const VALUE = /^[A-Za-z0-9_.,:=+@/-]{0,100}$/;

export function parsePlan(text) {
  let p;
  try {
    p = JSON.parse(text);
  } catch (e) {
    throw new UserError(`The plan file is not valid JSON: ${e.message}`);
  }
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new UserError('The plan file must hold one JSON object.');
  if (typeof p.command !== 'string' || !p.command.trim() || p.command.length > 2000) throw new UserError('The plan needs "command": how one batch is run, with the batch\'s values in braces, for example "python search.py {from} {to}".');
  if (!p.batches || typeof p.batches !== 'object' || Array.isArray(p.batches)) throw new UserError('The plan needs "batches": an object from batch id to that batch\'s values, for example {"B01": {"from": 150, "to": 199}}.');
  const ids = Object.keys(p.batches);
  if (ids.length === 0 || ids.length > 500) throw new UserError('A plan has between 1 and 500 batches.');
  for (const id of ids) {
    if (!ID.test(id)) throw new UserError(`Batch id "${id}" is not usable: up to 20 letters, digits, dots, dashes or underscores.`);
    const values = p.batches[id];
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw new UserError(`Batch ${id} must be an object of values.`);
    for (const [k, v] of Object.entries(values)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,30}$/.test(k)) throw new UserError(`Batch ${id}: "${k}" is not a usable name for a value.`);
      if (!(typeof v === 'number' && Number.isFinite(v)) && !(typeof v === 'string' && VALUE.test(v))) {
        throw new UserError(`Batch ${id}: the value of "${k}" must be a number, or text of letters, digits and . , : = + @ / - only (no spaces or quotes).`);
      }
    }
  }
  if (p.control !== undefined) {
    if (!p.control || typeof p.control.command !== 'string' || typeof p.control.expect !== 'string' || !p.control.expect) throw new UserError('"control" needs "command" (a quick run with a known answer) and "expect" (text its output must contain).');
  }
  if (p.files !== undefined && (!Array.isArray(p.files) || p.files.some((f) => typeof f !== 'string'))) throw new UserError('"files" is a list of file paths.');
  for (const m of p.command.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) {
    if (m[1] !== 'batch' && ids.some((id) => !(m[1] in p.batches[id]))) throw new UserError(`The command uses {${m[1]}}, but not every batch gives a value for it.`);
  }
  return {
    plan: typeof p.plan === 'string' ? p.plan.slice(0, 60) : '',
    pack: typeof p.pack === 'string' ? p.pack : 'base',
    minutes: Number(p.minutes) > 0 ? Number(p.minutes) : undefined,
    gpu: p.gpu === true,
    files: p.files ?? [],
    control: p.control,
    command: p.command,
    batches: p.batches,
  };
}

/** The command for one batch: the plan's command with that batch's values filled in. */
export function batchCommand(plan, id) {
  const values = plan.batches[id];
  return plan.command.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_m, k) => (k === 'batch' ? id : String(values[k])));
}
