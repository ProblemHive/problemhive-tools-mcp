// Tool search: a plain description should put the right tool first. No Docker needed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findTools } from '../src/packs.js';

const CASES = [
  ['check a SAT proof of unsatisfiability', 'drat-trim'],
  ['mixed model in R', 'lme4 and nlme'],
  ['random-effects meta-analysis', 'metafor'],
  ['align protein sequences', 'mafft, muscle, clustalo'],
  ['orbit of a planet', 'rebound'],
  ['dft energy of a molecule', 'pyscf'],
  ['spiking neural network', 'brian2'],
  ['netcdf climate mean', 'xarray, netcdf'],
  ['model check a concurrent protocol', 'spin'],
  ['groebner basis of an ideal', 'singular'],
  ['does this lean proof compile', 'lean-check'],
  ['sparse autoencoder features', 'sae-lens'],
  ['survival analysis cox model', 'survival'],
  ['phylogenetic tree maximum likelihood', 'iqtree, fasttree'],
  ['quantum circuit simulator', 'qiskit'],
  ['space group of a crystal', 'pymatgen, spglib, phonopy'],
];

test('a plain description finds the right tool first', () => {
  const wrong = [];
  for (const [query, expected] of CASES) {
    const top = findTools(query, 3).map((h) => h.tool.name);
    if (top[0] !== expected) wrong.push(`${query} -> ${top.join(' | ')} (wanted ${expected})`);
  }
  assert.deepEqual(wrong, []);
  assert.deepEqual(findTools('zzzqqq'), []);
});
