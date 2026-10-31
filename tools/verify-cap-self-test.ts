/**
 * `verify:cap:self-test`: the cap's policy and its reading of its own folder, on planted machines.
 *
 * What the cap sets on a job is computed from the machine (`cap/cap-lib.cs`): the processor rate,
 * the memory limit in whole pages, the efficiency processors from the processors' efficiency
 * classes, the mode a mode file's text names, and the variables a launcher carries. Those are pure
 * functions of their readings, so each is handed planted readings here and held to what the cap
 * promises:
 *
 * - day: a hard rate of two thirds of the machine, job memory two thirds of physical memory rounded
 *   down to whole pages, every processor, below normal, the processor count left to the work;
 * - night: no rate, no memory limit, every processor, normal priority, the work told every logical
 *   processor;
 * - efficiency: the efficiency processors as the affinity and their number as the processor count,
 *   half of physical memory in whole pages, no rate;
 * - no mode file is day; a mode file holding day, night or efficiency names that mode, and one
 *   that cannot be read, or holds anything else, names none, and no limits are taken from it;
 * - a stepper steps in its own mode, ends in another and holds while the file names none, and a
 *   running command's launcher notes once when the file stops naming a mode and once when it
 *   names one again;
 * - the efficiency processors are those of the lowest class, and with one class, one logical
 *   processor of each core, or the first half where cores do not pair;
 * - a launcher carries `THOTH_*` and `PATH`, in any case, and nothing else.
 *
 * The scripts' reading of the cap's folder is driven too, in a planted folder: no mode file is day,
 * the mode file's word is the mode, `job-name.txt` names the job, `physical-bytes.txt` is the
 * memory the limits come from, the default folder is `tmp/cap`, and no job exists under a name
 * nobody created. With a mode file that names no mode, `mode` and `policy` report it as unknown or
 * unreadable, and `start` and the launcher refuse with 125 before anything is launched, naming the
 * file and the command that sets it; `mode` replaces the file rather than writing into it; a
 * stepper holds and says so once; and a status records the cap's folder. Those folders name a job
 * in a namespace that does not exist, so nothing there can create or switch a job.
 *
 * Nothing here creates a job, so this runs beside a capped command without touching it. What only
 * a job shows (the limits Windows reads back, the start outside the caller's jobs, the environment
 * the command gets) is shown by starting a second cap with a folder and a job name of its own.
 * Windows only; elsewhere it says so and passes, because there is no cap there.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  linkSync,
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

const toolsRoot = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(toolsRoot, '..');
const scripts = resolve(toolsRoot, 'cap');

if (process.platform !== 'win32') {
  process.stdout.write(
    'The cap runs on Windows only; there is nothing to check here.\n',
  );
  process.exit(0);
}

const PAGE = 4096;
const GIB = 1024 ** 3;
const pagesDown = (bytes: number): number => Math.floor(bytes / PAGE) * PAGE;
const pagesUp = (bytes: number): number => Math.ceil(bytes / PAGE) * PAGE;

/** Runs a PowerShell script in Windows PowerShell 5.1 and returns the JSON it prints last. */
function powerShell(
  lines: readonly string[],
  environment: Record<string, string | undefined> = {},
): unknown {
  const folder = mkdtempSync(join(tmpdir(), 'cap-self-test-'));
  try {
    const file = join(folder, 'probe.ps1');
    writeFileSync(file, `${lines.join('\r\n')}\r\n`, 'utf8');
    const run = spawnSync(
      resolve(
        process.env['SystemRoot'] ?? 'C:/Windows',
        'System32/WindowsPowerShell/v1.0/powershell.exe',
      ),
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file],
      {
        encoding: 'utf8',
        env: { ...process.env, ...environment },
        windowsHide: true,
        timeout: 120_000,
      },
    );
    assert.equal(
      run.status,
      0,
      `PowerShell exited ${run.status}:\n${run.stdout}\n${run.stderr}`,
    );
    const text = run.stdout.trim();
    const start = text.indexOf('{');
    assert.ok(start >= 0, `PowerShell printed no JSON:\n${text}`);
    return JSON.parse(text.slice(start)) as unknown;
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

const ps = (text: string): string => `'${text.replaceAll("'", "''")}'`;
const lib = resolve(scripts, 'cap-lib.cs');

// ---- The policy, as pure functions of planted readings ----

interface Target {
  readonly Mode: string;
  readonly Rate: number;
  readonly Memory: number;
  readonly Affinity: number;
  readonly Processors: number;
  readonly Normal: boolean;
}
interface Mask {
  readonly mask: number;
  readonly count: number;
  readonly description: string;
}
interface PolicyReadings {
  readonly dayRate: number;
  readonly memory: Record<
    string,
    { day: number; efficiency: number; margin: number }
  >;
  readonly targets: Record<string, Target>;
  readonly modes: Record<string, string>;
  readonly unknownRefused: boolean;
  readonly steps: Record<string, string>;
  readonly notes: Record<string, string>;
  readonly carried: string[];
  readonly masks: Record<string, Mask>;
}

// Physical memory as machines report it: never a whole number of pages of two thirds.
const PHYSICAL = [64 * GIB - 123_456, 16 * GIB, 8 * GIB + 1, 3 * PAGE + 2];
const MODE_TEXTS: Record<string, string> = {
  missing: '$null',
  empty: "''",
  night: "'night'",
  nightLine: '"night`r`n"',
  nightCapital: "'Night'",
  efficiencySpaced: "' efficiency '",
  nightly: "'nightly'",
  day: "'day'",
  noon: "'noon'",
};
const STEPS = [
  ['efficiency', 'efficiency'],
  ['efficiency', 'day'],
  ['efficiency', 'unknown'],
  ['day', 'unreadable'],
] as const;
const NOTES = [
  ['night', 'unknown'],
  ['unknown', 'unreadable'],
  ['unreadable', 'night'],
  ['night', 'day'],
  ['day', 'day'],
] as const;
const VARIABLES = [
  'THOTH_VERIFY_PROCESSORS',
  'thoth_cap_job',
  'THOTH_',
  'PATH',
  'Path',
  'PATHEXT',
  'XTHOTH_A',
  'GITHUB_TOKEN',
  'NPM_CONFIG_USERCONFIG',
  'USERPROFILE',
  'COMSPEC',
];
// index, core, class per logical processor.
const MACHINES: Record<
  string,
  { index: number[]; core: number[]; cls: number[] }
> = {
  // Four performance cores of two threads each (class 1), then four efficiency cores (class 0).
  hybrid: {
    index: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    core: [0, 0, 1, 1, 2, 2, 3, 3, 4, 5, 6, 7],
    cls: [1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0],
  },
  // Three classes: only the lowest is efficiency.
  threeClasses: {
    index: [0, 1, 2, 3, 4, 5],
    core: [0, 1, 2, 3, 4, 5],
    cls: [2, 2, 1, 1, 0, 0],
  },
  // One class, two threads a core: one of each core.
  oneClassPaired: {
    index: [0, 1, 2, 3, 4, 5, 6, 7],
    core: [0, 0, 1, 1, 2, 2, 3, 3],
    cls: [0, 0, 0, 0, 0, 0, 0, 0],
  },
  // One class, one thread a core: the first half by index, in whatever order they are read.
  oneClassSingle: {
    index: [3, 2, 1, 0],
    core: [3, 2, 1, 0],
    cls: [0, 0, 0, 0],
  },
  none: { index: [], core: [], cls: [] },
};

const policy = powerShell([
  `Add-Type -TypeDefinition ([IO.File]::ReadAllText(${ps(lib)}))`,
  '$memory = [ordered]@{}',
  ...PHYSICAL.map(
    (bytes) =>
      `$memory['${bytes}'] = [ordered]@{ day = [ThothCap]::DayMemory([uint64]${bytes}); efficiency = [ThothCap]::EfficiencyMemory([uint64]${bytes}); margin = [ThothCap]::Margin([uint64]${bytes}) }`,
  ),
  '$targets = [ordered]@{}',
  ...['day', 'night', 'efficiency'].map(
    (mode) =>
      `$targets['${mode}'] = [ThothCap]::TargetOf('${mode}', [uint64]${PHYSICAL[0]}, 24, [uint64]0xF00)`,
  ),
  '$modes = [ordered]@{}',
  ...Object.entries(MODE_TEXTS).map(
    ([name, text]) =>
      `$modes['${name}'] = [ThothCap]::MeaningOf(${text === '$null' ? '$false' : '$true'}, $true, ${text})`,
  ),
  "$modes['unreadable'] = [ThothCap]::MeaningOf($true, $false, 'night')",
  `$unknownRefused = try { [void][ThothCap]::TargetOf('unknown', [uint64]${PHYSICAL[0]}, 24, [uint64]0xF00); $false } catch { $true }`,
  '$steps = [ordered]@{}',
  ...STEPS.map(
    ([mode, meaning]) =>
      `$steps['${mode}/${meaning}'] = [ThothCap]::StepperAction('${mode}', '${meaning}')`,
  ),
  '$notes = [ordered]@{}',
  ...NOTES.map(
    ([before, now]) =>
      `$notes['${before}/${now}'] = [ThothCap]::ModeNote('${before}', '${now}', 'F')`,
  ),
  // A list, not a table: PowerShell's tables fold PATH and Path into one key.
  `$carried = @(@(${VARIABLES.map((name) => `'${name}'`).join(', ')}) | Where-Object { [ThothCap]::Carried($_) })`,
  '$masks = [ordered]@{}',
  ...Object.entries(MACHINES).map(
    ([name, { index, core, cls }]) =>
      `$count = 0; $description = ''; $m = [ThothCap]::EfficiencyMaskOf([int[]]@(${index.join(',')}), [int[]]@(${core.join(',')}), [int[]]@(${cls.join(',')}), [ref]$count, [ref]$description); $masks['${name}'] = [ordered]@{ mask = $m; count = $count; description = $description }`,
  ),
  '[ordered]@{ dayRate = [ThothCap]::DayRate(); memory = $memory; targets = $targets; modes = $modes; unknownRefused = $unknownRefused; steps = $steps; notes = $notes; carried = $carried; masks = $masks } | ConvertTo-Json -Depth 5 -Compress',
]) as PolicyReadings;

assert.equal(
  policy.dayRate,
  Math.round((10_000 * 2) / 3),
  'Day rate is two thirds of the machine.',
);
for (const bytes of PHYSICAL) {
  const read = policy.memory[String(bytes)];
  assert.ok(read !== undefined);
  assert.equal(
    read.day,
    pagesDown((bytes * 2) / 3),
    `Day memory of ${bytes} is two thirds in whole pages, rounded down.`,
  );
  assert.equal(
    read.efficiency,
    pagesDown(bytes / 2),
    `Efficiency memory of ${bytes} is half in whole pages, rounded down.`,
  );
  assert.equal(
    read.margin,
    pagesUp(bytes / 32),
    `The margin of ${bytes} is a thirty-second in whole pages, rounded up.`,
  );
}

const physical = PHYSICAL[0] as number;
const expected: Record<string, Target> = {
  day: {
    Mode: 'day',
    Rate: 6667,
    Memory: pagesDown((physical * 2) / 3),
    Affinity: 0,
    Processors: 0,
    Normal: false,
  },
  night: {
    Mode: 'night',
    Rate: 0,
    Memory: 0,
    Affinity: 0,
    Processors: 24,
    Normal: true,
  },
  efficiency: {
    Mode: 'efficiency',
    Rate: 0,
    Memory: pagesDown(physical / 2),
    Affinity: 0xf00,
    Processors: 4,
    Normal: false,
  },
};
for (const [mode, target] of Object.entries(expected)) {
  assert.deepEqual(
    policy.targets[mode],
    target,
    `The ${mode} mode's limits on a planted machine.`,
  );
}

assert.deepEqual(
  policy.modes,
  {
    missing: 'day',
    empty: 'unknown',
    night: 'night',
    nightLine: 'night',
    nightCapital: 'night',
    efficiencySpaced: 'efficiency',
    nightly: 'unknown',
    day: 'day',
    noon: 'unknown',
    unreadable: 'unreadable',
  },
  'No mode file is day; a mode file names day, night or efficiency, is unknown with any other text, and unreadable when it cannot be read.',
);
assert.equal(
  policy.unknownRefused,
  true,
  'No limits are taken from a mode file that names no mode.',
);
assert.deepEqual(
  policy.steps,
  {
    'efficiency/efficiency': 'step',
    'efficiency/day': 'end',
    'efficiency/unknown': 'hold',
    'day/unreadable': 'hold',
  },
  'A stepper steps in its own mode, ends in another, and holds the limit while the file names none.',
);
assert.deepEqual(
  Object.fromEntries(
    Object.entries(policy.notes).map(([key, note]) => [
      key,
      note === '' ? '' : note.includes('again') ? 'again' : 'bad',
    ]),
  ),
  {
    'night/unknown': 'bad',
    'unknown/unreadable': '',
    'unreadable/night': 'again',
    'night/day': '',
    'day/day': '',
  },
  "A running command's launcher logs once when the mode file stops naming a mode and once when it names one again.",
);

assert.deepEqual(
  policy.carried,
  ['THOTH_VERIFY_PROCESSORS', 'thoth_cap_job', 'THOTH_', 'PATH', 'Path'],
  'A launcher carries THOTH_* and PATH, and nothing else.',
);

const bits = (mask: number): number[] =>
  [...Array(32).keys()].filter((bit) => (mask & (1 << bit)) !== 0);
assert.deepEqual(
  bits(policy.masks['hybrid']?.mask ?? 0),
  [8, 9, 10, 11],
  'On a hybrid machine the efficiency processors are those of the lowest class.',
);
assert.equal(policy.masks['hybrid']?.count, 4);
assert.deepEqual(
  bits(policy.masks['threeClasses']?.mask ?? 0),
  [4, 5],
  'With three classes only the lowest is efficiency.',
);
assert.deepEqual(
  bits(policy.masks['oneClassPaired']?.mask ?? 0),
  [0, 2, 4, 6],
  'With one class, one logical processor of each core.',
);
assert.equal(policy.masks['oneClassPaired']?.count, 4);
assert.deepEqual(
  bits(policy.masks['oneClassSingle']?.mask ?? 0),
  [0, 1],
  'With one class and unpaired cores, the first half by index.',
);
assert.equal(policy.masks['oneClassSingle']?.count, 2);
assert.equal(
  policy.masks['none']?.mask,
  0,
  'No processor read is no efficiency mask.',
);

// ---- The scripts' reading of the cap's folder ----

interface FolderReading {
  readonly directory: string;
  readonly job: string;
  readonly mode: string;
  readonly dayMemory: number;
  readonly carried: string[];
  readonly running: number;
}
const readFolder = (
  directory: string | undefined,
  environment: Record<string, string | undefined> = {},
): FolderReading =>
  powerShell(
    [
      `. ${ps(resolve(scripts, 'cap-common.ps1'))}`,
      `& (Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe') -NoProfile -ExecutionPolicy Bypass -File ${ps(resolve(scripts, 'cap-run.ps1'))} -Running -Names 'ThothCapNoSuchJob-${process.pid}' | Out-Null`,
      '$running = $LASTEXITCODE',
      "$day = (Get-CapTarget 'day').Memory",
      '[ordered]@{ directory = $CapDirectory; job = $CapJobName; mode = (Get-CapMode); dayMemory = $day; carried = @((Get-CapCarried).Keys); running = $running } | ConvertTo-Json -Compress',
    ],
    { THOTH_CAP_DIRECTORY: directory, ...environment },
  ) as FolderReading;

const planted = mkdtempSync(join(tmpdir(), 'cap-folder-'));
try {
  const plantedPhysical = 12 * GIB + 777;
  writeFileSync(join(planted, 'physical-bytes.txt'), `${plantedPhysical}\r\n`);
  const empty = readFolder(planted, {
    THOTH_CAP_SELF_TEST: 'carried',
    CAP_SELF_TEST_UNNAMED: 'left',
  });
  assert.equal(
    empty.directory.toLowerCase(),
    resolve(planted).toLowerCase(),
    'THOTH_CAP_DIRECTORY names the folder.',
  );
  assert.equal(
    empty.job,
    'ThothCap',
    'With no job-name.txt the job is ThothCap.',
  );
  assert.equal(empty.mode, 'day', 'With no mode file the mode is day.');
  assert.equal(
    empty.dayMemory,
    pagesDown((plantedPhysical * 2) / 3),
    "physical-bytes.txt is the memory day's limit is taken from.",
  );
  assert.ok(
    empty.carried.includes('THOTH_CAP_SELF_TEST') &&
      !empty.carried.includes('CAP_SELF_TEST_UNNAMED') &&
      empty.carried.every(
        (name) =>
          name.toUpperCase().startsWith('THOTH_') ||
          name.toUpperCase() === 'PATH',
      ),
    `The launcher's request carries THOTH_* and PATH only: ${empty.carried.join(', ')}.`,
  );
  assert.equal(empty.running, 1, 'No job exists under a name nobody created.');

  writeFileSync(join(planted, 'mode.txt'), 'night\r\n');
  writeFileSync(join(planted, 'job-name.txt'), 'ThothCapPlanted\r\n');
  const named = readFolder(planted);
  assert.equal(named.mode, 'night', "The mode file's word is the mode.");
  assert.equal(named.job, 'ThothCapPlanted', 'job-name.txt names the job.');

  writeFileSync(join(planted, 'mode.txt'), 'evening');
  assert.equal(
    readFolder(planted).mode,
    'unknown',
    'A word that is no mode is unknown, not day.',
  );
} finally {
  rmSync(planted, { recursive: true, force: true });
}

const defaultFolder = readFolder(undefined);
assert.equal(
  defaultFolder.directory.toLowerCase(),
  resolve(workspaceRoot, 'tmp/cap').toLowerCase(),
  'Without THOTH_CAP_DIRECTORY the folder is tmp/cap, outside every tracked file.',
);

// ---- A mode file gone bad, a write in place, the folder in the status ----
//
// Driven in planted folders whose job-name.txt names a job in a namespace that does not exist, so
// no job can be created or opened under it: a launcher that got as far as creating its job fails
// there with "error 3", and a mode switch finds no job to switch. Nothing here can create a job.

const NO_JOB = 'NoSuchNamespace\\ThothCapSelfTest';
const powerShellExe = resolve(
  process.env['SystemRoot'] ?? 'C:/Windows',
  'System32/WindowsPowerShell/v1.0/powershell.exe',
);
interface ScriptRun {
  readonly status: number | null;
  readonly output: string;
}
/** Runs one of the cap's scripts with THOTH_CAP_DIRECTORY naming a planted folder. */
function inPlanted(
  folder: string,
  script: string,
  args: readonly string[],
): ScriptRun {
  assert.equal(
    readFileSync(join(folder, 'job-name.txt'), 'utf8'),
    NO_JOB,
    'A planted folder names a job that cannot exist.',
  );
  const run = spawnSync(
    powerShellExe,
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      resolve(scripts, script),
      ...args,
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, THOTH_CAP_DIRECTORY: folder },
      windowsHide: true,
      timeout: 120_000,
    },
  );
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}
function plantFolder(mode: string | 'folder' | undefined): string {
  const folder = mkdtempSync(join(tmpdir(), 'cap-mode-'));
  writeFileSync(join(folder, 'job-name.txt'), NO_JOB);
  writeFileSync(join(folder, 'physical-bytes.txt'), `${16 * GIB}`);
  if (mode === 'folder') mkdirSync(join(folder, 'mode.txt'));
  else if (mode !== undefined) writeFileSync(join(folder, 'mode.txt'), mode);
  return folder;
}
const readJson = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/u, '')) as Record<
    string,
    unknown
  >;

const failures: string[] = [];
function check(name: string, body: () => void): void {
  try {
    body();
    process.stdout.write(`  held: ${name}\n`);
  } catch (error) {
    failures.push(
      `${name}: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`,
    );
    process.stdout.write(`  FAILED: ${name}\n`);
  }
}

const folders: string[] = [];
const planted2 = (mode: string | 'folder' | undefined): string => {
  const folder = plantFolder(mode);
  folders.push(folder);
  return folder;
};
try {
  for (const [label, mode, meaning] of [
    ['a word that is no mode', 'evening', 'unknown'],
    ['an empty mode file', '', 'unknown'],
    ['a mode file that cannot be read', 'folder', 'unreadable'],
  ] as const) {
    check(`${label} reads as ${meaning}, not as day`, () => {
      assert.equal(readFolder(planted2(mode)).mode, meaning);
    });
    check(
      `cap mode reports ${label} as ${meaning}, with the file and the command that sets it`,
      () => {
        const folder = planted2(mode);
        const shown = inPlanted(folder, 'cap-mode.ps1', ['show']);
        assert.equal(shown.status, 0, shown.output);
        assert.match(shown.output, new RegExp(`mode: ${meaning}`, 'u'));
        assert.ok(
          shown.output.includes(join(folder, 'mode.txt')),
          shown.output,
        );
        assert.ok(
          shown.output.includes('node tools/cap.ts mode'),
          shown.output,
        );
      },
    );
    check(`policy reports ${label} as ${meaning}`, () => {
      const folder = planted2(mode);
      const run = inPlanted(folder, 'cap-run.ps1', ['-Policy']);
      assert.equal(run.status, 0, run.output);
      const read = JSON.parse(run.output.slice(run.output.indexOf('{'))) as {
        mode: string;
        modeProblem?: string;
      };
      assert.equal(read.mode, meaning);
      assert.ok(
        read.modeProblem?.includes(join(folder, 'mode.txt')),
        run.output,
      );
    });
    check(
      `start refuses with 125 on ${label}, naming the file and the command, before anything is launched`,
      () => {
        const folder = planted2(mode);
        const log = join(folder, 'start.log');
        const status = join(folder, 'start.status');
        const run = inPlanted(folder, 'cap-start.ps1', [
          '-Log',
          log,
          '-Status',
          status,
          '-Command',
          'cmd /c exit 0',
        ]);
        assert.equal(run.status, 125, run.output);
        assert.ok(run.output.includes(join(folder, 'mode.txt')), run.output);
        assert.ok(run.output.includes('node tools/cap.ts mode'), run.output);
        assert.ok(!existsSync(`${log}.request.json`), 'No request is written.');
        const recorded = readJson(status);
        assert.equal(recorded['outcome'], 'not started');
        assert.equal(
          String(recorded['directory']).toLowerCase(),
          folder.toLowerCase(),
        );
      },
    );
    check(
      `the launcher refuses with 125 on ${label} before it takes the job`,
      () => {
        const folder = planted2(mode);
        const status = join(folder, 'run.status');
        const run = inPlanted(folder, 'cap-run.ps1', [
          '-Status',
          status,
          '-Command',
          'cmd /c exit 0',
        ]);
        assert.equal(run.status, 125, run.output);
        const reason = String(readJson(status)['reason']);
        assert.ok(reason.includes(join(folder, 'mode.txt')), reason);
        assert.ok(!reason.includes('CreateJobObject'), reason);
      },
    );
  }

  check('the status records the cap folder beside modeAtStart', () => {
    const folder = planted2('night');
    const status = join(folder, 'folder.status');
    const run = inPlanted(folder, 'cap-run.ps1', [
      '-Status',
      status,
      '-Command',
      'cmd /c exit 0',
    ]);
    assert.equal(run.status, 125, run.output);
    const recorded = readJson(status);
    assert.match(String(recorded['reason']), /CreateJobObject/u);
    assert.equal(
      String(recorded['directory']).toLowerCase(),
      folder.toLowerCase(),
    );
  });

  check('cap mode replaces the mode file rather than writing into it', () => {
    const folder = planted2('day');
    const witness = join(folder, 'witness.txt');
    linkSync(join(folder, 'mode.txt'), witness);
    const run = inPlanted(folder, 'cap-mode.ps1', ['night']);
    assert.equal(run.status, 0, run.output);
    assert.equal(readFileSync(join(folder, 'mode.txt'), 'utf8'), 'night');
    assert.equal(
      readFileSync(witness, 'utf8'),
      'day',
      'A hard link to the old file still holds the old word, so the new one was written beside it and renamed over.',
    );
    assert.deepEqual(
      readdirSync(folder).filter((name) => name.includes('.tmp')),
      [],
      'No file is left beside it.',
    );
  });

  check(
    'a stepper holds the limit and says so once when the mode file goes bad',
    () => {
      const folder = planted2('evening');
      const run = inPlanted(folder, 'cap-stepper.ps1', [
        '-Mode',
        'day',
        '-Ceiling',
        String(8 * GIB),
        '-IntervalSeconds',
        '1',
      ]);
      assert.equal(run.status, 0, run.output);
      const log = readFileSync(join(folder, 'stepper.log'), 'utf8');
      const held = log
        .split('\n')
        .filter((line) => line.includes('limit is held'));
      assert.equal(held.length, 1, log);
      assert.ok(held[0]?.includes(join(folder, 'mode.txt')), log);
    },
  );
} finally {
  for (const folder of folders)
    rmSync(folder, { recursive: true, force: true });
}
assert.deepEqual(
  failures,
  [],
  `A bad mode file or a mode write:\n${failures.join('\n')}`,
);

process.stdout.write(
  'Cap self-test passed: each mode computed from planted machines, the efficiency processors from planted classes, the mode file and the carried variables read as the cap promises, a mode file that names no mode refused and reported, the mode file replaced whole, the folder read from THOTH_CAP_DIRECTORY or tmp/cap and recorded in the status.\n',
);
