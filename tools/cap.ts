/**
 * The cap: heavy work on a Windows machine that is also someone's workstation, held to limits the
 * machine's owner chooses by mode, one command at a time.
 *
 * The gate and a mutation run hold themselves to a share of the processors and to below-normal
 * priority, but a process's own settings do not hold the helper threads beside its JavaScript, the
 * browsers it starts or the compilers they start, and nothing in them holds memory. A Windows job
 * object holds all of them: every process born in the job is under its processor rate, its memory
 * limit and its affinity. So a capped command is created suspended, put in one named job, and only
 * then resumed (`cap/cap-run.ps1`), and the job's name is the lock that keeps a second command out.
 *
 * Three modes, each computed from the machine it runs on (`cap/cap-lib.cs`, `TargetOf`):
 *
 * - **day**: a hard processor cap of two thirds of the machine, a job memory limit of two thirds of
 *   the memory Windows reports, below-normal priority.
 * - **night**: no limit, normal priority, and the work told it has every logical processor.
 * - **efficiency**: the efficiency cores only, as the processors' efficiency classes give them
 *   (half of the logical processors where there is one class), half of the memory, below normal.
 *
 * The mode is kept in `tmp/cap/mode.txt`, outside every tracked file, or in the folder
 * `THOTH_CAP_DIRECTORY` names. With no mode file the cap is in day mode; a mode file that cannot be
 * read, or holds another word, names no mode, and nothing starts under it (exit 125, naming the
 * file and `node tools/cap.ts mode`), while a command already running keeps its limits and records
 * the change once in its status. `pnpm run clean`
 * empties `tmp` but keeps that folder whole, so a clean changes neither the mode nor the state of
 * a running command. Switching the mode switches a running command too,
 * and lowers a memory limit only as far as what the job holds allows, so a switch ends nothing.
 *
 * A command is started detached (`cap/cap-start.ps1`): Win32_Process.Create, with
 * CREATE_BREAKAWAY_FROM_JOB, starts the launcher outside every job the caller is in, so it outlives
 * the shell and the program that asked for it. Such a process starts from the user's default
 * environment; the caller's `THOTH_*` variables and `PATH` are carried to it in a request file, and
 * nothing else of the caller's environment is.
 *
 * Usage:
 *
 *     node tools/cap.ts start --log <file> --status <file> [<option>...] -- <command line>
 *     node tools/cap.ts mode [day|night|efficiency]    no word prints the mode and the job
 *     node tools/cap.ts policy                         each mode's limits on this machine
 *     node tools/cap.ts running [<job name>...]        exit 0 and the names when a job exists
 *     node tools/cap.ts query [<pid>...]               the job's limits and whether each pid is in it
 *     node tools/cap.ts inside                         exit 0 when this process runs in the job
 *
 * The options of `start` are `--priority normal` (the level in day and efficiency, below normal
 * otherwise), `--wait <seconds>` (how long to wait for a running command to end before refusing),
 * `--manages-priority` (the command sets its own processes' priorities from the level file, as the
 * gate does) and `--directory <dir>` (where the command runs, the current directory otherwise).
 * `start` exits once the launcher is started; the command's output goes to the log, and how it
 * ended to the status file, with the cap's folder. `start` and the launcher exit 125 when the mode
 * file names no mode; the launcher exits 124 when another capped command holds the job and 125
 * when it could not start the command.
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scripts = resolve(dirname(fileURLToPath(import.meta.url)), 'cap');

/** Windows PowerShell 5.1, which compiles the C# the scripts carry, not a separately installed one. */
function powerShell(): string {
  return resolve(
    process.env['SystemRoot'] ?? 'C:\\Windows',
    'System32/WindowsPowerShell/v1.0/powershell.exe',
  );
}

/** Runs one of the cap's scripts with its output passed through, and returns its exit code. */
export function runCapScript(
  script: string,
  args: readonly string[],
  options: { readonly capture?: boolean } = {},
): { readonly code: number; readonly output: string } {
  if (process.platform !== 'win32') {
    throw new Error(
      'The cap holds work in a Windows job object and runs on Windows only.',
    );
  }
  const run = spawnSync(
    powerShell(),
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
      stdio: options.capture === true ? 'pipe' : 'inherit',
      windowsHide: true,
    },
  );
  if (run.error !== undefined) throw run.error;
  return {
    code: run.status ?? 1,
    // With inherited output there is nothing captured, and spawnSync gives null for it.
    output: options.capture === true ? `${run.stdout}${run.stderr}` : '',
  };
}

/**
 * The names among the given ones (this cap's job when none are given) that a job exists under in
 * this session. Empty off Windows, where there is no cap.
 */
export function capJobsRunning(names: readonly string[] = []): string[] {
  if (process.platform !== 'win32') return [];
  const { code, output } = runCapScript(
    'cap-run.ps1',
    ['-Running', ...(names.length > 0 ? ['-Names', names.join(',')] : [])],
    { capture: true },
  );
  if (code !== 0 && code !== 1) {
    throw new Error(`The cap could not read which jobs exist:\n${output}`);
  }
  return code === 0
    ? output
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean)
    : [];
}

/** What ends the options of `start`; everything after it is the command line. */
const END_OF_OPTIONS = '--';
const USAGE =
  `Usage: node tools/cap.ts start --log <file> --status <file> [--priority normal] [--wait <seconds>] [--manages-priority] [--directory <dir>] ${END_OF_OPTIONS} <command line>\n` +
  '       node tools/cap.ts mode [day|night|efficiency] | policy | running [<job name>...] | query [<pid>...] | inside';

function startArguments(rest: readonly string[]): string[] {
  const separator = rest.indexOf(END_OF_OPTIONS);
  const options = separator === -1 ? rest : rest.slice(0, separator);
  const command = separator === -1 ? [] : rest.slice(separator + 1);
  if (command.length === 0) throw new Error(`No command after --.\n${USAGE}`);
  const out: string[] = [];
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    const value = (): string => {
      const next = options[index + 1];
      if (next === undefined) throw new Error(`${option} needs a value.`);
      index += 1;
      return next;
    };
    switch (option) {
      case '--log':
        out.push('-Log', resolve(value()));
        break;
      case '--status':
        out.push('-Status', resolve(value()));
        break;
      case '--directory':
        out.push('-Directory', resolve(value()));
        break;
      case '--wait':
        out.push('-WaitSeconds', String(Number.parseInt(value(), 10)));
        break;
      case '--priority': {
        const level = value();
        if (level !== 'normal' && level !== 'below-normal') {
          throw new Error(
            `--priority is normal or below-normal, not ${level}.`,
          );
        }
        out.push('-Priority', level === 'normal' ? 'Normal' : 'BelowNormal');
        break;
      }
      case '--manages-priority':
        out.push('-ManagesPriority');
        break;
      default:
        throw new Error(`Unknown option ${option}.\n${USAGE}`);
    }
  }
  if (!out.includes('-Log') || !out.includes('-Status')) {
    throw new Error(`start needs --log and --status.\n${USAGE}`);
  }
  return [...out, '-Command', command.join(' ')];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [action, ...rest] = process.argv.slice(2);
  let code: number;
  switch (action) {
    case 'start':
      code = runCapScript('cap-start.ps1', startArguments(rest)).code;
      break;
    case 'mode':
      if (rest.length > 1) throw new Error(USAGE);
      code = runCapScript('cap-mode.ps1', [rest[0] ?? 'show']).code;
      break;
    case 'policy':
      code = runCapScript('cap-run.ps1', ['-Policy']).code;
      break;
    case 'running':
      code = runCapScript('cap-run.ps1', [
        '-Running',
        ...(rest.length > 0 ? ['-Names', rest.join(',')] : []),
      ]).code;
      break;
    case 'query':
      code = runCapScript('cap-run.ps1', [
        '-Query',
        ...(rest.length > 0 ? ['-Pids', rest.join(',')] : []),
      ]).code;
      break;
    case 'inside':
      code = runCapScript('cap-run.ps1', ['-Inside']).code;
      break;
    default:
      process.stderr.write(`${USAGE}\n`);
      code = 2;
  }
  process.exitCode = code;
}
