/**
 * Two open families whose names give one generated name.
 *
 * A family is generated under its name with each hyphen dropped and the letter after it raised, so
 * `order-x` is generated as `orderX`. A catalog read from a file cannot hold a second family that
 * lands there, because a family name in a file is lower-case. A catalog handed over as an object
 * can: `diffCatalogSets` takes the catalogs it is given, and one built or edited in code may name a
 * family `orderX` outright. The two families would then be generated as one name, so the second is
 * refused where it is declared, naming both families and the name they share.
 */
import { describe, expect, it } from 'vitest';

import {
  defineExtensionRegistry,
  diffCatalogSets,
  parseCatalog,
  type Catalog,
} from '../src/index.js';
import { testProjectConfiguration } from './fixtures.js';

function registry() {
  const defined = defineExtensionRegistry([
    {
      kind: 'identifier-segment',
      id: 'demo:state',
      syntax: 'lower-kebab',
      maximumLength: 8,
    },
  ]);
  if (!defined.ok) throw new Error(JSON.stringify(defined.diagnostics));
  return defined.value;
}

/** A catalog as a file gives it, with one family named `order-x`. */
function parsed(): Catalog {
  const catalog = parseCatalog(
    [
      'messages:',
      '  status.ready: Ready',
      '  stage.ready: Ready',
      'families:',
      '  order-x:',
      '    template: "status.{state}"',
      '    segments:',
      '      state: demo:state',
      '',
    ].join('\n'),
    {
      role: 'source',
      providerId: '@neolorn/family-lab',
      scopeId: 'orders',
      locale: 'en-US',
      sourcePath: 'i18n/orders/en-US.yaml',
      extensions: registry(),
    },
  );
  if (!catalog.ok) throw new Error(JSON.stringify(catalog.diagnostics));
  return catalog.value;
}

/** The same catalog with a second family, under a name no file can spell. */
function withFamily(catalog: Catalog, name: string): Catalog {
  return {
    ...catalog,
    families: {
      ...catalog.families,
      [name]: {
        template: 'stage.{state}',
        segments: { state: 'demo:state' },
      },
    },
  } as Catalog;
}

function diff(catalog: Catalog) {
  const snapshot = {
    configuration: testProjectConfiguration(['en-US']),
    catalogs: [catalog],
    extensions: registry(),
  };
  return diffCatalogSets({ before: snapshot, after: snapshot });
}

describe('two open families generated under one name', () => {
  it('cannot both be read from a file', () => {
    const catalog = parseCatalog(
      [
        'messages:',
        '  stage.ready: Ready',
        'families:',
        '  orderX:',
        '    template: "stage.{state}"',
        '    segments:',
        '      state: demo:state',
        '',
      ].join('\n'),
      {
        role: 'source',
        providerId: '@neolorn/family-lab',
        scopeId: 'orders',
        locale: 'en-US',
        sourcePath: 'i18n/orders/en-US.yaml',
        extensions: registry(),
      },
    );

    expect(catalog.ok).toBe(false);
  });

  it('are refused in a catalog handed over as an object, naming both and the name', () => {
    const result = diff(withFamily(parsed(), 'orderX'));

    expect(result.ok).toBe(false);
    const refusals = result.diagnostics.filter(({ code }) => code === 'EQ1305');
    expect(refusals.map(({ path }) => path)).toEqual([
      ['families', 'orderX'],
      ['families', 'orderX'],
    ]);
    for (const { summary } of refusals) {
      expect(summary).toContain('"order-x"');
      expect(summary).toContain('"orderX"');
    }
  });

  it('are both taken where the second is generated under a name of its own', () => {
    const result = diff(withFamily(parsed(), 'order-y'));

    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
  });
});
