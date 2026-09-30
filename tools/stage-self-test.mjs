/**
 * The shared shape of a stage's self-test: the stage, run over a copy of what it reads, refusing
 * each defect planted into that copy.
 *
 * A stage that takes part reads its inputs from `inputsRoot()`, which is the repository unless the
 * command line names a copy with `--inputs <dir>`. The copy holds only the files the stage reads, so
 * `node_modules` and anything the stage runs stay the repository's.
 *
 * The unchanged copy must pass first, so every red after it is a change from a green this run saw.
 * A plant must change what it plants into, and must be refused with the words it names. A refusal
 * pattern the unchanged run already prints proves nothing, so each is required to be absent there.
 *
 * Some stages observe through the process rather than through a file: a heap reading needs Node's
 * `--expose-gc`. Such a stage names the flags it runs with as `nodeArgs`, and a plant that gives
 * its own `nodeArgs` withdraws the observing mechanism instead of editing the copy. It must still
 * change something, so a plant that edits nothing and runs with the stage's own flags is refused.
 *
 * No run may change what it reads. `specs/12-verification.spec.md` section 9 forbids a failing run
 * rewriting the baseline it fails against, and a refusal read from the output cannot see that: a
 * stage that records its baseline while refusing prints the same words as one that does not. So
 * every file of the copy is compared with its bytes before each run, and every file of the
 * repository the copy was taken from is compared across the whole self-test, since a stage that
 * resolves its baseline without `inputsRoot()` writes there instead. A plant that declares
 * `rewrites` makes the stage rewrite that input, and is refused only when the comparison names it,
 * which is how the comparison is shown able to fail.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
);

export function inputsRoot(argv = process.argv) {
  const index = argv.indexOf('--inputs');
  return index === -1 ? repositoryRoot : resolve(argv[index + 1]);
}

export async function editText(root, path, edit) {
  const file = resolve(root, path);
  const before = await readFile(file, 'utf8');
  const after = edit(before);
  if (after === before)
    throw new Error(`The plant changed nothing in ${path}.`);
  await writeFile(file, after, 'utf8');
}

export const replaceOnce = (find, replace) => (text) => {
  if (text.split(find).length !== 2) {
    throw new Error(`The plant expects ${JSON.stringify(find)} exactly once.`);
  }
  return text.replace(find, () => replace);
};

export const editJson = (path, edit) => (root) =>
  editText(root, path, (text) => {
    const value = JSON.parse(text);
    edit(value);
    return `${JSON.stringify(value, null, 2)}\n`;
  });

/** The bytes of every file under `paths` in `root`, by path relative to `root`. */
export function inputDigests(root, paths) {
  const digests = new Map();
  // A plant may remove an input outright, and a run may; either reads as its files going missing.
  const visit = (path) => {
    if (!existsSync(path)) return;
    if (statSync(path).isDirectory()) {
      for (const entry of readdirSync(path)) visit(join(path, entry));
      return;
    }
    digests.set(
      relative(root, path).replaceAll('\\', '/'),
      createHash('sha256').update(readFileSync(path)).digest('hex'),
    );
  };
  for (const path of paths) visit(resolve(root, path));
  return digests;
}

/** The paths whose bytes differ between two readings, including any added or removed. */
export function changedInputs(before, after) {
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter((path) => before.get(path) !== after.get(path))
    .sort();
}

/**
 * Runs `script` with `args` over a fresh copy of `inputs` once unchanged and once per plant, and
 * prints the verdict. Resolves to the number of failures, which the caller turns into the status.
 */
export async function verifyStagePlants({
  stage,
  script,
  args = [],
  inputs,
  plants,
  nodeArgs = [],
  timeout = 180_000,
}) {
  // Inside the workspace, so a copied package resolves its dependencies from the repository's
  // `node_modules` the way the original does.
  const base = resolve(
    repositoryRoot,
    'tmp',
    `${stage.replaceAll(':', '-')}-self-test`,
  );
  const pristine = resolve(base, 'pristine');
  const work = resolve(base, 'work');
  const out = (line) => process.stdout.write(`${line}\n`);
  const run = (flags) => {
    const began = Date.now();
    const result = spawnSync(
      process.execPath,
      [...flags, resolve(repositoryRoot, script), ...args, '--inputs', work],
      { cwd: repositoryRoot, encoding: 'utf8', timeout },
    );
    return { ...result, ms: Date.now() - began };
  };
  const fresh = async () => {
    await rm(work, { recursive: true, force: true });
    await cp(pristine, work, { recursive: true });
  };

  const failures = [];
  const repositoryBefore = inputDigests(repositoryRoot, inputs);
  // Read after the plant rather than from the pristine copy, so what a plant edits is not taken
  // for something the run wrote.
  const runComparing = (flags) => {
    const before = inputDigests(work, inputs);
    const result = run(flags);
    return {
      ...result,
      changed: changedInputs(before, inputDigests(work, inputs)),
    };
  };
  const exercise = async () => {
    await rm(base, { recursive: true, force: true });
    for (const path of inputs) {
      await mkdir(dirname(resolve(pristine, path)), { recursive: true });
      await cp(resolve(repositoryRoot, path), resolve(pristine, path), {
        recursive: true,
      });
    }

    await fresh();
    const control = runComparing(nodeArgs);
    out(`control: status ${control.status} in ${control.ms} ms`);
    if (control.changed.length > 0) {
      failures.push(
        `The unchanged run changed what it reads: ${control.changed.join(', ')}.`,
      );
    }
    if (control.error !== undefined || control.status !== 0) {
      failures.push(
        `The unchanged copy does not pass, so no refusal would mean anything:\n${control.stdout}${control.stderr}${control.error ?? ''}`,
      );
      return;
    }
    const controlText = `${control.stdout}${control.stderr}`;

    for (const { id, plant, nodeArgs: planted, refusal, rewrites } of plants) {
      if (rewrites !== undefined) {
        await fresh();
        await plant(work);
        const result = runComparing(nodeArgs);
        out(`${id}: status ${result.status} in ${result.ms} ms`);
        if (result.error !== undefined) {
          failures.push(
            `${id}: the stage did not finish: ${String(result.error)}`,
          );
        } else if (result.status === 0) {
          failures.push(
            `${id}: the stage passed; the plant is a failing run that rewrites ${rewrites}.`,
          );
        } else if (!result.changed.includes(rewrites)) {
          failures.push(
            `${id}: the failing run rewrote ${rewrites} and the comparison of what it reads did not name it (it named ${result.changed.join(', ') || 'nothing'}).`,
          );
        }
        continue;
      }
      if (refusal.test(controlText)) {
        failures.push(`${id}: the unchanged run already prints ${refusal}.`);
        continue;
      }
      const flags = planted ?? nodeArgs;
      if (
        plant === undefined &&
        JSON.stringify(flags) === JSON.stringify(nodeArgs)
      ) {
        failures.push(
          `${id}: the plant edits nothing and runs with the stage's own flags.`,
        );
        continue;
      }
      await fresh();
      if (plant !== undefined) await plant(work);
      const result = runComparing(flags);
      out(`${id}: status ${result.status} in ${result.ms} ms`);
      const printed = `${result.stdout}${result.stderr}`;
      if (result.changed.length > 0) {
        failures.push(
          `${id}: the run changed what it reads: ${result.changed.join(', ')}.`,
        );
      }
      if (result.error !== undefined) {
        failures.push(
          `${id}: the stage did not finish: ${String(result.error)}`,
        );
      } else if (result.status === 0) {
        failures.push(`${id}: the stage passed with the defect planted.`);
      } else if (!refusal.test(printed)) {
        failures.push(
          `${id}: the stage failed without naming the defect (${refusal}):\n${printed.slice(0, 2_000)}`,
        );
      }
    }
  };

  try {
    await exercise();
  } finally {
    await rm(base, { recursive: true, force: true });
    const repositoryChanged = changedInputs(
      repositoryBefore,
      inputDigests(repositoryRoot, inputs),
    );
    if (repositoryChanged.length > 0) {
      failures.push(
        `The repository's own copy of what the stage reads changed during the self-test: ${repositoryChanged.join(', ')}.`,
      );
    }
    if (failures.length > 0) {
      out(`${stage}:self-test RED: ${failures.length} failures.`);
      for (const failure of failures) out(`  ${failure}`);
    } else {
      out(
        `${stage}:self-test GREEN: the stage refused all ${plants.length} planted defects, each by name, and no run changed what it reads except where a plant made it.`,
      );
    }
  }
  return failures.length;
}
