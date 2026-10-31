/**
 * `verify:clean:self-test`: what `pnpm run clean` keeps in `tmp`, on a planted folder.
 *
 * A clean empties the gate's working directory of everything a run can produce again. Two things
 * in it are not output and are kept:
 *
 * - the attempt ledger, for the reason `working-state.ts` gives;
 * - the cap's state folder, `tmp/cap` (`tools/cap.ts`), whole: the mode, which changes only when
 *   the machine's owner says so, and the files of a command that may be running while the clean
 *   runs. A clean that took the folder would put the cap back in day mode without a word, and take
 *   a running command's state from under it. A folder `THOTH_CAP_DIRECTORY` names is kept too,
 *   wherever under `tmp` it lies.
 *
 * Everything else goes, at any depth, and `tmp` itself stays. The emptying is the function
 * `clean.ts` runs (`emptyWorkingRoot`), handed a planted folder, so this never touches the real
 * `tmp`.
 */
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { emptyWorkingRoot, keptPaths, workingRoot } from './working-state.ts';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const root = mkdtempSync(join(tmpdir(), 'clean-self-test-'));
try {
  const plant = (path: string, text: string): void => {
    mkdirSync(dirname(resolve(root, path)), { recursive: true });
    writeFileSync(resolve(root, path), text);
  };
  const kept: Record<string, string> = {
    'verify-ledger.jsonl': '{"run":1}\n',
    'cap/mode.txt': 'night',
    'cap/priority-level.txt': 'normal',
    'cap/job-state.json': '{"command":"a running command"}',
    'cap/stepper.json': '{}',
    'readings/second-cap/mode.txt': 'efficiency',
    'readings/second-cap/job-name.txt': 'AnotherCap',
  };
  const removed = [
    'verify-run/summary.txt',
    'consumer/node_modules/a/index.js',
    'loose.log',
    'readings/report.json',
    'capture/mode.txt',
  ];
  for (const [path, text] of Object.entries(kept)) plant(path, text);
  for (const path of removed) plant(path, 'output');

  await emptyWorkingRoot(
    root,
    keptPaths(root, {
      THOTH_CAP_DIRECTORY: resolve(root, 'readings/second-cap'),
    }),
  );

  assert.ok(existsSync(root), 'The working directory itself stays.');
  for (const [path, text] of Object.entries(kept)) {
    assert.ok(
      existsSync(resolve(root, path)),
      `A clean keeps ${path}: the ledger, the cap's folder and a folder THOTH_CAP_DIRECTORY names stay whole.`,
    );
    assert.equal(
      readFileSync(resolve(root, path), 'utf8'),
      text,
      `A clean leaves ${path} as it was.`,
    );
  }
  for (const path of removed) {
    assert.ok(
      !existsSync(resolve(root, path)),
      `A clean removes ${path}, which a run produces again.`,
    );
  }
  assert.deepEqual(
    readdirSync(resolve(root, 'readings')),
    ['second-cap'],
    'A folder that holds a kept folder is emptied around it.',
  );
  assert.ok(
    keptPaths(workingRoot, {}).includes(resolve(workspaceRoot, 'tmp/cap')),
    'The folder kept is the one the cap reads with no THOTH_CAP_DIRECTORY: tmp/cap.',
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}

process.stdout.write(
  'Clean self-test passed: a clean empties tmp of what a run produces again and keeps the attempt ledger, the cap folder tmp/cap whole and a folder THOTH_CAP_DIRECTORY names.\n',
);
