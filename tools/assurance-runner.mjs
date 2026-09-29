/**
 * One fast-harness injection, applied and measured.
 *
 * `verify:assurance` runs every declared injection through this, and its self-test runs planted
 * ones through the same code, so the classification the gate trusts is one that has been seen to
 * refuse a false catch.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * What the named test file did with the behaviour removed.
 *
 * `caught` only when that file ran and one of its tests failed. A missing file, a module that fails
 * to load, or a file with no tests exits non-zero too, and counting that as a catch reports a guard
 * that never ran. So it is `unmeasured`, which fails the stage on its own account, and the verdict is
 * read from Vitest's JSON report rather than from the exit status.
 */
function runTests(workspaceRoot, testFile) {
  // Inside the Vitest cache directory, which the stage already writes, so the report adds nothing
  // to what the stage declares.
  const reportPath = resolve(
    workspaceRoot,
    'node_modules/.vite/assurance-report.json',
  );
  rmSync(reportPath, { force: true });
  const args = [
    'vitest',
    'run',
    testFile,
    '--reporter=json',
    `--outputFile=${reportPath}`,
  ];
  const result = spawnSync(
    process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'npx',
    process.platform === 'win32' ? ['/d', '/s', '/c', 'npx', ...args] : args,
    {
      cwd: workspaceRoot,
      encoding: 'utf8',
      env: { ...process.env, CI: 'true', NO_COLOR: '1' },
      maxBuffer: 8_388_608,
      timeout: 300_000,
    },
  );
  const report = existsSync(reportPath)
    ? JSON.parse(readFileSync(reportPath, 'utf8'))
    : undefined;
  const target = resolve(workspaceRoot, testFile);
  const file = report?.testResults.find(({ name }) => resolve(name) === target);
  if (file === undefined) {
    return {
      verdict: 'unmeasured',
      why: `${testFile} did not run (exit ${result.status ?? 'null'}).`,
    };
  }
  if (file.assertionResults.some(({ status }) => status === 'failed')) {
    return { verdict: 'caught' };
  }
  if (result.status === 0 && file.assertionResults.length > 0) {
    return { verdict: 'passed' };
  }
  return {
    verdict: 'unmeasured',
    why: `${testFile} ran no test to a failure: ${file.message || `exit ${result.status ?? 'null'}`}`,
  };
}

/** Applies the injection, runs its test, and restores the source whatever happened. */
export async function measureInjection(workspaceRoot, injection) {
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
    return runTests(workspaceRoot, injection.caughtBy);
  } finally {
    await writeFile(path, original, 'utf8');
    assert.equal(
      await readFile(path, 'utf8'),
      original,
      `Failed to restore ${injection.source} after injection ${injection.id}.`,
    );
  }
}
