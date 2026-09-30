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
 */
import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
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
  const run = () => {
    const began = Date.now();
    const result = spawnSync(
      process.execPath,
      [resolve(repositoryRoot, script), ...args, '--inputs', work],
      { cwd: repositoryRoot, encoding: 'utf8', timeout },
    );
    return { ...result, ms: Date.now() - began };
  };
  const fresh = async () => {
    await rm(work, { recursive: true, force: true });
    await cp(pristine, work, { recursive: true });
  };

  const failures = [];
  try {
    await rm(base, { recursive: true, force: true });
    for (const path of inputs) {
      await mkdir(dirname(resolve(pristine, path)), { recursive: true });
      await cp(resolve(repositoryRoot, path), resolve(pristine, path), {
        recursive: true,
      });
    }

    await fresh();
    const control = run();
    out(`control: status ${control.status} in ${control.ms} ms`);
    if (control.error !== undefined || control.status !== 0) {
      failures.push(
        `The unchanged copy does not pass, so no refusal would mean anything:\n${control.stdout}${control.stderr}${control.error ?? ''}`,
      );
      return failures.length;
    }
    const controlText = `${control.stdout}${control.stderr}`;

    for (const { id, plant, refusal } of plants) {
      if (refusal.test(controlText)) {
        failures.push(`${id}: the unchanged run already prints ${refusal}.`);
        continue;
      }
      await fresh();
      await plant(work);
      const result = run();
      out(`${id}: status ${result.status} in ${result.ms} ms`);
      const printed = `${result.stdout}${result.stderr}`;
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
    return failures.length;
  } finally {
    await rm(base, { recursive: true, force: true });
    if (failures.length > 0) {
      out(`${stage}:self-test RED: ${failures.length} failures.`);
      for (const failure of failures) out(`  ${failure}`);
    } else {
      out(
        `${stage}:self-test GREEN: the stage refused all ${plants.length} planted defects, each by name.`,
      );
    }
  }
}
