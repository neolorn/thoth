/**
 * `pnpm run release:collect <folder>`: the verified archives of the version in the manifests, put
 * in one folder with their SHA-256 sums, beside any release the folder already holds.
 *
 * `verify:tarballs` packs each built package and keeps an archive only once every file in it
 * matches the build, under `release/<package>/<version>/`. Handing a release to someone who installs
 * it from files, or comparing the archives two machines made of one commit, takes both archives
 * side by side and their sums in the form `sha256sum --check` reads. This copies the two archives
 * the manifests' version names into the folder and writes `SHA256SUMS` beside them: every line the
 * file already holds, kept byte for byte, and a line for each archive it does not name yet, the
 * whole sorted by file name. So the file two machines write for one commit into an empty folder is
 * the same bytes when the archives are, and a folder can hold several releases with one file of
 * sums that checks them all. Collecting a release the folder already holds changes nothing.
 *
 * It packs nothing, and it checks everything before it writes anything, so a refusal leaves the
 * folder as it was. It refuses:
 *
 * - an archive that is not there, with the command that makes it;
 * - a version that differs between the three manifests, since the archives of one release carry
 *   one version;
 * - a `SHA256SUMS` in the folder that is not lines of `<64 lowercase hex digits>  <file name>`,
 *   each ending in a line break, with no file named twice;
 * - a line of it naming an archive the folder does not hold, or one whose bytes are not the ones
 *   the line sums, because sums that no longer check would be carried into the new file;
 * - a file in the folder with an archive's name and other bytes, so a release once collected is not
 *   replaced by a later build.
 */
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function refuse(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const folder = process.argv[2];
if (folder === undefined || folder.trim() === '') {
  refuse('Usage: node tools/collect-release.ts <folder>');
}

const versionOf = (manifest: string): string =>
  (
    JSON.parse(readFileSync(resolve(workspaceRoot, manifest), 'utf8')) as {
      version: string;
    }
  ).version;
const versions = new Set(
  [
    'package.json',
    'packages/runtime/package.json',
    'packages/toolkit/package.json',
  ].map(versionOf),
);
if (versions.size !== 1) {
  refuse(
    `The manifests carry ${[...versions].join(' and ')}; one release carries one version.`,
  );
}
const version = [...versions][0] as string;

const out = resolve(folder);
const sha256 = (path: string): string =>
  createHash('sha256').update(readFileSync(path)).digest('hex');

// The archives of this release, one for each package.
const archives: { name: string; source: string; sum: string }[] = [];
for (const pkg of ['runtime', 'toolkit']) {
  const from = resolve(workspaceRoot, 'release', pkg, version);
  const found = existsSync(from)
    ? readdirSync(from).filter((name) => name.endsWith('.tgz'))
    : [];
  if (found.length !== 1) {
    refuse(
      `release/${pkg}/${version} holds ${found.length} archives. Run pnpm run build and pnpm run verify:tarballs first.`,
    );
  }
  const name = found[0] as string;
  const source = resolve(from, name);
  archives.push({ name, source, sum: sha256(source) });
}

// The lines the folder's SHA256SUMS holds, each read and checked against the archive it names.
const sumsPath = resolve(out, 'SHA256SUMS');
const before = existsSync(sumsPath) ? readFileSync(sumsPath, 'utf8') : '';
const lines = new Map<string, string>();
const LINE = /^([0-9a-f]{64}) {2}([^\s/\\]+)\n$/u;
for (const [index, line] of (before.match(/[^\n]*\n?/gu) ?? [])
  .filter((line) => line !== '')
  .entries()) {
  const parsed = LINE.exec(line);
  const sum = parsed?.[1];
  const name = parsed?.[2];
  if (
    sum === undefined ||
    name === undefined ||
    name === '.' ||
    name === '..'
  ) {
    refuse(
      `${sumsPath} line ${index + 1} is not "<64 lowercase hex digits>  <file name>" ending in a line break. Nothing was written.`,
    );
  }
  if (lines.has(name)) {
    refuse(
      `${sumsPath} names ${name} twice, the second time at line ${index + 1}. Nothing was written.`,
    );
  }
  const archive = resolve(out, name);
  if (!existsSync(archive)) {
    refuse(
      `${sumsPath} names ${name}, which is not in ${out}. Nothing was written.`,
    );
  }
  if (sha256(archive) !== sum) {
    refuse(
      `${sumsPath} names ${name}, and that file holds other bytes than its line sums. Nothing was written.`,
    );
  }
  lines.set(name, line);
}

// An archive of this release already in the folder is the same bytes, or the release is refused.
for (const { name, sum } of archives) {
  const target = resolve(out, name);
  if (existsSync(target) && sha256(target) !== sum) {
    refuse(
      `${target} exists with other bytes. A release once collected is not replaced; name another folder. Nothing was written.`,
    );
  }
}

// Everything is checked: copy what the folder lacks, and add the lines its sums lack.
mkdirSync(out, { recursive: true });
for (const { name, source, sum } of archives) {
  const target = resolve(out, name);
  if (!existsSync(target)) copyFileSync(source, target);
  if (!lines.has(name)) lines.set(name, `${sum}  ${name}\n`);
}
const text = [...lines]
  .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  .map(([, line]) => line)
  .join('');
if (!existsSync(sumsPath) || text !== before) writeFileSync(sumsPath, text);
process.stdout.write(
  `${version} into ${out}:\n${archives.map(({ name, sum }) => `${sum}  ${name}\n`).join('')}`,
);
