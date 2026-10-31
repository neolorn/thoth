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

import { WRAPPED_BUILDER_OPTIONS } from '../src/angular-builder-options.generated.js';
import { runAngularCommand } from '../src/angular-builders.js';
import {
  angularCliRegistry,
  angularTargetScheduler,
} from '../src/angular-target-architect.js';
import {
  ANGULAR_TARGET_OPTION,
  angularBuilderSchema,
  givenAngularOptions,
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

/** A temporary directory removed after the test. */
async function directory(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'angular-builders-'));
  roots.push(root);
  return root;
}

/** The pseudo-locale a project declares when it is asked to, and how it is told apart in output. */
const PSEUDO_LOCALE = 'en-Latn-XA';

/**
 * A Thoth project with one catalog, at `root` or in a directory of its own, declaring a pseudo-locale
 * when `pseudo` says so.
 */
async function project(root?: string, pseudo = false): Promise<string> {
  root ??= await directory();
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
      ...(pseudo
        ? { pseudoLocales: { [PSEUDO_LOCALE]: { lengthFactor: 0.3 } } }
        : {}),
    },
  });
  expect(initialized.ok, JSON.stringify(initialized.diagnostics)).toBe(true);
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
  constructor(
    root: string,
    private readonly projectRoot: string,
  ) {
    super(root, root);
  }

  override getProjectMetadata() {
    return Promise.resolve({ root: this.projectRoot });
  }
}

interface Workspace {
  readonly architect: Architect;
  /** The Architect `ng run` would run a target through. */
  readonly alone: (target: Target) => Promise<Architect>;
  readonly logs: string[];
  readonly starts: TargetStart[];
  /** How many long-running Angular sessions are open now. */
  readonly open: () => number;
}

/**
 * What `angular.json` sets on the Thoth build target and on the Angular build target it runs, and
 * on the Thoth serve and test targets.
 */
type Json = boolean | number | string | null | Json[] | { [key: string]: Json };

interface BuildOptions {
  readonly thoth?: Readonly<Record<string, Json>>;
  readonly angular?: Readonly<Record<string, Json>>;
  readonly angularServe?: Readonly<Record<string, Json>>;
  readonly angularTest?: Readonly<Record<string, Json>>;
  readonly serve?: Readonly<Record<string, Json>>;
  readonly test?: Readonly<Record<string, Json>>;
}

/** The workspace at `workspaceRoot`, whose one project `app` has its root at `projectRoot` within it. */
function workspace(
  workspaceRoot: string,
  projectRoot = '',
  options: BuildOptions = {},
): Workspace {
  const host = new WorkspaceHost(workspaceRoot, projectRoot);
  const root = resolve(workspaceRoot, projectRoot);
  const starts: TargetStart[] = [];
  let open = 0;
  // Each Thoth builder runs its Angular target as it does under the Angular CLI, through an Architect
  // made for that target, over this in-memory workspace rather than one on disk.
  const scheduleTarget = angularTargetScheduler(() => Promise.resolve(host));
  for (const command of ['build', 'serve', 'test'] as const) {
    host.addBuilder(
      `@neolorn/thoth-toolkit:${command}`,
      createBuilder((options, context) =>
        runAngularCommand(command, options, context, scheduleTarget),
      ),
      `Thoth ${command}`,
      optionSchema(command),
    );
  }
  const once = createBuilder(async (options) => {
    starts.push({ generated: await generatedText(root), options });
    return { success: true };
  });
  host.addBuilder('@example/angular:once', once);
  // Named as Angular's application builder is, which the Angular CLI validates without filling in
  // its arrays, with an array and an object that have no default, as `conditions` and `define` have
  // none in Angular's schema.
  host.addBuilder(
    '@angular/build:application',
    once,
    'A stand-in for the application builder',
    {
      type: 'object',
      properties: {
        conditions: { type: 'array', items: { type: 'string' } },
        define: { type: 'object', additionalProperties: { type: 'string' } },
      },
    },
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
    { buildTarget: 'app:angular-build', ...options.thoth },
  );
  host.addTarget(
    { project: 'app', target: 'angular-build' },
    '@example/angular:once',
    { ...options.angular },
  );
  host.addTarget(
    { project: 'app', target: 'serve' },
    '@neolorn/thoth-toolkit:serve',
    { serveTarget: ':angular-serve', ...options.serve },
  );
  host.addTarget(
    { project: 'app', target: 'angular-serve' },
    '@example/angular:session',
    { ...options.angularServe },
  );
  host.addTarget(
    { project: 'app', target: 'test' },
    '@neolorn/thoth-toolkit:test',
    { testTarget: 'app:angular-test', ...options.test },
  );
  host.addTarget(
    { project: 'app', target: 'angular-test' },
    '@example/angular:once',
    { ...options.angularTest },
  );
  host.addTarget(
    { project: 'app', target: 'angular-application' },
    '@angular/build:application',
  );
  const logs: string[] = [];
  return {
    // As the Angular CLI makes it for a target whose builder is a Thoth builder.
    architect: new Architect(
      host,
      angularCliRegistry('@neolorn/thoth-toolkit:build', () => undefined),
    ),
    // As `ng run` makes it for a target, from the target's builder.
    alone: async (target) =>
      new Architect(
        host,
        angularCliRegistry(
          (await host.getBuilderNameForTarget(target)) ?? '',
          () => undefined,
        ),
      ),
    logs,
    starts,
    open: () => open,
  };
}

async function schedule(
  { architect, logs }: Workspace,
  target: Target,
  overrides: Readonly<Record<string, Json>> = {},
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
  it('generate the project at the Angular project root, in a workspace whose applications each have one', async () => {
    const workspaceRoot = await directory();
    const applicationRoot = await project(
      resolve(workspaceRoot, 'projects', 'shop'),
    );
    const host = workspace(workspaceRoot, 'projects/shop');

    const { run } = await schedule(host, { project: 'app', target: 'build' });
    const result = await run.result;

    expect(result.success, host.logs.join('\n')).toBe(true);
    expect(host.starts[0]?.generated).toContain('app-title');
    expect(await generatedText(applicationRoot)).toContain('app-title');
    expect(await generatedText(workspaceRoot)).toBeUndefined();
  });

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

describe('the Angular builders generate the pseudo-locales a project declares only when asked', () => {
  it.each(['build', 'serve', 'test'] as const)(
    '%s takes pseudoLocales, an option of its own',
    (command) => {
      const properties = angularBuilderSchema(command)[
        'properties'
      ] as Readonly<Record<string, unknown>>;
      expect(properties['pseudoLocales']).toEqual({
        type: 'boolean',
        description: expect.stringContaining('pseudo-locales') as string,
      });
    },
  );

  it('generate them under ng serve when the serve target asks, in every generation of the session', async () => {
    const root = await project(undefined, true);
    const host = workspace(root, '', { serve: { pseudoLocales: true } });

    const { run } = await schedule(host, { project: 'app', target: 'serve' });
    expect(await until(() => host.starts.length === 1)).toBe(true);
    expect(host.starts[0]?.generated ?? '').toContain(PSEUDO_LOCALE);
    expect(host.starts[0]?.options['pseudoLocales']).toBeUndefined();

    // The second generation is the watch's own, which is reported once it is written.
    await write(root, CATALOG, catalog('Edited'));
    expect(
      await until(
        () =>
          host.logs.filter((line) => line.includes('Thoth generated')).length >=
          2,
      ),
    ).toBe(true);
    const regenerated = await generatedText(root);
    expect(regenerated).toContain('Edited');
    expect(regenerated).toContain(PSEUDO_LOCALE);
    await run.stop();
  });

  it('generate them under ng test when the test target asks', async () => {
    const root = await project(undefined, true);
    const host = workspace(root, '', { test: { pseudoLocales: true } });

    const { run } = await schedule(
      host,
      { project: 'app', target: 'test' },
      { watch: false },
    );
    expect((await run.result).success).toBe(true);
    expect(host.starts[0]?.generated ?? '').toContain(PSEUDO_LOCALE);
  });

  it('leave them out of a build that does not ask, after one that did', async () => {
    const root = await project(undefined, true);
    const host = workspace(root);

    const asked = await schedule(
      host,
      { project: 'app', target: 'build' },
      { pseudoLocales: true },
    );
    expect((await asked.run.result).success).toBe(true);
    expect(host.starts[0]?.generated ?? '').toContain(PSEUDO_LOCALE);

    const production = await schedule(host, {
      project: 'app',
      target: 'build',
    });
    expect((await production.run.result).success).toBe(true);
    expect(host.starts[1]?.generated ?? '').toContain('Started');
    expect(host.starts[1]?.generated ?? '').not.toContain(PSEUDO_LOCALE);
    expect(await generatedText(root)).not.toContain(PSEUDO_LOCALE);
  });
});

describe('the Angular builders take the options of the Angular builder they run', () => {
  it.each(['build', 'serve', 'test'] as const)(
    '%s declares every option of its Angular builder, with no default and nothing required but its target',
    (command) => {
      const schema = angularBuilderSchema(command);
      const properties = schema['properties'] as Readonly<
        Record<string, unknown>
      >;
      const wrapped = Object.keys(WRAPPED_BUILDER_OPTIONS[command].properties);

      expect(wrapped.length).toBeGreaterThan(10);
      expect(wrapped.filter((name) => !(name in properties))).toEqual([]);
      expect(JSON.stringify(schema)).not.toMatch(/"default":/u);
      expect(schema['required']).toEqual([ANGULAR_TARGET_OPTION[command]]);
      expect(schema['additionalProperties']).toBe(false);
    },
  );

  it('pass ng serve --port on to the Angular serve target', async () => {
    const root = await project();
    const host = workspace(root);

    await schedule(host, { project: 'app', target: 'serve' }, { port: 4300 });

    expect(await until(() => host.starts.length === 1)).toBe(true);
    expect(host.starts[0]?.options['port']).toBe(4300);
  });

  it('leave what angular.json sets on the Angular build target as it is under a plain ng build, its lists and objects included', async () => {
    const root = await project();
    const angular = {
      optimization: false,
      outputHashing: 'all',
      tsConfig: 'tsconfig.app.json',
      styles: ['src/styles.css'],
      assets: [{ glob: 'arrival.txt', input: 'public' }],
      budgets: [{ type: 'initial', maximumWarning: '1kB' }],
      define: { BUILT: 'true' },
    };
    const host = workspace(root, '', { angular });

    const { run } = await schedule(host, { project: 'app', target: 'build' });
    const result = await run.result;

    expect(result.success, host.logs.join('\n')).toBe(true);
    expect(host.starts[0]?.options).toEqual(angular);
  });

  it('pass an option ng build is given over the one the Angular target sets, and no other', async () => {
    const root = await project();
    const host = workspace(root, '', {
      angular: { optimization: false, outputHashing: 'all' },
    });

    const { run } = await schedule(
      host,
      { project: 'app', target: 'build' },
      { outputHashing: 'none' },
    );
    const result = await run.result;

    expect(result.success, host.logs.join('\n')).toBe(true);
    expect(host.starts[0]?.options).toEqual({
      optimization: false,
      outputHashing: 'none',
    });
  });

  it('pass a list ng build is given over the one the Angular target sets, and keep the other lists the target sets', async () => {
    const root = await project();
    const host = workspace(root, '', {
      angular: {
        styles: ['src/styles.css'],
        budgets: [{ type: 'initial', maximumWarning: '1kB' }],
      },
    });

    const { run } = await schedule(
      host,
      { project: 'app', target: 'build' },
      { styles: ['src/other.css'] },
    );
    const result = await run.result;

    expect(result.success, host.logs.join('\n')).toBe(true);
    expect(host.starts[0]?.options).toEqual({
      styles: ['src/other.css'],
      budgets: [{ type: 'initial', maximumWarning: '1kB' }],
    });
  });

  it('leave what angular.json sets on the Angular serve and test targets as it is under a plain ng serve and ng test', async () => {
    const root = await project();
    const angularServe = { headers: { 'X-Arrival': 'angular-serve' } };
    const angularTest = {
      setupFiles: ['src/setup.ts'],
      include: ['src/**/*.spec.ts'],
      reporters: ['dot'],
    };
    const host = workspace(root, '', { angularServe, angularTest });

    const tested = await schedule(
      host,
      { project: 'app', target: 'test' },
      { watch: false },
    );
    const result = await tested.run.result;
    await schedule(host, { project: 'app', target: 'serve' });

    expect(result.success, host.logs.join('\n')).toBe(true);
    expect(await until(() => host.starts.length === 2)).toBe(true);
    expect(host.starts[0]?.options).toEqual({ ...angularTest, watch: false });
    expect(host.starts[1]?.options).toEqual(angularServe);
  });

  it('end a builder started by its name rather than from a target, which cannot tell the options it was given', async () => {
    const root = await project();
    const host = workspace(root);

    const run = await host.architect.scheduleBuilder(
      '@neolorn/thoth-toolkit:build',
      { buildTarget: 'app:angular-build' },
    );
    runs.push(run);
    const result = await run.result;

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      "Thoth's build builder runs from a target in angular.json, and it was started without one, so it cannot tell the options it was given from those the Angular CLI filled in.",
    );
    expect(host.starts).toHaveLength(0);
  });

  it('run the Angular target as ng run runs it on its own, with no array filled in that the Angular CLI leaves out for its builder', async () => {
    const root = await project();
    const host = workspace(root);
    const target = { project: 'app', target: 'angular-application' };

    const alone = await (await host.alone(target)).scheduleTarget(target);
    runs.push(alone);
    expect((await alone.result).success).toBe(true);
    const { run } = await schedule(
      host,
      { project: 'app', target: 'build' },
      { buildTarget: 'app:angular-application' },
    );
    const result = await run.result;

    expect(result.success, host.logs.join('\n')).toBe(true);
    expect(host.starts).toHaveLength(2);
    // The object is filled in and the array is not, under `ng run` and under Thoth's builder alike.
    expect(host.starts[0]?.options).toEqual({ define: {} });
    expect(host.starts[0]?.options['conditions']).toBeUndefined();
    expect(host.starts[1]?.options).toStrictEqual(host.starts[0]?.options);
  });

  it.each([
    ['@angular/build:application', { define: {} }],
    ['@example/angular:once', { conditions: [], define: {} }],
  ])(
    'validate the options of %s as the Angular CLI does, filling in what it fills in',
    async (builderName, filled) => {
      const registry = angularCliRegistry(builderName, () => undefined);
      const validate = await registry.compile({
        type: 'object',
        properties: {
          conditions: { type: 'array', items: { type: 'string' } },
          define: { type: 'object' },
        },
      });

      const { success, data } = await validate({});

      expect(success).toBe(true);
      expect(JSON.parse(JSON.stringify(data))).toStrictEqual(filled);
    },
  );

  it('leave out of what it passes on each option the Angular CLI filled in, and keep every one the command gave', () => {
    const fills = {
      buildTarget: 'app:angular-build',
      styles: [],
      assets: [],
      define: {},
      security: { autoCsp: undefined },
    };

    expect(
      givenAngularOptions(
        {
          styles: [],
          assets: ['src/favicon.ico'],
          define: {},
          security: {},
          optimization: false,
          outputHashing: 'none',
        },
        fills,
      ),
    ).toStrictEqual({
      assets: ['src/favicon.ico'],
      optimization: false,
      outputHashing: 'none',
    });
  });

  it('refuse an Angular option set on the Thoth target in angular.json, and name the target it belongs on', async () => {
    const root = await project();
    const host = workspace(root, '', { thoth: { optimization: true } });

    const { run } = await schedule(host, { project: 'app', target: 'build' });
    const result = await run.result;

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      'optimization is an option of app:angular-build. Set it on that target in angular.json, or give it on the command line.',
    );
    expect(host.starts).toHaveLength(0);
  });
});
