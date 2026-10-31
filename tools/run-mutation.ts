/**
 * A mutation run, started the way a heavy job is.
 *
 * Stryker run bare takes one worker per logical processor less one at normal priority, beside
 * whatever else is going. Its verdicts are timed: a mutant is given a multiple of what its tests
 * took in the dry run, and one that runs out of it is scored as killed. So a run beside a gate, or
 * beside another mutation run, scores survivors as detected and nothing in the report says so.
 * Both configurations set the multiple to eight and add ten seconds, so a mutant that is only slow
 * reaches its verdict. That does not cover a test that fails on its own time limit beside other
 * work, which scores its mutant as killed whatever the clock, so the run still goes alone.
 *
 * This takes the lock every heavy job takes (`heavy-job-lock.ts`) and hands Stryker the processor
 * budget the gate runs on (`gate-resources.ts`) as its concurrency unless the command line names
 * one. It sets its own priority, which Stryker and its workers inherit, from the level the gate
 * reads (`priorityLifted`): started under the cap with `--manages-priority`, which names the cap's
 * level file in `THOTH_VERIFY_PRIORITY_FILE`, it runs at normal priority while that file says
 * `normal` (the cap's night) and below normal otherwise (day and efficiency); run bare, with no
 * file named, it runs below normal. The cap leaves the processes of such a command to it, so while
 * the run goes it reads the file again every thirty seconds and moves its own tree on a switch: a
 * switch to normal raises what runs below it, a switch away lowers what runs at normal.
 *
 * Usage: node tools/run-mutation.ts [<stryker configuration>] [stryker options]
 */
import { spawn } from 'node:child_process';
import { getPriority, setPriority } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { priorityLifted, processorBudget } from './gate-resources.ts';
import { holdHeavyJobLock } from './heavy-job-lock.ts';
import {
  descendantsOf,
  levelForSystem,
  levelInReading,
  liftUp,
  type PriorityLevel,
  type ProcessEntry,
  readProcesses,
} from './process-tree.ts';

/** The level a mutation run takes: the cap's while it names normal, below normal otherwise. */
export const mutationLevel = (
  environment: Readonly<Record<string, string | undefined>> = process.env,
  read?: (path: string) => string,
): PriorityLevel =>
  priorityLifted(environment, read) ? 'normal' : 'below-normal';

/**
 * Moves the processes of a run's tree to `level`, and answers how many it moved. To normal, each
 * one below normal is raised; to below normal, each one at normal is lowered. A process above
 * normal, which a browser engine sets for itself, is left either way, and one that cannot be moved
 * (it has ended) is left and is not counted.
 */
export function followLevel(
  tree: readonly Pick<ProcessEntry, 'pid' | 'priority'>[],
  level: PriorityLevel,
  set: (pid: number, priority: number) => void,
  platform: NodeJS.Platform = process.platform,
): number {
  const normal = levelInReading('normal', platform);
  if (level === 'normal') {
    return liftUp(tree, normal, levelForSystem('normal'), set);
  }
  let lowered = 0;
  for (const entry of tree) {
    if (entry.priority !== normal) continue;
    try {
      set(entry.pid, levelForSystem('below-normal'));
      lowered += 1;
    } catch {
      // Ended between the reading and the call.
    }
  }
  return lowered;
}

const FOLLOW_SECONDS = 30;

async function main(): Promise<void> {
  const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const passed = process.argv.slice(2);
  const configuration =
    passed.find((argument) => !argument.startsWith('-')) ??
    'stryker.config.mjs';

  const lock = await holdHeavyJobLock(`a mutation run (${configuration})`);

  let level = mutationLevel();
  setPriority(levelForSystem(level));
  if (getPriority() !== levelForSystem(level)) {
    throw new Error(
      `The mutation run asked for priority ${levelForSystem(level)} (${level}) and has ${getPriority()}, so its workers would not run at that level.`,
    );
  }
  process.stdout.write(`The mutation run starts at ${level} priority.\n`);

  const names = (option: string): boolean =>
    passed.some(
      (argument) => argument === option || argument.startsWith(`${option}=`),
    );
  const concurrency =
    names('--concurrency') || names('-c')
      ? []
      : ['--concurrency', String(processorBudget())];
  const args = ['exec', 'stryker', 'run', ...passed, ...concurrency];
  const child = spawn(
    process.platform === 'win32'
      ? (process.env['ComSpec'] ?? 'cmd.exe')
      : 'pnpm',
    process.platform === 'win32' ? ['/d', '/s', '/c', 'pnpm', ...args] : args,
    {
      cwd: workspaceRoot,
      stdio: 'inherit',
      env: { ...process.env, ...lock.environment },
    },
  );

  // Only a run handed a level file can see the level change.
  let following = false;
  const follow =
    process.env['THOTH_VERIFY_PRIORITY_FILE'] === undefined ||
    process.env['THOTH_VERIFY_PRIORITY_FILE'] === ''
      ? undefined
      : setInterval(() => {
          const now = mutationLevel();
          if (now === level || following) return;
          following = true;
          const previous = level;
          level = now;
          try {
            setPriority(levelForSystem(level));
          } catch {
            // Off Windows a process cannot raise itself; its tree is moved below as far as it can be.
          }
          void readProcesses()
            .then((reading) => {
              const moved = followLevel(
                descendantsOf(
                  reading.processes,
                  process.pid,
                  new Set([reading.reader]),
                ),
                level,
                setPriority,
              );
              process.stdout.write(
                `The cap level is now ${level}: ${moved} process(es) of the run moved to it.\n`,
              );
            })
            .catch((error: unknown) => {
              // Tried again at the next reading of the level.
              level = previous;
              process.stderr.write(
                `The run's processes could not be read to follow the cap level: ${(error as Error).message}\n`,
              );
            })
            .finally(() => {
              following = false;
            });
        }, FOLLOW_SECONDS * 1000);

  child.once('error', (error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
  child.once('close', (code) => {
    if (follow !== undefined) clearInterval(follow);
    process.exitCode = code ?? 1;
  });
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
