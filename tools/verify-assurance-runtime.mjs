/**
 * Does the runtime's suite still fail when the runtime stops doing something?
 *
 * `verify-assurance.mjs` asks that question by injecting into a source file and running the
 * workspace vitest file named for the invariant, in seconds. The runtime's pure modules have such
 * tests, and their injections live in that file because they cost seconds there.
 *
 * What stays here is everything a workspace test cannot see: wiring, hydration, providers, the
 * document, the URL. Proving those means the built package inside the materialized consumer, so an
 * injection here has to rebuild the package, refresh the consumer's copy of it, and run the
 * consumer's own suite. That needs the consumer to exist, so this runs after `verify:consumer`
 * rather than as more rows in the other file's list.
 *
 * What the reach is worth is `route-scopes-not-derived` below. `derivedScopes` returning an empty
 * list disables scope loading on activation outright, and nothing a workspace test can reach moves:
 * the defect shows only in a consumer that renders. A guard nobody has watched fail is a claim
 * about the guard.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { withOfflineStoreRemedy } from './offline-store.mjs';
import {
  refreshCommand,
  refreshConsumerPackages,
} from './refresh-consumer-packages.mjs';

import { injections } from './assurance-runtime-injections.mjs';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const consumerRoot = resolve(
  workspaceRoot,
  'tmp/package-consumer-verification/package-consumer',
);

function run(command, args, cwd) {
  const windows = process.platform === 'win32';
  return spawnSync(
    windows ? (process.env.ComSpec ?? 'cmd.exe') : command,
    windows ? ['/d', '/s', '/c', command, ...args] : args,
    {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, CI: 'true', NO_COLOR: '1' },
      maxBuffer: 16_777_216,
      timeout: 600_000,
    },
  );
}

function shell(command, args, cwd) {
  return run(command, args, cwd).status === 0;
}

/**
 * A step this gate depends on rather than measures, asserted with what the child actually said.
 *
 * `shell` answers with a boolean because most of what it runs is a suite that is *expected* to
 * fail, and the failing is the measurement. These are the other kind (a build, an install, a
 * materialization) where a non-zero exit ends the run and the only useful thing left on the
 * screen is the reason. The boolean threw that away: the first Linux run failed on the refresh
 * below and reported one sentence of this file's own prose, with nothing from pnpm.
 */
function required(command, args, cwd, why) {
  requireOk(run(command, args, cwd), `${command} ${args.join(' ')}`, cwd, why);
}

/** The same report for a step that is defined, and so run, somewhere else. */
function requireOk(result, description, cwd, why) {
  if (result.status === 0) return;
  const tail = (stream) => {
    const text = String(stream ?? '').trimEnd();
    return text === '' ? '(nothing)' : text.split('\n').slice(-20).join('\n');
  };
  assert.fail(
    withOfflineStoreRemedy(
      `${why}\n` +
        `  ran: ${description}\n` +
        `  in: ${cwd}\n` +
        `  exit ${result.status ?? 'null'}` +
        `${result.signal === null || result.signal === undefined ? '' : `, killed by ${result.signal}`}` +
        `${result.error === undefined ? '' : `, ${String(result.error)}`}\n` +
        `--- its last 20 lines of stdout ---\n${tail(result.stdout)}\n` +
        `--- its last 20 lines of stderr ---\n${tail(result.stderr)}`,
    ),
  );
}

/** Hand the consumer the package that was just built. */
function refreshConsumer(why) {
  requireOk(
    refreshConsumerPackages(consumerRoot),
    refreshCommand,
    consumerRoot,
    why,
  );
}

/**
 * The suite that can observe the invariant, which is not always the same suite.
 *
 * Most of these are visible to the consumer's own tests. Scroll and focus are not: they need a
 * real browser moving a real page, so that injection names the browser gate instead. It costs a
 * browser run per injection, which is why it is named rather than assumed.
 */
function suitePasses(suite) {
  required(
    'pnpm',
    ['run', 'build'],
    workspaceRoot,
    'The workspace did not build with the injection applied, so nothing was proven. A `TS6133 ' +
      'is declared but its value is never read` here is this file to fix, not the runtime: ' +
      'Equator compiles with `noUnusedLocals` and `noUnusedParameters`, so an injection that ' +
      'removes the only reader of a local or a parameter cannot compile. Reference it with ' +
      '`void`, the way the injections above do, or widen the replacement to take the reader ' +
      'out with it.',
  );
  refreshConsumer(
    'The materialized consumer did not take the rebuilt package.',
  );
  if (suite !== 'browser') return shell('pnpm', ['test'], consumerRoot);

  // The browser gate serves the consumer's already-built Angular bundle. Refreshing the package in
  // `node_modules` does not rebuild that bundle, so without this the browser would run the old
  // Equator and every browser-named injection would report itself unguarded. Re-materializing
  // installs the injected build and rebuilds the application.
  //
  // Materializing is asserted rather than folded into the `&&` chain, and the reason is a false
  // result this gate actually produced. `verify:consumer` materializes *and* runs the suite, so a
  // `pnpm run verify:consumer` that dies in `rmdir` (which it does on Windows whenever
  // anything still holds the consumer directory) returns non-zero, and a non-zero suite is
  // what this function calls a catch. One run reported `deferred-content-hydrates-in-the-stale-locale`,
  // an injection since removed along with the directive it targeted, as caught on that basis;
  // run again with the two steps separated it was MISSED, which was the true answer and the finding
  // that ended the directive. A gate that cannot tell "the suite failed" from "the suite could not run" reports
  // coverage it does not have, which is the one thing it exists not to do.
  required(
    'pnpm',
    ['run', 'materialize:consumer'],
    workspaceRoot,
    'Materializing the consumer failed. That is an infrastructure failure, not a caught mutation, and it must stop the run rather than be counted as coverage.',
  );
  return (
    shell('node', ['./tools/verify-package-consumer.mjs'], workspaceRoot) &&
    shell('pnpm', ['run', 'verify:browser-assurance'], workspaceRoot)
  );
}

/**
 * The consumer has to exist before the first injection, and this stage is the only thing that can
 * be sure it does.
 *
 * Sharing a tree with `verify:consumer` makes it sure by accident, on the gate graph happening to
 * order them. Running in a tree of its own means nothing is here that this file did not put here,
 * which is the property that makes mutating tracked source safe, and it cuts both ways. So the
 * preparation is explicit: build, materialize, once, before the first injection rather than per
 * injection.
 *
 * Guarded by `existsSync` rather than run unconditionally, because the same file still has to work
 * when someone runs it by hand in a tree that already has a consumer, and that is the ~80s case.
 */
if (!existsSync(consumerRoot)) {
  process.stdout.write(
    'No materialized consumer in this tree; building and materializing one.\n',
  );
  required(
    'pnpm',
    ['run', 'build'],
    workspaceRoot,
    'The workspace did not build, so there is nothing to hand a consumer.',
  );
  required(
    'pnpm',
    ['run', 'materialize:consumer'],
    workspaceRoot,
    'Materializing the consumer failed before any injection was applied. That is an infrastructure failure and it must stop the run rather than be reported as coverage.',
  );
}

/** Guarded by nothing and not known to be: the failure this gate exists to report. */
const missed = [];
/** Guarded by nothing, recorded as such, and said out loud on every run. */
const known = [];
/** Recorded as a gap and no longer one, which means the record is what needs correcting. */
const closed = [];
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
    const caught = !suitePasses(injection.suite);
    const label = caught
      ? injection.knownGap === undefined
        ? 'caught '
        : 'CLOSED '
      : injection.knownGap === undefined
        ? 'MISSED '
        : 'known  ';
    process.stdout.write(
      `${label} ${injection.id}\n          ${injection.invariant}\n`,
    );
    // A recorded gap that starts being caught is a marker to delete, and saying so is the only
    // thing that stops the list becoming a place where findings go to be forgotten.
    if (caught && injection.knownGap !== undefined) closed.push(injection);
    if (!caught && injection.knownGap === undefined) missed.push(injection);
    if (!caught && injection.knownGap !== undefined) known.push(injection);
  } finally {
    await writeFile(path, original, 'utf8');
    assert.equal(
      await readFile(path, 'utf8'),
      original,
      `Failed to restore ${injection.source} after injection ${injection.id}.`,
    );
  }
}

// The consumer is left holding whichever build ran last, which is an injected one whenever this
// gate fails. Restored unconditionally so a later gate cannot inherit a package nobody meant to
// publish.
required(
  'pnpm',
  ['run', 'build'],
  workspaceRoot,
  'The workspace did not rebuild after the injections were restored.',
);
refreshConsumer(
  'The materialized consumer was left holding an injected build.',
);

if (known.length > 0) {
  process.stdout.write(
    `\n${known.length} recorded gap(s), guarded by nothing and known to be:\n${known
      .map(({ id, knownGap }) => `  ${id}\n    ${knownGap}\n`)
      .join('')}`,
  );
}

// A recorded gap that starts being caught is a marker to delete. Failing on it is what stops the
// list turning into a place findings go to be forgotten.
if (closed.length > 0) {
  process.stderr.write(
    `\n${closed.length} recorded gap(s) are now guarded. Delete the knownGap marker so the guard is required from here:\n${closed
      .map(({ id }) => `  ${id}\n`)
      .join('')}`,
  );
  process.exitCode = 1;
}

if (missed.length > 0) {
  process.stderr.write(
    `\n${missed.length} runtime invariant(s) are guarded by nothing:\n${missed
      .map(
        ({ id, invariant }) =>
          `  ${id}\n    ${invariant}\n    The consumer suite passed with the behaviour removed.\n`,
      )
      .join('')}`,
  );
  process.exitCode = 1;
} else if (closed.length === 0) {
  process.stdout.write(
    `\n${injections.length - known.length} of ${injections.length} runtime invariants are guarded by a suite that notices when they stop holding.\n`,
  );
}
