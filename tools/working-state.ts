import { readdir, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Where the gate works, and the two things in it that a clean keeps.
 *
 * Everything else under this directory is reproduced by running the gate again: the work trees,
 * the consumers it materializes, the traces, the logs and the summary are all output. The attempt
 * ledger is not. It is one line per run, and a recurring failure is counted by comparing its
 * occurrences across runs, so a clean that took the ledger would reset that count to zero with
 * nothing anywhere to rebuild it from.
 *
 * Nor is the cap's state folder (`tools/cap.ts`). It holds the mode, which changes only when the
 * machine's owner says so, and with no mode recorded the cap is in day mode, so a clean that took
 * the folder would change the mode without anyone asking. It also holds the state of a command
 * that may be running while the clean runs. The folder is kept whole, and so is a folder
 * `THOTH_CAP_DIRECTORY` names, the cap's other place for it.
 *
 * The names are here because two commands decide against them, and a rename that reached only one
 * of them would have `clean` delete the ledger without saying anything.
 */
export const workingRoot = resolve(workspaceRoot, 'tmp');
export const attemptLedgerPath = resolve(workingRoot, 'verify-ledger.jsonl');
/** The folder `tools/cap/cap-common.ps1` keeps the cap's state in when no other is named. */
export const capStatePath = resolve(workingRoot, 'cap');

/** What a clean of `root` keeps, as absolute paths. */
export function keptPaths(
  root: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string[] {
  const kept = [
    resolve(root, basename(attemptLedgerPath)),
    resolve(root, basename(capStatePath)),
  ];
  const named = environment['THOTH_CAP_DIRECTORY'];
  if (named !== undefined && named.trim() !== '') kept.push(resolve(named));
  return kept;
}

const sameOnThisSystem = (a: string, b: string): boolean =>
  process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;

/** Whether `path` lies below `folder`, not at it. */
function below(folder: string, path: string): boolean {
  const between = relative(folder, path);
  return between !== '' && !between.startsWith('..') && !isAbsolute(between);
}

/**
 * Empties `root` of everything but what `keptPaths` names. A folder that holds a kept path is
 * entered rather than removed, so what is kept may lie at any depth. An absent `root` is nothing to
 * clean rather than an error, because a clean is how a tree with no run behind it is asked for.
 */
export async function emptyWorkingRoot(
  root: string = workingRoot,
  kept: readonly string[] = keptPaths(root),
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = resolve(root, entry);
    if (kept.some((keep) => sameOnThisSystem(keep, path))) continue;
    if (kept.some((keep) => below(path, keep))) {
      await emptyWorkingRoot(path, kept);
      continue;
    }
    await rm(path, { force: true, recursive: true });
  }
}
