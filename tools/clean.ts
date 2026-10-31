import { rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { emptyWorkingRoot } from './working-state.ts';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const remove = (path: string): Promise<void> =>
  rm(path, { force: true, recursive: true });

/**
 * What a clean may remove, and why `build` asks for one of them by name.
 *
 * `dist` is the build's own output, removed first so a package cannot be assembled from a file an
 * earlier state of the tree produced. `tmp` is the gate's working directory, emptied of everything
 * a run can produce again and nothing else (`emptyWorkingRoot` in `working-state.ts` says what
 * stays).
 *
 * `build` names `dist` alone because one gate stage builds after a consumer has been materialized
 * under `tmp`, rebuilding the packages once per injection and handing each build to that consumer.
 * A build that emptied `tmp` would delete the consumer it is about to install into.
 */
const REMOVABLE = {
  dist: () => remove(resolve(workspaceRoot, 'dist')),
  tmp: () => emptyWorkingRoot(),
};

const names = Object.keys(REMOVABLE);
const requested = process.argv.slice(2);
const unknown = requested.filter((name) => !names.includes(name));
if (unknown.length > 0) {
  throw new Error(
    `Nothing here is called ${unknown.join(', ')}. A clean removes ${names.join(' or ')}, and naming neither removes both.`,
  );
}

for (const name of requested.length > 0 ? requested : names) {
  await REMOVABLE[name as keyof typeof REMOVABLE]();
}
