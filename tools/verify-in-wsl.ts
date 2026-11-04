/**
 * The verification suite, or the release archives, on Linux from a Windows machine, through WSL.
 *
 * The hosted run is Linux, and a Windows machine with WSL can run the same thing before anything is
 * pushed: a fresh clone of this repository at one commit, inside the Linux file system, set up as
 * the hosted job sets it up, with `CI=true`. A clone and not this checkout, because the suite proves
 * a commit and a checkout reached through `/mnt` is neither the commit nor a Linux file system: its
 * modes, its case folding and its speed are Windows'.
 *
 * `--gate` installs the locked dependencies and the three browser engines, stages what the suite
 * reads offline (`stage:node-runtimes`, `build`, `stage:consumer-store`, `stage:npm-cache`), and runs
 * `tools/verify.ts` with every processor of the Linux machine, as the hosted job hands it the
 * runner's, unless `THOTH_VERIFY_PROCESSORS` is set here: started under the cap (`tools/cap.ts`),
 * which sets it to its mode's processor count, the suite in WSL takes that budget. The cap holds
 * this process and `wsl.exe`, not the Linux machine, which runs in a virtual machine of its own, so
 * the suite's memory there is bounded by WSL's own limit (its `memory` setting), never by the cap's
 * job; the gate's log prints that limit. `--pack` builds, runs `verify:tarballs` and collects the
 * archives with their sums (`release:collect`), so the sums two machines give for one commit can be
 * compared. Either or both; the pack runs first when both are named.
 *
 * Every step's output goes to a file in the logs folder, on the Windows side, and the run folder of
 * the suite is copied there at the end. The clone is made under `--home`, a folder of the Linux
 * file system, and replaced on every run. `--node` names a Node installation there (its `bin`
 * is put first on the path) for a Linux machine whose own Node is not the one the repository
 * develops on. `--print` writes the script the run would run into the logs folder, has bash read
 * it without running it, and prints it.
 *
 * Usage: node tools/verify-in-wsl.ts <commit> --home <linux folder> [--gate] [--pack]
 *            [--node <linux folder>] [--logs <folder>] [--print]   (logs default tmp/wsl/<commit>)
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The processor budget the suite in WSL is handed, as the script writes it: the value of
 * `THOTH_VERIFY_PROCESSORS` where it is set here, as the cap sets it, and the Linux machine's
 * processor count otherwise. A value that is not a whole number above zero is refused rather than
 * passed on.
 */
export function wslGateProcessors(
  environment: Readonly<Record<string, string | undefined>>,
): string {
  const value = environment['THOTH_VERIFY_PROCESSORS'];
  if (value === undefined || value === '') return '"$(nproc)"';
  assert.ok(
    /^[1-9]\d*$/u.test(value),
    `THOTH_VERIFY_PROCESSORS is a whole number of processors above zero, not ${JSON.stringify(value)}.`,
  );
  return value;
}

function main(): void {
  const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  assert.equal(
    process.platform,
    'win32',
    'This runs the suite in WSL from Windows; on Linux, run it directly.',
  );

  const argv = process.argv.slice(2);
  const option = (name: string): string | undefined => {
    const at = argv.indexOf(name);
    if (at === -1) return undefined;
    const value = argv[at + 1];
    assert.ok(
      value !== undefined && !value.startsWith('--'),
      `${name} needs a value.`,
    );
    return value;
  };
  const given = argv.filter(
    (arg, index) =>
      !arg.startsWith('--') &&
      !['--home', '--node', '--logs'].includes(argv[index - 1] ?? ''),
  );
  const commitArgument = given[0];
  const home = option('--home');
  const gate = argv.includes('--gate');
  const pack = argv.includes('--pack');
  assert.ok(
    commitArgument !== undefined && home !== undefined && (gate || pack),
    'Usage: node tools/verify-in-wsl.ts <commit> --home <linux folder> [--gate] [--pack] [--node <linux folder>] [--logs <folder>]',
  );
  assert.ok(home.startsWith('/'), `--home is a Linux path, not ${home}.`);
  const processors = wslGateProcessors(process.env);
  const commit = execFileSync(
    'git',
    ['rev-parse', '--verify', `${commitArgument}^{commit}`],
    {
      cwd: workspaceRoot,
      encoding: 'utf8',
    },
  ).trim();
  const logs = resolve(
    workspaceRoot,
    option('--logs') ?? `tmp/wsl/${commit.slice(0, 12)}`,
  );
  mkdirSync(logs, { recursive: true });

  const wsl = resolve(
    process.env['SystemRoot'] ?? 'C:/Windows',
    'System32/wsl.exe',
  );
  const linuxPath = (path: string): string =>
    execFileSync(wsl, ['-e', 'wslpath', '-a', path.replaceAll('\\', '/')], {
      encoding: 'utf8',
    }).trim();
  /** One argument for bash, whatever it holds. */
  const quoted = (text: string): string => `'${text.replaceAll("'", `'"'"'`)}'`;

  const repository = linuxPath(workspaceRoot);
  const out = linuxPath(logs);
  const clone = `${home}/clone`;
  const node = option('--node');

  const lines = [
    'set -u',
    ...(node === undefined
      ? []
      : [`export PATH=${quoted(`${node}/bin`)}:"$PATH"`]),
    'export CI=true',
    `OUT=${quoted(out)}`,
    'step() { echo "=== $(date +%H:%M:%S) $*"; }',
    // A step's output to its own file, its exit status on the line after its name.
    'run() { local name=$1 limit=$2; shift 2; step "$name"; timeout "$limit" "$@" > "$OUT/$name.log" 2>&1; local code=$?; echo "    exit $code"; return $code; }',
    `rm -rf ${quoted(clone)} && mkdir -p ${quoted(home)} || exit 1`,
    'step clone',
    `git clone -q ${quoted(repository)} ${quoted(clone)} || exit 1`,
    `cd ${quoted(clone)} || exit 1`,
    `git -c advice.detachedHead=false checkout -q ${commit} || exit 1`,
    'step "HEAD $(git rev-parse HEAD) tree $(git rev-parse HEAD^{tree}) changed paths $(git status --porcelain | wc -l) node $(node --version) on $(nproc) processors"',
    'run install 1800 pnpm install --frozen-lockfile || exit 1',
  ];
  if (pack) {
    lines.push(
      'run build 2400 pnpm run build || exit 1',
      'run verify-tarballs 1200 pnpm run verify:tarballs || exit 1',
      `run release-collect 600 pnpm run release:collect ${quoted(`${out}/release`)} || exit 1`,
      'cat "$OUT/release/SHA256SUMS"',
    );
  }
  if (gate) {
    lines.push(
      'NODE_OPTIONS=--dns-result-order=ipv4first run browsers 1800 pnpm exec playwright install chromium firefox webkit || exit 1',
      'for script in stage:node-runtimes build stage:consumer-store stage:npm-cache; do run "${script//:/-}" 2400 pnpm run "$script" || exit 1; done',
      // The cap holds wsl.exe, not the virtual machine the Linux side runs in.
      `step "memory: $(free -m | awk '/^Mem:/ { print $2 }') MiB, WSL's own limit; the cap's job does not hold the Linux machine"`,
      // The hosted workflow hands the suite the runner's processors, so this does as well, unless
      // the cap named a budget here.
      `step "processors: ${processors === '"$(nproc)"' ? 'every one of the Linux machine' : `${processors}, the budget THOTH_VERIFY_PROCESSORS gives`}"`,
      `THOTH_VERIFY_PROCESSORS=${processors} run gate 21000 node tools/verify.ts`,
      'code=$?',
      'rm -rf "$OUT/verify-run" && cp -r tmp/verify-run "$OUT/verify-run"',
      'step "gate exit $code"',
      'exit $code',
    );
  }
  const script = resolve(logs, 'run.sh');
  writeFileSync(script, `${lines.join('\n')}\n`);
  const printing = argv.includes('--print');
  const run = spawnSync(
    wsl,
    ['-e', 'bash', ...(printing ? ['-n'] : []), linuxPath(script)],
    { stdio: 'inherit' },
  );
  if (printing) process.stdout.write(`${lines.join('\n')}\n`);
  process.exitCode = run.status ?? 1;
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
