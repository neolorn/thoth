import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { checkProject, generateProject } from '../src/index.js';

/**
 * The build checks a URL policy is held to, when the configuration declares it.
 *
 * `specs/07-routing-rendering-and-seo.spec.md` section 3: a policy declared in `thoth.config.json`
 * claims its leading segments exactly as one built in code does, so a route that begins with one is
 * refused the same way. An application may still build a policy in code; the generated setup then
 * carries one policy and `withRouting()` another, and the build refuses the pair where they differ,
 * because the addresses it checked would not be the ones the application serves.
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

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

const ROUTER_STUB = [
  'export declare interface Route {',
  '  path?: string;',
  '  component?: unknown;',
  '}',
  'export type Routes = readonly Route[];',
  '',
].join('\n');

const THOTH_STUB = [
  'export declare function createPathPrefixLocalePolicy(options: unknown): unknown;',
  'export declare function createDefaultLocalePrefixPolicy(options: unknown): unknown;',
  'export declare function createHostLocalePolicy(options: unknown): unknown;',
  '',
].join('\n');

interface ProjectOptions {
  readonly configuration: Readonly<Record<string, unknown>>;
  readonly routePaths?: readonly string[];
  /** The policy built in code, as the lines of its call, or nothing. */
  readonly codePolicy?: readonly string[];
}

async function project(options: ProjectOptions): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'declared-policy-'));
  temporaryRoots.push(root);
  await write(
    root,
    'package.json',
    json({
      name: 'declared-policy',
      private: true,
      type: 'module',
      imports: {
        '#i18n': './src/generated/i18n/index.ts',
        '#i18n/*': './src/generated/i18n/*.ts',
      },
    }),
  );
  await write(
    root,
    'thoth.config.json',
    json({
      schemaVersion: 1,
      sourceLocale: 'en-US',
      defaultLocale: 'en-US',
      locales: ['en-US', 'ar-EG'],
      ...options.configuration,
    }),
  );
  await write(
    root,
    'tsconfig.app.json',
    json({
      compilerOptions: {
        strict: true,
        target: 'ES2022',
        module: 'preserve',
        moduleResolution: 'bundler',
        resolvePackageJsonImports: true,
        skipLibCheck: true,
      },
      include: ['src/**/*.ts'],
    }),
  );
  for (const locale of ['en-US', 'ar-EG']) {
    await write(
      root,
      `i18n/shell/${locale}.yaml`,
      'messages:\n  app-title: Declared policy probe\n',
    );
  }
  await write(root, 'node_modules/@angular/router/index.d.ts', ROUTER_STUB);
  await write(
    root,
    'node_modules/@angular/router/package.json',
    json({ name: '@angular/router', version: '0.0.0', types: './index.d.ts' }),
  );
  await write(root, 'node_modules/@neolorn/thoth/index.d.ts', THOTH_STUB);
  await write(
    root,
    'node_modules/@neolorn/thoth/package.json',
    json({ name: '@neolorn/thoth', version: '0.0.0', types: './index.d.ts' }),
  );
  await write(
    root,
    'src/app.routes.ts',
    [
      "import type { Routes } from '@angular/router';",
      '',
      'export class Page {}',
      '',
      'export const routes: Routes = [',
      ...['dashboard', ...(options.routePaths ?? [])].map(
        (path) => `  { path: ${JSON.stringify(path)}, component: Page },`,
      ),
      '];',
      '',
    ].join('\n'),
  );
  await write(
    root,
    'src/app.ts',
    [
      "import { messages } from '#i18n/shell';",
      ...(options.codePolicy === undefined
        ? []
        : [
            "import { createPathPrefixLocalePolicy, createDefaultLocalePrefixPolicy, createHostLocalePolicy } from '@neolorn/thoth';",
            '',
            'export const policies = [createPathPrefixLocalePolicy, createDefaultLocalePrefixPolicy, createHostLocalePolicy];',
            ...options.codePolicy,
          ]),
      '',
      'export const title = messages.appTitle.messageId;',
      '',
    ].join('\n'),
  );
  return root;
}

/** What both build steps report under one code, so neither can be the only one carrying it. */
async function reported(
  root: string,
  code: string,
): Promise<{
  readonly generate: readonly string[];
  readonly check: readonly string[];
}> {
  const summaries = (
    diagnostics: readonly { readonly code: string; readonly summary: string }[],
  ): readonly string[] =>
    diagnostics
      .filter((entry) => entry.code === code)
      .map(({ summary }) => summary);
  return {
    generate: summaries((await generateProject({ project: root })).diagnostics),
    check: summaries((await checkProject({ project: root })).diagnostics),
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

const PREFIXED = [
  'export const routePolicy = createPathPrefixLocalePolicy({',
  "  defaultLocale: 'en-US',",
  "  locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg' },",
  '});',
];

describe('a policy declared in the configuration', () => {
  it('claims the derived prefixes against the routes', async () => {
    const root = await project({
      configuration: { urlPolicy: 'path-prefix' },
      routePaths: ['ar-eg/tools'],
    });

    const { generate, check } = await reported(root, 'TH1409');

    expect(generate).toHaveLength(1);
    expect(generate[0]).toContain('"/ar-eg/tools"');
    expect(generate[0]).toContain('"thoth.config.json"');
    expect(check).toEqual(generate);
  });

  it('claims nothing of a route that begins elsewhere, as the control', async () => {
    const root = await project({ configuration: { urlPolicy: 'path-prefix' } });

    expect(await reported(root, 'TH1409')).toEqual({ generate: [], check: [] });
  });

  it('claims no locale prefix when it is not a path policy', async () => {
    const root = await project({
      configuration: {
        urlPolicy: 'locale-host',
        localeOrigins: {
          'en-US': 'https://example.com',
          'ar-EG': 'https://example.eg',
        },
      },
      routePaths: ['ar-eg/tools'],
    });

    expect(await reported(root, 'TH1409')).toEqual({ generate: [], check: [] });
  });
});

describe('a policy in code beside the declared one', () => {
  it('is accepted where it says the same', async () => {
    const root = await project({
      configuration: { urlPolicy: 'path-prefix' },
      codePolicy: PREFIXED,
    });

    expect(await reported(root, 'TH1408')).toEqual({ generate: [], check: [] });
  });

  it('is accepted where it says the same, its aliases and locale-neutral roots included', async () => {
    const root = await project({
      configuration: {
        urlPolicy: 'path-prefix',
        prefixAliases: { eg: 'ar-EG' },
        localeNeutralRoots: ['assets'],
      },
      codePolicy: [
        'export const routePolicy = createPathPrefixLocalePolicy({',
        "  defaultLocale: 'en-US',",
        "  locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg' },",
        "  aliases: { eg: 'ar-EG' },",
        "  localeNeutralRoots: ['assets'],",
        '});',
      ],
    });

    expect(await reported(root, 'TH1408')).toEqual({ generate: [], check: [] });
  });

  it('names every claim the two do not share, in order, at the file the policy is built in', async () => {
    const root = await project({
      configuration: {
        urlPolicy: 'path-prefix',
        localePrefixes: { 'ar-EG': 'ar' },
        prefixAliases: { eg: 'ar-EG' },
      },
      codePolicy: [
        'export const routePolicy = createPathPrefixLocalePolicy({',
        "  defaultLocale: 'en-US',",
        "  locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg' },",
        "  aliases: { zz: 'ar-EG' },",
        '});',
      ],
    });

    const generated = (await generateProject({ project: root })).diagnostics;
    const departures = generated.filter(({ code }) => code === 'TH1408');

    expect(departures).toHaveLength(1);
    expect(departures[0]?.summary).toContain(
      ': it claims locale alias "zz", locale prefix "ar-eg", which the configuration does not; the configuration claims locale alias "eg", locale prefix "ar", which it does not.',
    );
    expect(departures[0]?.path).toEqual(['routes', 'src/app.ts']);
  });

  it('is not compared where the build could not read its options, and says which', async () => {
    const root = await project({
      configuration: {
        urlPolicy: 'path-prefix',
        prefixAliases: { eg: 'ar-EG' },
      },
      codePolicy: [
        "const locales = { 'en-US': 'en', 'ar-EG': 'ar' } as const;",
        "const aliases = { zz: 'ar-EG' } as const;",
        "const localeNeutralRoots = ['api'] as const;",
        'export const routePolicy = createPathPrefixLocalePolicy({',
        "  defaultLocale: 'en-US',",
        '  locales,',
        '  aliases,',
        '  localeNeutralRoots,',
        '});',
      ],
    });

    expect(await reported(root, 'TH1408')).toEqual({ generate: [], check: [] });
    const { generate } = await reported(root, 'TH1417');
    expect(generate).toHaveLength(1);
    expect(generate[0]).toContain(
      'takes `locales`, `aliases` and `localeNeutralRoots` from something the build does not evaluate',
    );
  });

  it('compares a host policy without the prefix options, which only a path policy has', async () => {
    const root = await project({
      configuration: {
        urlPolicy: 'locale-host',
        localeOrigins: {
          'en-US': 'https://example.com',
          'ar-EG': 'https://example.eg',
        },
      },
      codePolicy: [
        'export const routePolicy = createHostLocalePolicy({',
        "  defaultLocale: 'en-US',",
        "  origins: { 'en-US': 'https://example.com', 'ar-EG': 'https://example.eg' },",
        '  omitDefaultPrefix: true,',
        '});',
      ],
    });

    expect(await reported(root, 'TH1408')).toEqual({ generate: [], check: [] });
  });

  it('is refused where only the code serves the default locale without a prefix', async () => {
    const root = await project({
      configuration: { urlPolicy: 'path-prefix' },
      codePolicy: [
        'export const routePolicy = createPathPrefixLocalePolicy({',
        "  defaultLocale: 'en-US',",
        "  locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg' },",
        '  omitDefaultPrefix: true,',
        '});',
      ],
    });

    const { generate } = await reported(root, 'TH1408');

    expect(generate).toHaveLength(1);
    expect(generate[0]).toContain(
      'it serves the default locale without a prefix and the configuration does not',
    );
  });

  it('is refused where it spells a prefix differently', async () => {
    const root = await project({
      configuration: { urlPolicy: 'path-prefix' },
      codePolicy: [
        'export const routePolicy = createPathPrefixLocalePolicy({',
        "  defaultLocale: 'en-US',",
        "  locales: { 'en-US': 'en-us', 'ar-EG': 'ar' },",
        '});',
      ],
    });

    const { generate, check } = await reported(root, 'TH1408');

    expect(generate).toHaveLength(1);
    expect(generate[0]).toContain('it claims locale prefix "ar"');
    expect(generate[0]).toContain(
      'the configuration claims locale prefix "ar-eg"',
    );
    expect(check).toEqual(generate);
  });

  it('is refused where it is another kind', async () => {
    const root = await project({
      configuration: { urlPolicy: 'path-prefix' },
      codePolicy: [
        'export const routePolicy = createHostLocalePolicy({',
        "  defaultLocale: 'en-US',",
        "  origins: { 'en-US': 'https://example.com', 'ar-EG': 'https://example.eg' },",
        '});',
      ],
    });

    const { generate } = await reported(root, 'TH1408');

    expect(generate).toHaveLength(1);
    expect(generate[0]).toContain(
      'it is a locale-host policy and the configuration declares path-prefix',
    );
  });

  it('is refused where only one serves the default locale without a prefix', async () => {
    const root = await project({
      configuration: { urlPolicy: 'path-prefix', omitDefaultPrefix: true },
      codePolicy: PREFIXED,
    });

    const { generate } = await reported(root, 'TH1408');

    expect(generate).toHaveLength(1);
    expect(generate[0]).toContain(
      'the configuration serves the default locale without a prefix and it does not',
    );
  });
});
