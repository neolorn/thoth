/**
 * Generation inside `ng build`, `ng serve` and `ng test`.
 *
 * `specs/10-compiler-and-tooling.spec.md` section 14 is what this implements: each builder
 * generates first, then runs an Angular target the workspace names, and in a session that watches
 * it keeps generating in the same process for as long as that target runs. The Angular target
 * keeps its own builder and its own options, so `@angular/build:dev-server` and
 * `@angular/build:unit-test` go on reading an `@angular/build:application` target, as they
 * require. What the command line gives for the Angular builder is passed on to it through the
 * overrides `scheduleTarget` takes, and Angular validates it against its own schema, so an option
 * the installed Angular lacks is refused in Angular's words.
 *
 * Only what `@angular-devkit/architect` publishes is used: `createBuilder`, `scheduleTarget` and
 * `targetFromTargetString` as the Angular CLI builder guide documents them, and `getProjectMetadata`,
 * `getTargetOptions` and `addTeardown` from the same published `BuilderContext` interface. Section
 * 10 of `specs/02-packages-and-platform.spec.md` rules out anything private.
 */

import {
  targetFromTargetString,
  targetStringFromTarget,
  type BuilderContext,
  type BuilderOutput,
  type BuilderRun,
  type Target,
} from '@angular-devkit/architect';
import { resolve } from 'node:path';

import { humanDiagnostic, orderedDiagnostics } from './diagnostic-text.js';
import { diagnosticsBlock, type ToolkitResult } from './diagnostics.js';
import type { GenerateProjectResult, WatchCycle } from './project-host.js';
import {
  angularBuilderOptions,
  misplacedAngularOptions,
  type AngularCommand,
} from './angular-builder-schemas.js';

/**
 * A queue the builder waits on, fed by the Angular run, the watch, and the builder's own stop.
 *
 * Each source finishes on its own schedule, and an async generator can wait on only one promise
 * at a time, so every one of them is turned into an event here.
 */
type RunEvent =
  | { readonly kind: 'output'; readonly output: BuilderOutput }
  | { readonly kind: 'cycle'; readonly cycle: WatchCycle }
  | { readonly kind: 'target-ended'; readonly error?: unknown }
  | {
      readonly kind: 'watch-ended';
      readonly result: ToolkitResult<unknown>;
    }
  | { readonly kind: 'stopped' };

class RunEvents {
  readonly #pending: RunEvent[] = [];
  #waiting: ((event: RunEvent) => void) | undefined;

  push(event: RunEvent): void {
    const waiting = this.#waiting;
    if (waiting === undefined) {
      this.#pending.push(event);
      return;
    }
    this.#waiting = undefined;
    waiting(event);
  }

  next(): Promise<RunEvent> {
    const event = this.#pending.shift();
    if (event !== undefined) return Promise.resolve(event);
    return new Promise((resolveEvent) => {
      this.#waiting = resolveEvent;
    });
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Writes a generation's diagnostics to the builder's log and says whether the run may go on.
 *
 * A result that succeeded and still carries an error-severity diagnostic blocks, as it does for
 * `thoth generate`, which section 12 of `specs/10-compiler-and-tooling.spec.md` keys on
 * severity.
 */
function reportGeneration(
  context: BuilderContext,
  result: ToolkitResult<GenerateProjectResult>,
): boolean {
  for (const diagnostic of orderedDiagnostics(result.diagnostics)) {
    const line = humanDiagnostic(diagnostic).trimEnd();
    if (diagnostic.severity === 'error') context.logger.error(line);
    else if (diagnostic.severity === 'warning') context.logger.warn(line);
    else context.logger.info(line);
  }
  if (!result.ok || diagnosticsBlock(result.diagnostics)) return false;
  const { publication } = result.value;
  context.logger.info(
    publication.changed
      ? `Thoth generated ${publication.written.length} files and removed ${publication.removed.length} stale files.`
      : 'Thoth generated output is already current.',
  );
  return true;
}

/**
 * Where the Thoth project of an Angular project is found from: that project's root.
 *
 * A workspace can hold several applications, each with its own `thoth.config.json`, and
 * discovery from the workspace root would find none of them.
 */
async function projectDirectory(
  context: BuilderContext,
  project: string,
): Promise<string> {
  const metadata = await context.getProjectMetadata(project);
  const root = metadata['root'];
  return resolve(context.workspaceRoot, typeof root === 'string' ? root : '');
}

/**
 * Says which Angular options `angular.json` sets on the Thoth target, in the words the command
 * fails with, or nothing when it sets none.
 */
async function misplacedOptionsError(
  context: BuilderContext,
  command: AngularCommand,
  target: Target,
): Promise<string | undefined> {
  if (context.target === undefined) return undefined;
  const names = misplacedAngularOptions(
    command,
    await context.getTargetOptions(context.target),
  );
  if (names.length === 0) return undefined;
  const listed =
    names.length === 1
      ? `${names[0]} is an option`
      : `${names.slice(0, -1).join(', ')} and ${names.at(-1)} are options`;
  const pronoun = names.length === 1 ? 'it' : 'them';
  return `${listed} of ${targetStringFromTarget(target)}. Set ${pronoun} on that target in angular.json, or give ${pronoun} on the command line.`;
}

/**
 * Whether the Angular run will outlive its first result, which is when generation has to keep up.
 *
 * `ng serve` always does. For the other two the builder's own `watch` decides when it is given,
 * and otherwise the target's configured `watch`. Angular's application builder defaults it to
 * false. Its unit-test builder decides by the terminal when nothing sets it, and a test session
 * that may watch is watched: a watch that outlives nothing ends with the run.
 */
async function sessionWatches(
  context: BuilderContext,
  command: AngularCommand,
  target: Target,
  watch: boolean | undefined,
): Promise<boolean> {
  if (command === 'serve') return true;
  if (watch !== undefined) return watch;
  const configured = (await context.getTargetOptions(target))['watch'];
  if (typeof configured === 'boolean') return configured;
  return command === 'test';
}

/**
 * Generates, runs the Angular target, and in a watching session keeps generating until it ends.
 *
 * Every result the Angular run produces is passed on as this builder's own, so `ng` exits with the
 * Angular run's status. A failed generation in a session is reported as a failed result without
 * stopping the Angular run, the way Angular reports a failed rebuild, and the next generation that
 * succeeds reports the Angular run's last result again.
 */
export async function* runAngularCommand(
  command: AngularCommand,
  rawOptions: Readonly<Record<string, unknown>>,
  context: BuilderContext,
): AsyncGenerator<BuilderOutput> {
  const options = angularBuilderOptions(command, rawOptions);
  let target: Target;
  try {
    target = targetFromTargetString(options.target, context.target?.project);
  } catch (error) {
    yield { success: false, error: errorText(error) };
    return;
  }
  const misplaced = await misplacedOptionsError(context, command, target);
  if (misplaced !== undefined) {
    yield { success: false, error: misplaced };
    return;
  }
  const events = new RunEvents();
  let stopped = false;
  // Raised by the teardown while the generation below is awaited, which is an assignment the
  // compiler cannot order against a plain read of the variable.
  const wasStopped = (): boolean => stopped;
  context.addTeardown(() => {
    stopped = true;
    events.push({ kind: 'stopped' });
  });
  const cwd = await projectDirectory(context, target.project);
  const watching = await sessionWatches(
    context,
    command,
    target,
    options.watch,
  );
  // Read from the options Architect parsed out of the command line and `angular.json`, so every
  // value is JSON.
  const overrides = options.angular as NonNullable<
    Parameters<BuilderContext['scheduleTarget']>[1]
  >;
  const { generateProject, watchProject } = await import('./project-host.js');
  const pseudo = options.pseudoLocales === true ? { pseudoLocales: true } : {};

  const controller = new AbortController();
  let watch: Promise<ToolkitResult<unknown>> | undefined;
  if (watching) {
    watch = watchProject({
      cwd,
      ...pseudo,
      signal: controller.signal,
      onCycle: (cycle) => events.push({ kind: 'cycle', cycle }),
    });
    void watch.then((result) => events.push({ kind: 'watch-ended', result }));
  }
  let run: BuilderRun | undefined;
  try {
    let first: ToolkitResult<GenerateProjectResult> | undefined;
    if (watch === undefined) {
      first = await generateProject({ cwd, ...pseudo });
    } else {
      while (first === undefined) {
        const event = await events.next();
        if (event.kind === 'stopped') return;
        if (event.kind === 'cycle') first = event.cycle.result;
        if (event.kind === 'watch-ended') {
          reportWatchEnd(context, event.result);
          yield { success: false, error: 'Thoth could not watch the project.' };
          return;
        }
      }
    }
    if (!reportGeneration(context, first)) {
      yield {
        success: false,
        error: `Thoth generation failed, so ${targetStringFromTarget(target)} did not run.`,
      };
      return;
    }
    if (wasStopped()) return;
    run = await context.scheduleTarget(target, overrides);
    const subscription = run.output.subscribe({
      next: (output) => events.push({ kind: 'output', output }),
      error: (error: unknown) => events.push({ kind: 'target-ended', error }),
      complete: () => events.push({ kind: 'target-ended' }),
    });
    context.addTeardown(() => subscription.unsubscribe());
    let lastOutput: BuilderOutput = { success: true };
    let generationFailed = false;
    for (;;) {
      const event = await events.next();
      switch (event.kind) {
        case 'stopped':
          return;
        case 'output':
          lastOutput = event.output;
          yield event.output;
          break;
        case 'target-ended':
          if (event.error !== undefined) {
            yield { success: false, error: errorText(event.error) };
          }
          return;
        case 'cycle':
          if (!reportGeneration(context, event.cycle.result)) {
            generationFailed = true;
            yield {
              success: false,
              error:
                'Thoth generation failed. The modules from the last successful generation stay in place until the catalogs are fixed.',
            };
          } else if (generationFailed) {
            generationFailed = false;
            yield lastOutput;
          }
          break;
        case 'watch-ended':
          reportWatchEnd(context, event.result);
          yield {
            success: false,
            error: `Thoth stopped watching the project, so ${targetStringFromTarget(target)} was stopped.`,
          };
          return;
      }
    }
  } finally {
    controller.abort();
    await run?.stop();
    await watch;
  }
}

function reportWatchEnd(
  context: BuilderContext,
  result: ToolkitResult<unknown>,
): void {
  for (const diagnostic of orderedDiagnostics(result.diagnostics)) {
    context.logger.error(humanDiagnostic(diagnostic).trimEnd());
  }
}
