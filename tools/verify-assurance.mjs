/**
 * Does the suite still fail when it should?
 *
 * A test that cannot fail is worse than an absent one: it reports a guarantee nobody is holding.
 * One was found here: the fixture built to prove Equator honors a consumer's `paths` and strictness
 * kept passing when every one of those behaviors was removed, because it asserted on an outcome
 * flag and one severity while the regressions reported through another channel. The finding is not
 * that one assertion was wrong. It is that nothing was checking whether the checks work.
 *
 * So this gate removes a behavior and requires the named test to notice. Each entry names the
 * invariant in its own words, so a failure here says what stopped being guarded rather than only
 * that a string no longer matched.
 *
 * This is a declared list, not exhaustive mutation testing. It grows when a defect is fixed and the
 * fix deserves a guard that is itself guarded.
 *
 * Every injection here patches a module and runs one vitest file, which is why it is seconds rather
 * than minutes. That is a property of the invariant, not of the package: it holds for any module
 * whose import graph reaches no Angular symbol at runtime, so the runtime's pure modules belong
 * here too. `verify-assurance-runtime.mjs` keeps the ones that genuinely need a built package
 * inside a materialized consumer.
 *
 * `specs/12-verification.spec.md` section 9 states the rule this gate is: withdraw the behavior
 * a check guards and require the check to notice, because a check nobody has seen fail is
 * indistinguishable from one that cannot.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { injections } from './assurance-injections.mjs';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function runTests(testFile) {
  const result = spawnSync(
    process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'npx',
    process.platform === 'win32'
      ? ['/d', '/s', '/c', 'npx', 'vitest', 'run', testFile]
      : ['vitest', 'run', testFile],
    {
      cwd: workspaceRoot,
      encoding: 'utf8',
      env: { ...process.env, CI: 'true', NO_COLOR: '1' },
      maxBuffer: 8_388_608,
      timeout: 300_000,
    },
  );
  return result.status === 0;
}

const missed = [];
for (const injection of injections) {
  const path = resolve(workspaceRoot, injection.source);
  const original = await readFile(path, 'utf8');
  const occurrences = original.split(injection.find).length - 1;
  assert.equal(
    occurrences,
    1,
    `Injection ${injection.id} no longer matches ${injection.source}. The code moved; update the injection so the invariant stays checked rather than silently unchecked.`,
  );
  try {
    await writeFile(
      path,
      original.split(injection.find).join(injection.replace),
      'utf8',
    );
    const caught = !runTests(injection.caughtBy);
    process.stdout.write(
      `${caught ? 'caught ' : 'MISSED '} ${injection.id}\n          ${injection.invariant}\n`,
    );
    if (!caught) missed.push(injection);
  } finally {
    await writeFile(path, original, 'utf8');
    assert.equal(
      await readFile(path, 'utf8'),
      original,
      `Failed to restore ${injection.source} after injection ${injection.id}.`,
    );
  }
}

if (missed.length > 0) {
  process.stderr.write(
    `\n${missed.length} invariant(s) are not guarded by the test named for them:\n${missed
      .map(
        ({ id, invariant, caughtBy }) =>
          `  ${id}\n    ${invariant}\n    ${caughtBy} passed with the behaviour removed.\n`,
      )
      .join('')}`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `\nAssurance verified: ${injections.length} removed behaviours were each caught by the test named for them.\n`,
  );
}
