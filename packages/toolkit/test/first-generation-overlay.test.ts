import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { generateProject } from '../src/index.js';

import { claimCapability } from '../../../tools/capability-claims-in-tests.mjs';

/**
 * A first generation analyses the application before any generated module exists, through an
 * overlay that stands in for them. An import the overlay does not resolve is reported against the
 * application's own source, although the module it names is one the same generation writes.
 *
 * The overlay is a list kept by hand beside the list of files a generation writes, so the test
 * reads the second from a real generation and holds the first to it.
 */

const temporaryRoots: string[] = [];

async function write(
  root: string,
  path: string,
  contents: string,
): Promise<void> {
  const absolute = resolve(root, ...path.split('/'));
  await mkdir(resolve(absolute, '..'), { recursive: true });
  await writeFile(absolute, contents, 'utf8');
}

async function application(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'first-generation-'));
  temporaryRoots.push(root);
  await write(
    root,
    'package.json',
    `${JSON.stringify(
      {
        name: '@example/first-generation',
        version: '0.0.0',
        private: true,
        type: 'module',
        imports: {
          '#i18n': './src/generated/i18n/index.ts',
          '#i18n/*': './src/generated/i18n/*.ts',
        },
      },
      null,
      2,
    )}\n`,
  );
  await write(
    root,
    'equator.config.json',
    `${JSON.stringify(
      {
        schemaVersion: 1,
        sourceLocale: 'en-US',
        defaultLocale: 'en-US',
        locales: ['en-US', 'ar-EG'],
      },
      null,
      2,
    )}\n`,
  );
  await write(
    root,
    'i18n/shell/en-US.yaml',
    'messages:\n  app-title: Equator\n',
  );
  await write(
    root,
    'i18n/shell/ar-EG.yaml',
    'messages:\n  app-title: Equator\n',
  );
  await write(
    root,
    'tsconfig.app.json',
    `${JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          target: 'ES2022',
          module: 'preserve',
          moduleResolution: 'bundler',
          resolvePackageJsonImports: true,
        },
        include: ['src/**/*.ts'],
      },
      null,
      2,
    )}\n`,
  );
  // The types the overlay's modules name, which an application has installed with the runtime. A
  // name the overlay starts to import from it fails this test until it is declared here too.
  await write(
    root,
    'node_modules/@neolorn/equator/index.d.ts',
    [
      'export interface CatalogLoaders {}',
      'export interface CatalogSetDescriptor {}',
      'export interface GeneratedRouteProjection {}',
      'export interface PersonNameProfileSet {}',
      'export interface RecoveryRepresentation {}',
      '',
    ].join('\n'),
  );
  await write(
    root,
    'node_modules/@neolorn/equator/package.json',
    `${JSON.stringify(
      { name: '@neolorn/equator', version: '0.0.0', types: './index.d.ts' },
      null,
      2,
    )}\n`,
  );
  await write(
    root,
    'src/app.ts',
    [
      "import { messages } from '#i18n/shell';",
      '',
      'export const title = messages.appTitle.messageId;',
      '',
    ].join('\n'),
  );
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('the overlay a first generation analyses through', () => {
  it('resolves every module the generation writes', async () => {
    const root = await application();
    const generatedRoot = resolve(root, 'src/generated/i18n');

    const first = await generateProject({ project: root });
    expect(first.ok).toBe(true);
    const modules = (await readdir(generatedRoot, { withFileTypes: true }))
      .filter(
        (entry) =>
          entry.isFile() &&
          entry.name.endsWith('.ts') &&
          !entry.name.endsWith('.d.ts'),
      )
      .map(({ name }) =>
        name === 'index.ts' ? '#i18n' : `#i18n/${name.slice(0, -3)}`,
      );
    // The ones an application imports to compose its runtime by hand, which the list has to hold
    // for the comparison below to mean anything.
    expect(modules).toEqual(
      expect.arrayContaining([
        '#i18n',
        '#i18n/catalog-loaders',
        '#i18n/catalog-set',
        '#i18n/person-names',
        '#i18n/recovery-payload',
      ]),
    );

    await rm(generatedRoot, { recursive: true, force: true });
    await write(
      root,
      'src/every-module.ts',
      `${modules
        .map(
          (specifier, index) =>
            `export * as module${index} from '${specifier}';`,
        )
        .join('\n')}\n`,
    );
    const clean = await generateProject({ project: root });

    expect(
      clean.diagnostics
        .filter(
          ({ severity, summary }) =>
            severity === 'error' || summary.includes('#i18n'),
        )
        .map(({ summary }) => summary),
    ).toEqual([]);
    expect(clean.ok).toBe(true);
    claimCapability('cli:generate');
  });
});
