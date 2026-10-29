import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import {
  Architect,
  createBuilder,
  type BuilderOutput,
  type BuilderRun,
  type Target,
} from '@angular-devkit/architect';
import { TestingArchitectHost } from '@angular-devkit/architect/testing';
import { Observable } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';

import build from '../src/angular-builder-build.js';
import serve from '../src/angular-builder-serve.js';
import test from '../src/angular-builder-test.js';
import {
  angularBuilderSchema,
  type AngularCommand,
} from '../src/angular-builder-schemas.js';
import { initializeProject } from '../src/project-host.js';
import { WAIT_BOUND_MS } from './fixtures.js';

/**
 * `ng build`, `ng serve` and `ng test` generate first and then run the Angular target the
 * workspace names, and a session that watches keeps generating for as long as that target runs.
 *
 * Each builder is scheduled by Architect itself, through the in-memory host the Angular CLI builder
 * guide tests builders with, against a real project on disk. The Angular targets are stand-ins
 * that record what they found when they started, which is the only way to see that generation
 * came first: a real Angular build reads the generated modules, and so does this one, by looking
 * for them.
 */

const roots: string[] = [];
const runs: BuilderRun[] = [];

afterEach(async () => {
  await Promise.all(runs.splice(0).map((run) => run.stop()));
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function write(root: string, path: string, text: string): Promise<void> {
  const absolute = resolve(root, ...path.split('/'));
  await mkdir(resolve(absolute, '..'), { recursive: true });
  await writeFile(absolute, text, 'utf8');
}

const CATALOG = 'i18n/shell/en-US.yaml';
const GENERATED = 'src/generated/i18n';
const catalog = (title: string): string => `messages:\n  app-title: ${title}\n`;
/** A placeholder that never closes, which no MessageFormat 2 parser accepts. */
const BROKEN_CATALOG = 'messages:\n  app-title: "Broken {$name"\n';

async function project(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'angular-builders-'));
  roots.push(root);
  await write(
    root,
    'package.json',
    `${JSON.stringify({ name: '@example/builders', private: true, type: 'module' }, null, 2)}\n`,
  );
  const initialized = await initializeProject({
    project: root,
    configuration: {
      sourceLocale: 'en-US',
      defaultLocale: 'en-US',
      locales: ['en-US'],
    },
  });
  expect(initialized.ok).toBe(true);
  await write(
    root,
    'tsconfig.app.json',
    `${JSON.stringify({ compilerOptions: { strict: true, target: 'ES2022', module: 'preserve', moduleResolution: 'bundler', resolvePackageJsonImports: true }, include: ['src/**/*.ts'] }, null, 2)}\n`,
  );
  await write(
    root,
    'src/app.ts',
    "import { messages } from '#i18n/shell';\n\nexport const title = messages.appTitle.messageId;\n",
  );
  await write(root, CATALOG, catalog('Started'));
  return root;
}

/** Everything generated, as one text, or `undefined` before anything is. */
async function generatedText(root: string): Promise<string | undefined> {
  let names: string[];
  try {
    names = await readdir(resolve(root, GENERATED), { recursive: true });
  } catch {
    return undefined;
  }
  const texts = await Promise.all(
    names.map((name) =>
      readFile(resolve(root, GENERATED, name), 'utf8').catch(() => ''),
    ),
  );
  return texts.join('\n');
}

const pause = (milliseconds: number): Promise<void> =>
  new Promise((done) => setTimeout(done, milliseconds));

async function until(condition: () => boolean | Promise<boolean>) {
  const end = Date.now() + WAIT_BOUND_MS;
  while (Date.now() < end) {
    if (await condition()) return true;
    await pause(25);
  }
  return condition();
}

/** What an Angular target saw when it started, and what it was given. */
interface TargetStart {
  readonly generated: string | undefined;
  readonly options: Readonly<Record<string, unknown>>;
}

/** A builder schema in the shape the host takes, which is JSON and nothing else. */
const optionSchema = (command: AngularCommand) =>
  JSON.parse(JSON.stringify(angularBuilderSchema(command))) as Parameters<
    TestingArchitectHost['addBuilder']
  >[3];

class WorkspaceHost extends TestingArchitectHost {
  override getProjectMetadata() {
    return Promise.resolve({ root: '' });
  }
}

interface Workspace {
  readonly architect: Architect;
  readonly logs: string[];
  readonly starts: TargetStart[];
  /** How many long-running Angular sessions are open now. */
  readonly open: () => number;
}

function workspace(root: string): Workspace {
  const host = new WorkspaceHost(root, root);
  const starts: TargetStart[] = [];
  let open = 0;
  host.addBuilder(
    '@neolorn/thoth-toolkit:build',
    build,
    'Thoth build',
    optionSchema('build'),
  );
  host.addBuilder(
    '@neolorn/thoth-toolkit:serve',
    serve,
    'Thoth serve',
    optionSchema('serve'),
  );
  host.addBuilder(
    '@neolorn/thoth-toolkit:test',
    test,
    'Thoth test',
    optionSchema('test'),
  );
  host.addBuilder(
    '@example/angular:once',
    createBuilder(async (options) => {
      starts.push({ generated: await generatedText(root), options });
      return { success: true };
    }),
  );
  host.addBuilder(
    '@example/angular:session',
    createBuilder(
      (options) =>
        new Observable<BuilderOutput>((subscriber) => {
          open += 1;
          void generatedText(root).then((generated) => {
            starts.push({ generated, options });
            subscriber.next({ success: true });
          });
          return () => {
            open -= 1;
          };
        }),
    ),
  );
  host.addTarget(
    { project: 'app', target: 'build' },
    '@neolorn/thoth-toolkit:build',
    { buildTarget: 'app:angular-build' },
  );
  host.addTarget(
    { project: 'app', target: 'angular-build' },
    '@example/angular:once',
  );
  host.addTarget(
    { project: 'app', target: 'serve' },
    '@neolorn/thoth-toolkit:serve',
    { serveTarget: ':angular-serve' },
  );
  host.addTarget(
    { project: 'app', target: 'angular-serve' },
    '@example/angular:session',
  );
  host.addTarget(
    { project: 'app', target: 'test' },
    '@neolorn/thoth-toolkit:test',
    { testTarget: 'app:angular-test' },
  );
  host.addTarget(
    { project: 'app', target: 'angular-test' },
    '@example/angular:once',
  );
  const logs: string[] = [];
  return {
    architect: new Architect(host),
    logs,
    starts,
    open: () => open,
  };
}

async function schedule(
  { architect, logs }: Workspace,
  target: Target,
  overrides: Readonly<Record<string, boolean>> = {},
): Promise<{ run: BuilderRun; outputs: BuilderOutput[] }> {
  const logger = {
    createChild: () => ({
      next: (entry: { readonly level: string; readonly message: string }) =>
        logs.push(`${entry.level} ${entry.message}`),
    }),
  };
  const run = await architect.scheduleTarget(target, overrides, {
    logger: logger as never,
  });
  runs.push(run);
  const outputs: BuilderOutput[] = [];
  run.output.subscribe((output) => outputs.push(output));
  return { run, outputs };
}

describe('the Angular builders', () => {
  it('generate before ng build runs the Angular build target', async () => {
    const root = await project();
    const host = workspace(root);
    expect(await generatedText(root)).toBeUndefined();

    const { run } = await schedule(host, { project: 'app', target: 'build' });
    const result = await run.result;

    expect(result.success).toBe(true);
    expect(host.starts).toHaveLength(1);
    expect(host.starts[0]?.generated ?? '').toContain('Started');
    expect(host.logs.join('\n')).toContain('Thoth generated');
  });

  it('end ng build without running the Angular target when a catalog is broken', async () => {
    const root = await project();
    await write(root, CATALOG, BROKEN_CATALOG);
    const host = workspace(root);

    const { run } = await schedule(host, { project: 'app', target: 'build' });
    const result = await run.result;

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      'Thoth generation failed, so app:angular-build did not run.',
    );
    expect(host.starts).toHaveLength(0);
    expect(host.logs.join('\n')).toMatch(
      /^error i18n\/shell\/en-US\.yaml:\d+:\d+: error TH\d{4}: /mu,
    );
  });

  it('pass watch on to ng test and generate once when it does not watch', async () => {
    const root = await project();
    const host = workspace(root);

    const { run } = await schedule(
      host,
      { project: 'app', target: 'test' },
      { watch: false },
    );
    const result = await run.result;

    expect(result.success).toBe(true);
    expect(host.starts).toHaveLength(1);
    expect(host.starts[0]?.options['watch']).toBe(false);
    expect(host.starts[0]?.generated ?? '').toContain('Started');
  });

  it('keep generating for as long as ng serve runs, and report a broken catalog without stopping it', async () => {
    const root = await project();
    const host = workspace(root);

    const { run, outputs } = await schedule(host, {
      project: 'app',
      target: 'serve',
    });
    expect(await until(() => host.starts.length === 1)).toBe(true);
    expect(host.starts[0]?.generated ?? '').toContain('Started');

    await write(root, CATALOG, catalog('Edited'));
    expect(
      await until(
        async () => (await generatedText(root))?.includes('Edited') ?? false,
      ),
    ).toBe(true);

    await write(root, CATALOG, BROKEN_CATALOG);
    expect(await until(() => outputs.some(({ success }) => !success))).toBe(
      true,
    );
    expect(host.logs.join('\n')).toMatch(/error TH\d{4}: /u);
    expect(host.open()).toBe(1);
    expect(await generatedText(root)).toContain('Edited');

    await write(root, CATALOG, catalog('Fixed'));
    expect(
      await until(
        async () => (await generatedText(root))?.includes('Fixed') ?? false,
      ),
    ).toBe(true);
    expect(await until(() => outputs.at(-1)?.success === true)).toBe(true);
    expect(host.open()).toBe(1);
    expect(host.starts).toHaveLength(1);

    await run.stop();
    expect(host.open()).toBe(0);
  });
});
