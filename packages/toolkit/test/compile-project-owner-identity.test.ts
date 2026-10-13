import { describe, expect, it } from 'vitest';

import { compileProject, parseCatalog, type Catalog } from '../src/index.js';
import { testProjectConfiguration } from './fixtures.js';

/**
 * The owner a compilation is handed.
 *
 * `OwnerIdentity.providerId` is the owning package's provider identity, and
 * `specs/04-message-authoring-and-catalogs.spec.md` section 3 gives a provider identity one
 * grammar. A value outside it is refused with the code a catalog's provider identity gets, whether
 * or not the request carries a catalog, because the owner is hashed into the generated owner
 * identity either way.
 */

const configuration = testProjectConfiguration(['en-US']);

function catalog(): Catalog {
  const parsed = parseCatalog('messages:\n  title: Home\n', {
    role: 'source',
    providerId: '@example/app',
    scopeId: 'shell',
    locale: 'en-US',
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return parsed.value;
}

function compile(providerId: string, catalogs: readonly Catalog[]) {
  return compileProject({
    configuration,
    catalogs,
    owner: { providerId, generatedRootPath: 'src/i18n' },
  });
}

describe('the provider identity of the owner compileProject is handed', () => {
  it.each([
    ['no catalogs', []],
    ['a catalog', [catalog()]],
  ])('is refused when it is not one, with %s', (_what, catalogs) => {
    const result = compile('Not A Provider', catalogs);

    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.map(({ code, summary, path }) => ({
        code,
        summary,
        path,
      })),
    ).toEqual([
      {
        code: 'EQ1104',
        summary:
          'Provider identity does not match the Equator identity grammar.',
        path: ['owner', 'providerId'],
      },
    ]);
  });

  it('is the code parseCatalog gives the same value', () => {
    const refused = parseCatalog('messages:\n  title: Home\n', {
      role: 'source',
      providerId: 'Not A Provider',
      scopeId: 'shell',
      locale: 'en-US',
    });

    expect(refused.diagnostics.map(({ code }) => code)).toEqual(['EQ1104']);
  });

  it.each([
    ['no catalogs', []],
    ['a catalog', [catalog()]],
  ])('is taken when it is one, with %s', (_what, catalogs) => {
    const result = compile('@example/app', catalogs);

    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
  });
});
