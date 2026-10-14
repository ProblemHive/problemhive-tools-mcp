// Which addresses count as an approved source. No Docker needed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sourceAllowed } from '../src/data.js';

const cfg = { data_sources: ['arxiv.org', 'raw.githubusercontent.com/ProblemHive/archive/'] };

test('a host covers itself and its subdomains, and nothing else', () => {
  assert.ok(sourceAllowed(cfg, 'https://arxiv.org/pdf/2401.00001'));
  assert.ok(sourceAllowed(cfg, 'https://export.arxiv.org/abs/2401.00001'));
  assert.ok(!sourceAllowed(cfg, 'https://notarxiv.org/pdf/1'));
  assert.ok(!sourceAllowed(cfg, 'https://arxiv.org.example.com/pdf/1'));
});

test('a host with a path covers only addresses under that path', () => {
  assert.ok(sourceAllowed(cfg, 'https://raw.githubusercontent.com/ProblemHive/archive/main/combinatorics/002lf-x/files/c-abc/search.py'));
  assert.ok(sourceAllowed(cfg, 'https://raw.githubusercontent.com/problemhive/archive/main/README.md'));
  assert.ok(!sourceAllowed(cfg, 'https://raw.githubusercontent.com/someone/else/main/run.sh'));
  assert.ok(!sourceAllowed(cfg, 'https://raw.githubusercontent.com/ProblemHive/archive-evil/main/x'));
  assert.ok(!sourceAllowed(cfg, 'https://raw.githubusercontent.com/ProblemHive/archive/main/%2e%2e/%2e%2e/someone/else/x'));
});
