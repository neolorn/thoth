import { resolve } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { compileProject, parseCatalog, type Catalog } from '../src/index.js';
import { testProjectConfiguration } from './fixtures.js';

/**
 * A message handle whose identity the catalog graph does not hold.
 *
 * The analysis reads a usage's identity from the handle's type, so a type kept from an earlier
 * build, or one declared by hand, names an identity that no catalog defines. The build is told,
 * and the usage is not recorded. That holds when the graph has no message at all, which is the
 * state right after setup: an empty list of known identities is still a list.
 */

const projectRoot = resolve('fixtures/semantic-analysis/analysis-overlay');
const appPath = resolve(projectRoot, 'src/app.ts');

const STALE = '@example/app:shell:stale';

// A handle type as the generated modules declare one, written into the application by hand.
const declaresAHandle = [
  'interface StaleHandle {',
  "  readonly generatedAbi: 'thoth-generated/1';",
  "  readonly resultKind: 'plain';",
  `  readonly identity: '${STALE}';`,
  '}',
  'declare const stale: StaleHandle;',
  'export const title = stale;',
  '',
].join('\n');

function sourceCatalog(): Catalog {
  const parsed = parseCatalog(
    ['messages:', '  app-title: Probe', ''].join('\n'),
    {
      role: 'source',
      providerId: '@example/app',
      scopeId: 'shell',
      locale: 'en-US',
      sourcePath: 'i18n/shell/en-US.yaml',
    },
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return parsed.value;
}

function compileWith(
  catalogs: readonly Catalog[],
): ReturnType<typeof compileProject> {
  return compileProject({
    owner: {
      providerId: '@example/app',
      generatedRootPath: 'src/generated/i18n',
    },
    configuration: testProjectConfiguration(['en-US']),
    catalogs,
    analysis: {
      projectRoot,
      rootNames: [appPath],
      sources: [{ path: appPath, contents: declaresAHandle }],
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.Preserve,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        strict: true,
        skipLibCheck: true,
      },
    },
  });
}

const unknownIdentityFindings = (
  compiled: ReturnType<typeof compileProject>,
): readonly { readonly code: string; readonly path: unknown }[] =>
  compiled.diagnostics
    .filter(({ code }) => code === 'TH1403')
    .map(({ code, path }) => ({ code, path }));

describe('a handle naming an identity the catalog graph does not hold', () => {
  it('is reported when the graph has messages', () => {
    // The control: one message in the graph, and the hand-declared handle is refused.
    const compiled = compileWith([sourceCatalog()]);

    expect(unknownIdentityFindings(compiled)).not.toEqual([]);
    expect(
      unknownIdentityFindings(compiled).every(
        ({ path }) =>
          JSON.stringify(path) === JSON.stringify(['message', STALE]),
      ),
    ).toBe(true);
  });

  it('is reported when the graph has no message at all', () => {
    const compiled = compileWith([]);

    expect(unknownIdentityFindings(compiled)).toEqual(
      unknownIdentityFindings(compileWith([sourceCatalog()])),
    );
    expect(unknownIdentityFindings(compiled)).not.toEqual([]);
  });
});
