/**
 * `verify:assurance:self-test`: the fast assurance runner, shown telling a catch from everything
 * that only looks like one.
 *
 * Four planted injections go through the runner `verify:assurance` uses (`assurance-runner.mjs`):
 *
 * - a real one, whose test must fail: `caught`;
 * - one that changes nothing the test observes: `passed`, which the stage reports as unguarded;
 * - one that makes the module throw as it loads, so the test file fails with no test run;
 * - one naming a test file that does not exist.
 *
 * The last two exit non-zero exactly as a catch does, and must come back `unmeasured`. A runner
 * that read the exit status alone would call both caught, and every entry in the map resting on the
 * fast harness would then rest on a guard nobody had seen run.
 */
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { injections } from './assurance-injections.mjs';
import { measureInjection } from './assurance-runner.mjs';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const real = injections.find(({ id }) => id === 'consumer-paths-discarded');
assert.ok(
  real !== undefined,
  'The injection this self-test plants beside is gone; plant beside another.',
);
const LOAD_ANCHOR = "import { readFileSync } from 'node:fs';";

const planted = [
  { expect: 'caught', injection: real },
  {
    expect: 'passed',
    injection: {
      ...real,
      id: 'planted-comment',
      replace: `${real.find}\n    // Planted by the self-test; changes nothing a test can see.`,
    },
  },
  {
    expect: 'unmeasured',
    injection: {
      ...real,
      id: 'planted-load-failure',
      find: LOAD_ANCHOR,
      replace: `${LOAD_ANCHOR}\nthrow new Error('Planted by the self-test: the module fails to load.');`,
    },
  },
  {
    expect: 'unmeasured',
    injection: {
      ...real,
      id: 'planted-missing-test',
      caughtBy:
        'packages/toolkit/test/planted-by-the-assurance-self-test.test.ts',
    },
  },
];

const wrong = [];
for (const { expect, injection } of planted) {
  const outcome = await measureInjection(workspaceRoot, injection);
  process.stdout.write(
    `${injection.id}: ${outcome.verdict}${outcome.why === undefined ? '' : ` (${outcome.why})`}\n`,
  );
  if (outcome.verdict !== expect) {
    wrong.push(`${injection.id} came back ${outcome.verdict}, not ${expect}`);
  }
}

assert.deepEqual(
  wrong,
  [],
  `The assurance runner misclassified planted injections:\n  ${wrong.join('\n  ')}`,
);
process.stdout.write(
  `\nverify:assurance:self-test GREEN: the runner caught the real injection, reported the inert one as unguarded, and refused to count a module that never loaded or a test that does not exist as a catch.\n`,
);
