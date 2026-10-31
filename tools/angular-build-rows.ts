/**
 * The `@angular/build` releases the supported Angular rows install, read from their lockfiles.
 *
 * Thoth's builders wrap the builders of this package, so their option schemas are generated from
 * every release a row pins, and the npm cache is staged with each of them so the generator reads
 * them offline. The lockfiles are found rather than listed, as `stage-consumer-store.ts` finds them:
 * a row added later is read the day its lockfile lands.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compareVersions } from './supported-versions.ts';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The `@angular/build` builder each Thoth builder's target runs, as the documentation names them. */
export const WRAPPED = Object.freeze({
  build: 'application',
  serve: 'dev-server',
  test: 'unit-test',
} as const);

/** One pinned release, and the digest its tarball has to match. */
export interface AngularBuildRow {
  readonly version: string;
  readonly integrity: string;
  /** The lockfiles that pin it, relative to the repository. */
  readonly lockfiles: readonly string[];
}

const PINNED =
  /^ {2}'@angular\/build@(\d+\.\d+\.\d+)':\n {4}resolution: \{integrity: (sha512-[A-Za-z0-9+/=]+)\}/gmu;

/** Every `@angular/build` release a committed fixture lockfile pins, lowest first. */
export function angularBuildRows(): readonly AngularBuildRow[] {
  const lockfiles = execFileSync(
    'git',
    ['ls-files', 'fixtures/**/pnpm-lock.yaml'],
    { cwd: workspaceRoot, encoding: 'utf8' },
  )
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const rows = new Map<string, { integrity: string; lockfiles: string[] }>();
  for (const lockfile of lockfiles) {
    const text = readFileSync(resolve(workspaceRoot, lockfile), 'utf8');
    for (const [, version, integrity] of text.matchAll(PINNED)) {
      // The capture groups above are both required, so each is present.
      const row = rows.get(version!);
      if (row === undefined) {
        rows.set(version!, { integrity: integrity!, lockfiles: [lockfile] });
        continue;
      }
      assert.equal(
        row.integrity,
        integrity,
        `${lockfile} and ${row.lockfiles[0]} pin @angular/build@${version} with different digests, so one of them names another tarball.`,
      );
      row.lockfiles.push(lockfile);
    }
  }
  const developed = (
    JSON.parse(
      readFileSync(resolve(workspaceRoot, 'package.json'), 'utf8'),
    ) as {
      readonly devDependencies?: Readonly<Record<string, string>>;
    }
  ).devDependencies?.['@angular/build'];
  // A search that reads nothing would hand the generator no builder to wrap, and the schemas would
  // come out holding Thoth's own options only. The development row is the one row known to exist.
  assert.ok(
    developed !== undefined && rows.has(developed),
    `No fixture lockfile pins @angular/build@${developed}, the release the repository develops on, so the lockfiles are read wrongly.`,
  );
  return Object.freeze(
    [...rows]
      .map(([version, row]) =>
        Object.freeze({
          version,
          integrity: row.integrity,
          lockfiles: Object.freeze(row.lockfiles.sort()),
        }),
      )
      .sort((left, right) => compareVersions(left.version, right.version)),
  );
}
