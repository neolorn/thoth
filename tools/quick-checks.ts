/**
 * `pnpm run check`: the quick checks, one after another in the checkout, each one's output in a file.
 *
 * They are the checks `CONTRIBUTING.md` lists to run before the verification suite: the formatter,
 * the linter, the typecheck, the anchors of the suite's injections, what a clean keeps
 * (`verify:clean:self-test`), the mutation reading tool (`verify:mutation-reading:self-test`), and
 * the unit suites of both packages. `--docs` adds the document and
 * generator checks that read the tree as it is and build nothing: the links, the normative map, the generated references, the coverage of the guides, and
 * the sterilization of the tree and its messages.
 *
 * Two things differ from running each script by hand, and both are about running beside other work.
 *
 * - **What git ignores is left out.** Prettier reads `.gitignore` and `.prettierignore`, and Vitest
 *   reads neither, so a file excluded only through `.git/info/exclude` or a global excludes file,
 *   or a work tree checked out inside this one, is formatted and its tests run as if it were the
 *   repository's. Every path git reports as ignored is handed to both as an exclusion, so the checks
 *   read what a commit would hold.
 * - **Beside a capped job the suites take two workers.** While a job of the cap exists
 *   (`tools/cap.ts`), heavy work is running on this machine with its time measured, and a mutation
 *   reading scores a mutant that runs out of time as killed. Vitest otherwise takes a worker per
 *   processor, so the unit suites are held to two.
 *
 * These are the only checks meant to run beside other work. Every other stage of the verification
 * suite, and anything that builds the packages or a consumer, is heavy, and on a machine with the
 * cap runs through it (`node tools/cap.ts start`), one at a time. So this takes no stage names:
 * an argument other than its own options is refused, and a stage of the suite is refused with the
 * command that runs it under the cap. It cannot stop a heavy script run by its own name
 * (`pnpm run verify:consumer`); nothing here sees that.
 *
 * Usage: node tools/quick-checks.ts [--docs] [--logs <folder>]   (default folder tmp/quick-checks)
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { capJobsRunning } from './cap.ts';
import { steps } from './verify-stages.ts';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const logsAt = argv.indexOf('--logs');
const stageIds = new Set(steps.map(({ id }) => id));
const refusals = argv
  .filter(
    (arg, index) =>
      arg !== '--docs' &&
      arg !== '--logs' &&
      (logsAt === -1 || index !== logsAt + 1),
  )
  .map((arg) =>
    stageIds.has(arg)
      ? `${arg} is a stage of the verification suite, not a quick check, and it does not run beside other work. Run it under the cap, alone: node tools/cap.ts start --log <file> --status <file> -- node tools/verify.ts --only ${arg}`
      : `${arg} is not an option of the quick checks, which take --docs and --logs <folder> and nothing else.`,
  );
if (logsAt !== -1 && argv[logsAt + 1] === undefined) {
  refusals.push('--logs needs the folder the logs go to.');
}
if (refusals.length > 0) {
  process.stderr.write(`${refusals.join('\n')}\n`);
  process.exit(2);
}
const logs = resolve(
  workspaceRoot,
  logsAt === -1 ? 'tmp/quick-checks' : (argv[logsAt + 1] ?? ''),
);
mkdirSync(logs, { recursive: true });

/** Every path git ignores here, as git reports it: a folder once, with a slash at the end. */
const ignored = spawnSync(
  'git',
  ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory'],
  { cwd: workspaceRoot, encoding: 'utf8', maxBuffer: 1 << 26 },
)
  .stdout.split('\n')
  .map((path) => path.trim())
  .filter(Boolean);
const excluded = ignored.map((path) =>
  path.endsWith('/') ? `${path}**` : path,
);

const capped = capJobsRunning();
const workers = capped.length > 0 ? ['--maxWorkers', '2'] : [];

const checks: (readonly [name: string, args: readonly string[]])[] = [
  ['format:check', excluded.map((path) => `!${path}`)],
  ['lint', []],
  ['typecheck', []],
  ['verify:injection-anchors', []],
  ['verify:clean:self-test', []],
  ['verify:mutation-reading:self-test', []],
  [
    'test:runtime',
    [...excluded.flatMap((path) => ['--exclude', path]), ...workers],
  ],
  [
    'test:toolkit',
    [...excluded.flatMap((path) => ['--exclude', path]), ...workers],
  ],
];
if (argv.includes('--docs')) {
  for (const name of [
    'verify:doc-links',
    'verify:spec-links',
    'verify:mutation-reasons',
    'verify:normative-map',
    'verify:cli-options',
    'verify:docs-reference',
    'verify:diagnostics-reference',
    'verify:closed-unions',
    'verify:format-shapes',
    'verify:builder-options',
    'verify:guide-coverage',
    'verify:doc-coverage',
    'verify:sterilize',
  ]) {
    checks.push([name, []]);
  }
}

if (capped.length > 0) {
  process.stdout.write(
    `A capped job is running (${capped.join(', ')}), so the unit suites take two workers.\n`,
  );
}
const failed: string[] = [];
for (const [name, args] of checks) {
  const started = Date.now();
  const command = ['run', name, ...args];
  const run = spawnSync(
    process.platform === 'win32'
      ? (process.env['ComSpec'] ?? 'cmd.exe')
      : 'pnpm',
    process.platform === 'win32'
      ? ['/d', '/s', '/c', 'pnpm', ...command]
      : command,
    {
      cwd: workspaceRoot,
      encoding: 'utf8',
      maxBuffer: 1 << 28,
      env: { ...process.env, NO_COLOR: '1' },
    },
  );
  const log = resolve(logs, `${name.replaceAll(':', '-')}.log`);
  writeFileSync(log, `${run.stdout}${run.stderr}`);
  const seconds = Math.round((Date.now() - started) / 1000);
  const tally = /^\s*Tests\s+.*$/mu.exec(readFileSync(log, 'utf8'))?.[0].trim();
  process.stdout.write(
    `${run.status === 0 ? 'passed' : 'FAILED'} ${name} in ${seconds} s${tally === undefined ? '' : `: ${tally}`}\n`,
  );
  if (run.status !== 0) failed.push(name);
}
process.stdout.write(
  failed.length === 0
    ? `All ${checks.length} quick checks passed. Each one's output is in ${logs}.\n`
    : `${failed.length} of ${checks.length} quick checks failed: ${failed.join(', ')}. Each one's output is in ${logs}.\n`,
);
process.exitCode = failed.length === 0 ? 0 : 1;
