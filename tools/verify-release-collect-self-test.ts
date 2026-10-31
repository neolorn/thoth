/**
 * `verify:release-collect:self-test`: `pnpm run release:collect` on planted checkouts and folders.
 *
 * The tool reads the manifests and `release/` of the checkout it sits in, so each case copies it
 * into a planted checkout of its own, with manifests and archives written here, and runs it there
 * on a planted folder. Never the real `release/` and never a real release folder.
 *
 * - Into a folder that does not exist, it writes the two archives and their `SHA256SUMS`, sorted
 *   by file name; run again, it changes nothing.
 * - Into a folder that holds an earlier release, it adds the archives beside it and its lines to
 *   `SHA256SUMS`, keeping every line already there byte for byte, and leaves the other files alone.
 * - Each refusal writes nothing: an archive missing, manifests that disagree, a `SHA256SUMS` that
 *   is not `<64 hex>  <name>` lines, a line naming an archive the folder lacks or whose bytes are
 *   not the line's, and a file of an archive's name with other bytes.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const tool = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'collect-release.ts',
);
const root = mkdtempSync(join(tmpdir(), 'release-collect-self-test-'));

const sha256 = (bytes: Buffer | string): string =>
  createHash('sha256').update(bytes).digest('hex');
const archiveNames = (version: string): readonly [string, string] => [
  `neolorn-thoth-${version}.tgz`,
  `neolorn-thoth-toolkit-${version}.tgz`,
];

let checkouts = 0;
/** A checkout holding this tool, manifests at `version`, and one archive per package. */
function checkout(
  version: string,
  change: {
    readonly toolkitVersion?: string;
    readonly withoutToolkitArchive?: boolean;
  } = {},
): string {
  const at = resolve(root, `checkout-${++checkouts}`);
  const write = (path: string, text: string): void => {
    mkdirSync(dirname(resolve(at, path)), { recursive: true });
    writeFileSync(resolve(at, path), text);
  };
  write('package.json', JSON.stringify({ type: 'module', version }));
  write('packages/runtime/package.json', JSON.stringify({ version }));
  write(
    'packages/toolkit/package.json',
    JSON.stringify({ version: change.toolkitVersion ?? version }),
  );
  const [runtime, toolkit] = archiveNames(version);
  write(`release/runtime/${version}/${runtime}`, `runtime archive ${version}`);
  if (change.withoutToolkitArchive === true) {
    mkdirSync(resolve(at, 'release/toolkit', version), { recursive: true });
  } else {
    write(
      `release/toolkit/${version}/${toolkit}`,
      `toolkit archive ${version}`,
    );
  }
  mkdirSync(resolve(at, 'tools'));
  copyFileSync(tool, resolve(at, 'tools/collect-release.ts'));
  return at;
}

function collect(
  at: string,
  folder: string,
): { status: number | null; output: string } {
  const run = spawnSync(
    process.execPath,
    [resolve(at, 'tools/collect-release.ts'), folder],
    { cwd: at, encoding: 'utf8' },
  );
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

/** Every file under `folder` with its bytes and modification time, or null where there is none. */
function snapshot(
  folder: string,
): Record<string, { sum: string; modified: number }> | null {
  if (!existsSync(folder)) return null;
  const files: Record<string, { sum: string; modified: number }> = {};
  for (const name of readdirSync(folder, { recursive: true }) as string[]) {
    const path = resolve(folder, name);
    if (statSync(path).isDirectory()) continue;
    files[name] = {
      sum: sha256(readFileSync(path)),
      modified: statSync(path).mtimeMs,
    };
  }
  return files;
}

const sumsLine = (name: string, text: string): string =>
  `${sha256(text)}  ${name}\n`;

try {
  // A folder that does not exist: both archives and their sums, sorted by name.
  const rc1 = checkout('1.0.0-rc.1');
  const folder = resolve(root, 'packages-folder');
  const first = collect(rc1, folder);
  assert.equal(first.status, 0, first.output);
  const [runtime1, toolkit1] = archiveNames('1.0.0-rc.1');
  const rc1Lines =
    sumsLine(runtime1, 'runtime archive 1.0.0-rc.1') +
    sumsLine(toolkit1, 'toolkit archive 1.0.0-rc.1');
  assert.equal(readFileSync(resolve(folder, 'SHA256SUMS'), 'utf8'), rc1Lines);
  assert.equal(
    readFileSync(resolve(folder, runtime1), 'utf8'),
    'runtime archive 1.0.0-rc.1',
  );

  // The same release again changes nothing, not even a modification time.
  const before = snapshot(folder);
  const again = collect(rc1, folder);
  assert.equal(again.status, 0, again.output);
  assert.deepEqual(
    snapshot(folder),
    before,
    'Collecting the same release again changes nothing.',
  );

  // A later release beside the earlier one, with a file of the folder's own left alone.
  writeFileSync(resolve(folder, 'STATUS.md'), 'status of the folder\n');
  const rc2 = checkout('1.0.0-rc.2');
  const second = collect(rc2, folder);
  assert.equal(second.status, 0, second.output);
  const [runtime2, toolkit2] = archiveNames('1.0.0-rc.2');
  const allLines = [
    sumsLine(runtime1, 'runtime archive 1.0.0-rc.1'),
    sumsLine(runtime2, 'runtime archive 1.0.0-rc.2'),
    sumsLine(toolkit1, 'toolkit archive 1.0.0-rc.1'),
    sumsLine(toolkit2, 'toolkit archive 1.0.0-rc.2'),
  ].join('');
  assert.equal(
    readFileSync(resolve(folder, 'SHA256SUMS'), 'utf8'),
    allLines,
    'A later release adds its lines to the ones there, the whole sorted by file name.',
  );
  assert.deepEqual(
    readdirSync(folder).sort(),
    [runtime1, runtime2, toolkit1, toolkit2, 'SHA256SUMS', 'STATUS.md'].sort(),
  );
  assert.equal(
    readFileSync(resolve(folder, 'STATUS.md'), 'utf8'),
    'status of the folder\n',
  );
  const both = snapshot(folder);
  assert.equal(collect(rc2, folder).status, 0);
  assert.equal(collect(rc1, folder).status, 0);
  assert.deepEqual(
    snapshot(folder),
    both,
    'Collecting either release again changes nothing.',
  );

  // Each refusal, on a folder holding rc.1, writes nothing.
  const refusals: readonly (readonly [
    reason: string,
    at: string,
    plant: (folder: string) => void,
    said: RegExp,
  ])[] = [
    [
      'an archive is missing',
      checkout('1.0.0-rc.2', { withoutToolkitArchive: true }),
      () => undefined,
      /release\/toolkit\/1\.0\.0-rc\.2 holds 0 archives/u,
    ],
    [
      'the manifests disagree',
      checkout('1.0.0-rc.2', { toolkitVersion: '1.0.0-rc.3' }),
      () => undefined,
      /one release carries one version/u,
    ],
    [
      'SHA256SUMS holds a line of another form',
      rc2,
      (at) =>
        writeFileSync(
          resolve(at, 'SHA256SUMS'),
          `${rc1Lines}${sha256('x')} ${runtime1}\n`,
        ),
      /SHA256SUMS.*line 3/u,
    ],
    [
      'SHA256SUMS ends without a line break',
      rc2,
      (at) => writeFileSync(resolve(at, 'SHA256SUMS'), rc1Lines.trimEnd()),
      /SHA256SUMS.*line 2/u,
    ],
    [
      'SHA256SUMS names an archive twice',
      rc2,
      (at) =>
        writeFileSync(
          resolve(at, 'SHA256SUMS'),
          `${rc1Lines}${sumsLine(runtime1, 'runtime archive 1.0.0-rc.1')}`,
        ),
      /SHA256SUMS.*twice/u,
    ],
    [
      'a line names an archive the folder lacks',
      rc2,
      (at) => rmSync(resolve(at, toolkit1)),
      /neolorn-thoth-toolkit-1\.0\.0-rc\.1\.tgz.*not in/u,
    ],
    [
      'a line names an archive with other bytes',
      rc2,
      (at) => writeFileSync(resolve(at, runtime1), 'changed'),
      /neolorn-thoth-1\.0\.0-rc\.1\.tgz.*other bytes/u,
    ],
    [
      'a file of an archive name holds other bytes',
      rc2,
      (at) => writeFileSync(resolve(at, toolkit2), 'another build'),
      /neolorn-thoth-toolkit-1\.0\.0-rc\.2\.tgz exists with other bytes/u,
    ],
  ];
  let index = 0;
  for (const [reason, at, plant, said] of refusals) {
    const planted = resolve(root, `refused-${++index}`);
    assert.equal(collect(rc1, planted).status, 0);
    writeFileSync(resolve(planted, 'STATUS.md'), 'status of the folder\n');
    plant(planted);
    const held = snapshot(planted);
    const refused = collect(at, planted);
    assert.notEqual(refused.status, 0, `Refused when ${reason}.`);
    assert.match(refused.output, said, `The refusal says why: ${reason}.`);
    assert.deepEqual(
      snapshot(planted),
      held,
      `A refusal writes nothing: ${reason}.`,
    );
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}

process.stdout.write(
  'Release collect self-test passed: a release is collected into a new folder and beside an earlier one, every line already in SHA256SUMS kept, collecting again changes nothing, and each refusal writes nothing.\n',
);
