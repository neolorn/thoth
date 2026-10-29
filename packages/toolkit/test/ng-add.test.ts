import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { firstValueFrom, type Observable } from 'rxjs';
import { describe, expect, it } from 'vitest';

import type { Rule, Tree } from '../src/angular-schematics.js';
import ngAdd from '../src/ng-add.js';
import { NG_ADD_RECOVERY, ngAddSchema } from '../src/ng-add-schema.js';

/**
 * `ng add @neolorn/thoth-toolkit` over the workspace `ng new` makes.
 *
 * The workspace is written by `@schematics/angular`'s own `workspace` and `application` schematics,
 * the two `ng new` runs, through the schematics testing API the Angular CLI documents for testing a
 * schematic. The schematic is then run on that tree, which is what `ng add` hands it once the
 * Angular CLI has read the answers.
 */

const load = createRequire(import.meta.url);

/** The members of `@angular-devkit/schematics/testing` this file uses, typed for the reason `angular-schematics.ts` gives. */
interface UnitTestTree extends Tree {
  readonly files: readonly string[];
  readContent(path: string): string;
}
interface TestRunner {
  readonly tasks: readonly { readonly name: string }[];
  runExternalSchematic(
    collection: string,
    schematic: string,
    options: Record<string, unknown>,
    tree?: Tree,
  ): Promise<UnitTestTree>;
  callRule(rule: Rule, tree: Tree): Observable<Tree>;
}
const { SchematicTestRunner } = load('@angular-devkit/schematics/testing') as {
  SchematicTestRunner: new (name: string, path: string) => TestRunner;
};

/** What the four questions are answered with, and the two recovery keys the schema supplies. */
const ANSWERS = Object.freeze({
  sourceLocale: 'en-US',
  defaultLocale: 'en-US',
  locale: ['en-US', 'ar-EG'],
  urlPolicy: 'path-prefix',
  recoveryMessage: 'shell/recovery-message',
  recoveryRetry: 'shell/recovery-retry',
});
const ORIGIN = 'https://example.com';

function runner(): TestRunner {
  return new SchematicTestRunner(
    '@schematics/angular',
    join(
      dirname(load.resolve('@schematics/angular/package.json')),
      'collection.json',
    ),
  );
}

/** What `ng new my-app` writes, with server rendering when asked for. */
async function application(
  run: TestRunner,
  ssr = false,
): Promise<UnitTestTree> {
  const workspace = await run.runExternalSchematic(
    '@schematics/angular',
    'workspace',
    { name: 'my-app', newProjectRoot: 'projects', version: '22.2.1' },
  );
  return run.runExternalSchematic(
    '@schematics/angular',
    'application',
    {
      name: 'my-app',
      projectRoot: '',
      routing: true,
      style: 'css',
      standalone: true,
      ssr,
    },
    workspace,
  );
}

async function add(
  run: TestRunner,
  tree: Tree,
  options: Record<string, unknown> = ANSWERS,
): Promise<UnitTestTree> {
  return (await firstValueFrom(
    run.callRule(ngAdd(options), tree),
  )) as UnitTestTree;
}

/** Every file of a tree and its text, so a run that changes nothing can be told from one that does. */
function snapshot(tree: UnitTestTree): Map<string, string> {
  return new Map(tree.files.map((path) => [path, tree.readContent(path)]));
}

/** Lines, whatever the line endings the CLI's templates were written with on this machine. */
function text(tree: UnitTestTree, path: string): string {
  return tree.readContent(path).replaceAll('\r\n', '\n');
}

function json(tree: UnitTestTree, path: string): Record<string, unknown> {
  return JSON.parse(tree.readContent(path)) as Record<string, unknown>;
}

function targets(tree: UnitTestTree): Record<string, unknown> {
  const workspace = json(tree, '/angular.json') as {
    projects: Record<string, { architect: Record<string, unknown> }>;
  };
  return workspace.projects['my-app']?.architect ?? {};
}

const toolkitVersion = (
  JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { version: string }
).version;

describe('ng add', () => {
  it('writes the configuration from the answers and adds the runtime, writing no catalog and no message', async () => {
    const run = runner();
    const tree = await application(run);
    const before = snapshot(tree);
    const installs = run.tasks.length;
    const after = await add(run, tree);

    expect(json(after, '/thoth.config.json')).toEqual({
      schemaVersion: 1,
      sourceLocale: 'en-US',
      defaultLocale: 'en-US',
      locales: ['en-US', 'ar-EG'],
      urlPolicy: 'path-prefix',
      recoveryMessage: 'shell/recovery-message',
      recoveryRetry: 'shell/recovery-retry',
    });
    const manifest = json(after, '/package.json') as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
      imports: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(manifest.dependencies['@neolorn/thoth']).toBe(`^${toolkitVersion}`);
    // The toolkit is the Angular CLI's to add, as the package `ng add` was given.
    expect(manifest.devDependencies['@neolorn/thoth-toolkit']).toBeUndefined();
    expect(manifest.imports).toEqual({
      '#i18n': './src/generated/i18n/index.ts',
      '#i18n/*': './src/generated/i18n/*.ts',
    });
    expect(manifest.scripts['thoth:generate']).toBe('thoth generate');
    // One install, for the runtime it added.
    expect(run.tasks.slice(installs).map(({ name }) => name)).toEqual([
      'node-package',
    ]);

    // The one file created is the configuration. Nothing under i18n/, and no text of any kind.
    const created = after.files.filter((path) => !before.has(path));
    expect(created).toEqual(['/thoth.config.json']);
    expect(after.files.filter((path) => path.startsWith('/i18n/'))).toEqual([]);
    expect(after.files.filter((path) => path.endsWith('.yaml'))).toEqual([]);
    expect(before.size).toBe(after.files.length - 1);
  });

  it('keeps the generated root and the cache out of version control', async () => {
    const run = runner();
    const tree = await application(run);
    const before = text(tree, '/.gitignore');
    const after = await add(run, tree);

    expect(text(after, '/.gitignore')).toBe(
      `${before}src/generated/i18n/\n.thoth/\n`,
    );
  });

  it('runs build, serve and test through the builders, each naming the Angular target it was, with every configuration carried', async () => {
    const run = runner();
    const tree = await application(run);
    const before = targets(tree) as Record<string, Record<string, unknown>>;
    const after = targets(await add(run, tree));

    expect(after['build']).toEqual({
      builder: '@neolorn/thoth-toolkit:build',
      options: { buildTarget: 'my-app:angular-build' },
      configurations: {
        production: { buildTarget: 'my-app:angular-build:production' },
        development: { buildTarget: 'my-app:angular-build:development' },
      },
      defaultConfiguration: 'production',
    });
    expect(after['serve']).toEqual({
      builder: '@neolorn/thoth-toolkit:serve',
      options: { serveTarget: 'my-app:angular-serve' },
      configurations: {
        production: { serveTarget: 'my-app:angular-serve:production' },
        development: { serveTarget: 'my-app:angular-serve:development' },
      },
      defaultConfiguration: 'development',
    });
    expect(after['test']).toEqual({
      builder: '@neolorn/thoth-toolkit:test',
      options: { testTarget: 'my-app:angular-test' },
    });
    // The Angular targets keep their builders and options, and read the Angular build target
    // wherever they read the build target before, including through the defaults they were given.
    expect(after['angular-build']).toEqual(before['build']);
    expect(after['angular-serve']).toEqual({
      builder: '@angular/build:dev-server',
      options: { buildTarget: 'my-app:angular-build:development' },
      configurations: {
        production: { buildTarget: 'my-app:angular-build:production' },
        development: { buildTarget: 'my-app:angular-build:development' },
      },
      defaultConfiguration: 'development',
    });
    expect(after['angular-test']).toEqual({
      builder: '@angular/build:unit-test',
      options: { buildTarget: 'my-app:angular-build:development' },
    });
  });

  it('replaces provideRouter with provideLocalizedRouter and adds provideLocalization(withRouting())', async () => {
    const run = runner();
    const after = await add(run, await application(run));
    const config = text(after, '/src/app/app.config.ts');

    expect(config).toContain('provideLocalizedRouter(routes)');
    expect(config).toContain(
      "import { provideLocalizedRouter } from '@neolorn/thoth/router';",
    );
    expect(config).not.toContain('provideRouter');
    expect(config).not.toContain("from '@angular/router'");
    expect(config).toContain('provideLocalization(withRouting())');
    expect(config).toContain("import { provideLocalization } from '#i18n';");
    expect(config).toContain("import { withRouting } from '@neolorn/thoth';");
    expect(config).toContain('provideBrowserGlobalErrorListeners()');
  });

  it('installs the localized server rendering in place of the CLI one, with the origin the router needs on the server', async () => {
    const run = runner();
    const after = await add(run, await application(run, true), {
      ...ANSWERS,
      origin: ORIGIN,
    });

    expect(text(after, '/src/app/app.config.server.ts')).toBe(
      [
        "import { mergeApplicationConfig, ApplicationConfig } from '@angular/core';",
        "import { RenderMode } from '@angular/ssr';",
        "import { provideLocalizedServerRendering } from '@neolorn/thoth/ssr';",
        "import { localizationSetup } from '#i18n';",
        "import { appConfig } from './app.config';",
        '',
        'const serverConfig: ApplicationConfig = {',
        '  providers: [',
        '    provideLocalizedServerRendering(localizationSetup, [], {',
        '      canonicalRenderMode: RenderMode.Server,',
        '      fallback: RenderMode.Server,',
        '    })',
        '  ]',
        '};',
        '',
        'export const config = mergeApplicationConfig(appConfig, serverConfig);',
        '',
      ].join('\n'),
    );
    expect(after.exists('/src/app/app.routes.server.ts')).toBe(false);
    const config = text(after, '/src/app/app.config.ts');
    expect(config).toContain(
      "provideLocalizedRouter(routes, { origin: 'https://example.com' })",
    );
    expect(config).toContain('provideClientHydration()');
  });

  it('refuses an application that renders on the server when no origin is given', async () => {
    const run = runner();
    const tree = await application(run, true);
    const before = snapshot(tree);
    await expect(add(run, tree)).rejects.toThrow(/--origin/u);
    expect(snapshot(tree)).toEqual(before);
  });

  it.each([false, true])(
    'changes nothing when run a second time (server rendering: %s)',
    async (ssr) => {
      const run = runner();
      const options = { ...ANSWERS, origin: ORIGIN };
      const once = await add(run, await application(run, ssr), options);
      const first = snapshot(once);
      const twice = await add(run, once, options);
      expect(snapshot(twice)).toEqual(first);
    },
  );

  // With nothing typed, the Angular CLI still hands the schematic the schema's defaults, which are
  // the two recovery keys and nothing else.
  it('changes nothing when run again with no options', async () => {
    const run = runner();
    const once = await add(run, await application(run), ANSWERS);
    const first = snapshot(once);
    const twice = await add(run, once, { ...NG_ADD_RECOVERY });
    expect(snapshot(twice)).toEqual(first);
  });

  it('refuses a recovery key that differs from the configuration, and writes nothing', async () => {
    const run = runner();
    const once = await add(run, await application(run), ANSWERS);
    const first = snapshot(once);
    await expect(
      add(run, once, { ...NG_ADD_RECOVERY, recoveryRetry: 'shell/again' }),
    ).rejects.toThrow(
      /TH1705: Thoth init arguments conflict with the existing thoth\.config\.json/u,
    );
    expect(snapshot(once)).toEqual(first);
  });

  it('reads the locales the terminal question is answered with, separated by spaces or commas', async () => {
    const run = runner();
    const after = await add(run, await application(run), {
      ...ANSWERS,
      locale: 'en-US, ar-EG',
    });
    expect(json(after, '/thoth.config.json')['locales']).toEqual([
      'en-US',
      'ar-EG',
    ]);
  });

  it('names every answer it is missing, and writes nothing', async () => {
    const run = runner();
    const tree = await application(run);
    const before = snapshot(tree);
    await expect(
      add(run, tree, { sourceLocale: 'en-US', locale: 'en-US' }),
    ).rejects.toThrow(
      'ng add @neolorn/thoth-toolkit needs --default-locale <locale>, --url-policy path-prefix|locale-host|locale-neutral.',
    );
    expect(snapshot(tree)).toEqual(before);
  });

  it.each([
    [
      'a configuration that says something else',
      (tree: UnitTestTree) =>
        tree.create(
          '/thoth.config.json',
          `${JSON.stringify({ schemaVersion: 1, sourceLocale: 'en-US', defaultLocale: 'en-US', locales: ['en-US'], urlPolicy: 'path-prefix' }, null, 2)}\n`,
        ),
      /TH1705: Thoth init arguments conflict with the existing thoth\.config\.json/u,
    ],
    [
      'a package script of the same name that means something else',
      (tree: UnitTestTree) => {
        const manifest = json(tree, '/package.json') as {
          scripts: Record<string, string>;
        };
        manifest.scripts['thoth:generate'] = 'node generate.js';
        tree.overwrite('/package.json', JSON.stringify(manifest, null, 2));
      },
      /TH1705: Thoth init refuses conflicting package script "thoth:generate"/u,
    ],
    [
      'a target already named angular-build',
      (tree: UnitTestTree) => {
        const workspace = json(tree, '/angular.json') as {
          projects: Record<string, { architect: Record<string, unknown> }>;
        };
        const architect = workspace.projects['my-app']?.architect ?? {};
        architect['angular-build'] = architect['build'];
        tree.overwrite('/angular.json', JSON.stringify(workspace, null, 2));
      },
      /already has a target named angular-build/u,
    ],
    [
      'server routes of its own',
      (tree: UnitTestTree) =>
        tree.overwrite(
          '/src/app/app.routes.server.ts',
          [
            "import { RenderMode, ServerRoute } from '@angular/ssr';",
            '',
            'export const serverRoutes: ServerRoute[] = [',
            "  { path: 'account', renderMode: RenderMode.Server },",
            "  { path: '**', renderMode: RenderMode.Prerender },",
            '];',
            '',
          ].join('\n'),
        ),
      /declares server routes of its own/u,
    ],
  ])('refuses %s, and writes nothing', async (_, conflict, refusal) => {
    const run = runner();
    const tree = await application(run, true);
    conflict(tree);
    const before = snapshot(tree);
    await expect(
      add(run, tree, { ...ANSWERS, origin: ORIGIN }),
    ).rejects.toThrow(refusal);
    expect(snapshot(tree)).toEqual(before);
  });

  it('asks the four questions, and supplies the two recovery keys without asking', () => {
    const properties = ngAddSchema()['properties'] as Record<
      string,
      Record<string, unknown>
    >;
    const asked = Object.entries(properties)
      .filter(([, property]) => property['x-prompt'] !== undefined)
      .map(([name]) => name);
    expect(asked).toEqual([
      'sourceLocale',
      'defaultLocale',
      'locale',
      'urlPolicy',
    ]);
    expect(properties['recoveryMessage']?.['default']).toBe(
      'shell/recovery-message',
    );
    expect(properties['recoveryRetry']?.['default']).toBe(
      'shell/recovery-retry',
    );
  });
});
