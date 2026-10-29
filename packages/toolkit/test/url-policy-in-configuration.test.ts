import { describe, expect, it } from 'vitest';

import {
  compileProject,
  parseCatalog,
  parseConfiguration,
} from '../src/index.js';
import { formatConfiguration } from '../src/configuration.js';

/**
 * The URL policy and the recovery copy, declared in `thoth.config.json`.
 *
 * `specs/07-routing-rendering-and-seo.spec.md` section 3 and `specs/10-compiler-and-tooling.spec.md`
 * section 10: the configuration names the policy kind and only what the locale list cannot give,
 * generation derives the rest and writes the policy into the setup, and the recovery message is
 * named by its key and bound by generation. Adding a locale is then one line in one file.
 */

const base = {
  schemaVersion: 1,
  sourceLocale: 'en-US',
  defaultLocale: 'en-US',
  locales: ['en-US', 'ar-EG'],
};

function parsed(overrides: Readonly<Record<string, unknown>>) {
  return parseConfiguration(JSON.stringify({ ...base, ...overrides }));
}

function refusals(overrides: Readonly<Record<string, unknown>>) {
  const result = parsed(overrides);
  expect(result.ok).toBe(false);
  return result.diagnostics.map(({ code, path }) => ({ code, path }));
}

const SHELL = {
  'en-US':
    'messages:\n  recovery.unavailable: Unavailable.\n  control.retry: Try again\n',
  'ar-EG':
    'messages:\n  recovery.unavailable: غير متاح.\n  control.retry: أعد المحاولة\n',
};

/** The project compiled from the configuration and one catalog per scope and locale. */
function compiled(
  overrides: Readonly<Record<string, unknown>>,
  scopes: Readonly<Record<string, Readonly<Record<string, string>>>> = {
    shell: SHELL,
  },
) {
  const configuration = parsed(overrides);
  if (!configuration.ok) {
    throw new Error(JSON.stringify(configuration.diagnostics));
  }
  const catalogs = Object.entries(scopes).flatMap(([scopeId, bodies]) =>
    Object.entries(bodies).map(([locale, body]) => {
      const catalog = parseCatalog(body, {
        role: locale === 'en-US' ? 'source' : 'target',
        providerId: '@example/app',
        scopeId,
        locale,
      });
      if (!catalog.ok) throw new Error(JSON.stringify(catalog.diagnostics));
      return catalog.value;
    }),
  );
  return compileProject({
    owner: {
      providerId: '@example/app',
      generatedRootPath: 'src/generated/i18n',
    },
    configuration: configuration.value,
    catalogs,
  });
}

function plannedFile(
  name: string,
  overrides: Readonly<Record<string, unknown>>,
  scopes?: Readonly<Record<string, Readonly<Record<string, string>>>>,
): string {
  const result = compiled(overrides, scopes);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const file = result.value.artifacts.outputPlan.files.find(
    ({ path }) => path.endsWith(`/${name}`) || path === name,
  );
  if (file === undefined) throw new Error(`no ${name} was planned`);
  return String(file.contents);
}

function generatedIndex(overrides: Readonly<Record<string, unknown>>): string {
  return plannedFile('index.ts', overrides);
}

/** The refusals compiling the project returns, by code and summary. */
function compileRefusals(
  overrides: Readonly<Record<string, unknown>>,
  scopes?: Readonly<Record<string, Readonly<Record<string, string>>>>,
) {
  const result = compiled(overrides, scopes);
  expect(result.ok).toBe(false);
  return result.diagnostics.map(({ code, summary }) => ({ code, summary }));
}

describe('a URL policy declared in the configuration', () => {
  it('is generated with every locale given its tag in lowercase', () => {
    const index = generatedIndex({ urlPolicy: 'path-prefix' });

    expect(index).toContain(
      "import { createPathPrefixLocalePolicy } from '@neolorn/thoth';",
    );
    expect(index).toContain(
      'export const urlPolicy = createPathPrefixLocalePolicy({"defaultLocale":"en-US","locales":{"en-US":"en-us","ar-EG":"ar-eg"}});',
    );
    expect(index).toContain('  urlPolicy: urlPolicy,');
  });

  it('carries only the departures the configuration writes', () => {
    const index = generatedIndex({
      urlPolicy: 'path-prefix',
      localePrefixes: { 'ar-EG': 'ar' },
      prefixAliases: { eg: 'ar-EG' },
      omitDefaultPrefix: true,
      localeNeutralRoots: ['assets'],
      xDefault: '/',
    });

    expect(index).toContain(
      'createPathPrefixLocalePolicy({"defaultLocale":"en-US","locales":{"en-US":"en-us","ar-EG":"ar"},"aliases":{"eg":"ar-EG"},"localeNeutralRoots":["assets"],"omitDefaultPrefix":true,"xDefaultPath":"/"})',
    );
  });

  it('is generated as a host policy from the origins', () => {
    const index = generatedIndex({
      urlPolicy: 'locale-host',
      localeOrigins: {
        'en-US': 'https://example.com',
        'ar-EG': 'https://example.eg',
      },
    });

    expect(index).toContain(
      'createHostLocalePolicy({"defaultLocale":"en-US","origins":{"en-US":"https://example.com","ar-EG":"https://example.eg"}})',
    );
  });

  it('is generated as a locale-neutral policy from the locales', () => {
    const index = generatedIndex({ urlPolicy: 'locale-neutral' });

    expect(index).toContain(
      'createLocaleNeutralPolicy({"defaultLocale":"en-US","locales":["en-US","ar-EG"]})',
    );
  });

  it('leaves the setup without a policy when none is declared', () => {
    const index = generatedIndex({});

    expect(index).not.toContain('urlPolicy');
    expect(index).not.toMatch(/create\w+Policy/u);
  });

  it('is refused where a prefix names a locale the project does not serve', () => {
    expect(
      refusals({ urlPolicy: 'path-prefix', localePrefixes: { 'fr-FR': 'fr' } }),
    ).toEqual([{ code: 'TH1009', path: ['localePrefixes', 'fr-FR'] }]);
  });

  it('is refused where an alias spells a segment a derived prefix already claims', () => {
    expect(
      refusals({
        urlPolicy: 'path-prefix',
        prefixAliases: { 'ar-eg': 'ar-EG' },
      }),
    ).toEqual([{ code: 'TH1009', path: ['prefixAliases', 'ar-eg'] }]);
  });

  it('is refused where a pseudo-locale prefix collides with a locale-neutral root', () => {
    expect(
      refusals({
        urlPolicy: 'path-prefix',
        pseudoLocales: { 'en-Latn-XA': { lengthFactor: 0.3 } },
        localeNeutralRoots: ['en-latn-xa'],
      }),
    ).toEqual([{ code: 'TH1009', path: ['localeNeutralRoots', 0] }]);
  });

  it('is refused where a host policy leaves a locale without an origin', () => {
    expect(
      refusals({
        urlPolicy: 'locale-host',
        localeOrigins: { 'en-US': 'https://example.com' },
      }),
    ).toEqual([{ code: 'TH1009', path: ['localeOrigins'] }]);
  });

  it('is refused where an origin is not written as an origin', () => {
    expect(
      refusals({
        urlPolicy: 'locale-host',
        localeOrigins: {
          'en-US': 'https://Example.com',
          'ar-EG': 'https://example.eg',
        },
      }),
    ).toEqual([{ code: 'TH1009', path: ['localeOrigins', 'en-US'] }]);
  });

  it('is refused where two locales share an origin', () => {
    expect(
      refusals({
        urlPolicy: 'locale-host',
        localeOrigins: {
          'en-US': 'https://example.com',
          'ar-EG': 'https://example.com',
        },
      }),
    ).toEqual([{ code: 'TH1009', path: ['localeOrigins', 'ar-EG'] }]);
  });

  it('is refused where x-default is not a path under a path policy', () => {
    expect(
      refusals({ urlPolicy: 'path-prefix', xDefault: 'https://example.com/' }),
    ).toEqual([{ code: 'TH1009', path: ['xDefault'] }]);
  });

  it.each([
    'https://example.com/choose',
    'https://example.com/',
    'https://example.com?x=1',
  ])(
    'is refused where x-default is not an origin under a host policy: %s',
    (xDefault) => {
      expect(
        refusals({
          urlPolicy: 'locale-host',
          localeOrigins: {
            'en-US': 'https://example.com',
            'ar-EG': 'https://example.eg',
          },
          xDefault,
        }),
      ).toEqual([{ code: 'TH1009', path: ['xDefault'] }]);
    },
  );

  it.each([
    [
      {
        urlPolicy: 'path-prefix',
        localeOrigins: { 'en-US': 'https://a.example' },
      },
    ],
    [{ urlPolicy: 'locale-neutral', localePrefixes: { 'en-US': 'en' } }],
    [{ localeNeutralRoots: ['assets'] }],
    [{ recoveryRetry: 'shell/control.retry' }],
  ])(
    'is refused by the schema where a key does not belong: %j',
    (overrides) => {
      const result = parsed(overrides);

      expect(result.ok).toBe(false);
    },
  );
});

describe('a recovery message declared in the configuration', () => {
  it('is bound in the generated setup by its identities', () => {
    const index = generatedIndex({
      recoveryMessage: 'shell/recovery.unavailable',
      recoveryRetry: 'shell/control.retry',
    });

    expect(index).toContain(
      '  recovery: Object.freeze({"identity":"@example/app:shell:recovery.unavailable","retryLabelIdentity":"@example/app:shell:control.retry"}),',
    );
  });

  it('leaves the setup without a binding when none is declared', () => {
    expect(generatedIndex({})).not.toContain('recovery:');
  });

  it('makes the retry label a recovery root beside the message', () => {
    const roots = plannedFile('recovery.ts', {
      recoveryMessage: 'shell/recovery.unavailable',
      recoveryRetry: 'shell/control.retry',
    });

    expect(roots).toContain('"@example/app:shell:recovery.unavailable"');
    expect(roots).toContain('"@example/app:shell:control.retry"');
  });

  it('is refused where its scope has no such message, even when another scope has one by that name', () => {
    expect(
      compileRefusals(
        { recoveryMessage: 'zone/recovery.unavailable' },
        {
          shell: SHELL,
          zone: {
            'en-US': 'messages:\n  title: Zone\n',
            'ar-EG': 'messages:\n  title: المنطقة\n',
          },
        },
      ),
    ).toEqual([
      {
        code: 'TH1501',
        summary:
          'recoveryMessage names "zone/recovery.unavailable", and the source catalogs have no message "recovery.unavailable" in scope "zone".',
      },
    ]);
  });

  it('is refused where the scope it names has no catalog', () => {
    expect(
      compileRefusals({ recoveryMessage: 'absent/recovery.unavailable' }).map(
        ({ code }) => code,
      ),
    ).toEqual(['TH1501']);
  });

  it('is refused where the message it names is rich', () => {
    expect(
      compileRefusals(
        { recoveryMessage: 'shell/recovery.unavailable' },
        {
          shell: {
            'en-US':
              'messages:\n  recovery.unavailable: "{#strong}Unavailable.{/strong}"\n',
            'ar-EG':
              'messages:\n  recovery.unavailable: "{#strong}غير متاح.{/strong}"\n',
          },
        },
      ),
    ).toEqual([
      {
        code: 'TH1501',
        summary:
          'recoveryMessage names "shell/recovery.unavailable", which is not a plain message without inputs or slots. The recovery region renders it when no catalog could be loaded, with nothing to fill an input from.',
      },
    ]);
  });

  it('is refused where the message it names declares a slot', () => {
    expect(
      compileRefusals(
        { recoveryMessage: 'shell/recovery.unavailable' },
        {
          shell: {
            'en-US':
              'messages:\n  recovery.unavailable:\n    message: Unavailable.\n    slots:\n      strong: strong\n',
            'ar-EG': 'messages:\n  recovery.unavailable: غير متاح.\n',
          },
        },
      ),
    ).toEqual([
      {
        code: 'TH1501',
        summary:
          'recoveryMessage names "shell/recovery.unavailable", which is not a plain message without inputs or slots. The recovery region renders it when no catalog could be loaded, with nothing to fill an input from.',
      },
    ]);
  });

  it('is left unbound while the project has no messages yet', () => {
    expect(
      plannedFile(
        'index.ts',
        { recoveryMessage: 'shell/recovery.unavailable' },
        {},
      ),
    ).not.toContain('recovery:');
  });
});

describe('a configuration written back by init and format', () => {
  // `formatConfiguration` is what `init` writes and what a re-run of it compares against, so a key
  // it leaves out is a declaration init accepts on its command line and then drops from the file.
  it.each([
    {
      urlPolicy: 'path-prefix',
      localePrefixes: { 'ar-EG': 'ar' },
      prefixAliases: { arabic: 'ar-EG' },
      omitDefaultPrefix: true,
      localeNeutralRoots: ['api'],
      xDefault: '/',
      recoveryMessage: 'shell/recovery.unavailable',
      recoveryRetry: 'shell/control.retry',
    },
    {
      urlPolicy: 'locale-host',
      localeOrigins: {
        'en-US': 'https://example.com',
        'ar-EG': 'https://example.eg',
      },
      xDefault: 'https://example.com',
    },
  ])('keeps every declared key: %j', (overrides) => {
    const first = parsed(overrides);
    if (!first.ok) throw new Error(JSON.stringify(first.diagnostics));

    const written = formatConfiguration(first.value);

    expect(JSON.parse(written)).toEqual({ ...base, ...overrides });
    const again = parseConfiguration(written);
    expect(again.ok && again.value).toEqual(first.value);
  });
});
