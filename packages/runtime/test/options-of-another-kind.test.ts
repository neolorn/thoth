import { describe, expect, it } from 'vitest';

import { createLocaleRequestHandler } from '../http/src/handler.js';
import { refuseOptionsOfAnotherKind } from '../router/src/navigation-scopes.js';
import {
  createLocalizationContext,
  createLocalizationRuntime,
} from '../src/localization.js';
import { createLocalizationEventEmitter } from '../src/observability.js';
import {
  LocalizationError,
  createDefaultLocalePrefixPolicy,
  createHostLocalePolicy,
  createIdentifierParameterCodec,
  createLocaleNeutralPolicy,
  createPathPrefixLocalePolicy,
  localizedServerRoutes,
  validateRouteProjection,
  ɵfunctionOption,
  ɵnamedOption,
  ɵtextOption,
  type GeneratedConfiguration,
  type LocalizationSetup,
} from '@neolorn/equator/core';

import { compileSet, loadersFor, scope } from './catalog-store-harness.js';

/**
 * An option given a value of another kind than its declaration names.
 *
 * Section 3 of `specs/07-routing-rendering-and-seo.spec.md`: an option declared as an object or as
 * a list is held to that kind where the configuration is given, and anything else is a
 * configuration fault. An application that is not type-checked can pass any value, and the cases
 * here pass each kind an option does not take to every constructor a unit test can call: the four
 * policy constructors, the identifier codec, the request handler with the policy, the projection
 * and the generated configuration it reads, the server routes, the options of the Router
 * integration, and the localization context.
 *
 * An option declared as a function, as text, or as one of a set of named values, is held the same
 * way. The features and the testing helpers that take one are built inside an Angular application,
 * so the cases here call the checks they call, and the sink of a context, which a unit test can
 * hand over.
 */

/** Every kind of value that is not an object. */
const NOT_AN_OBJECT: readonly (readonly [string, unknown])[] = [
  ['null', null],
  ['text', 'text'],
  ['a number', 7],
  ['a boolean', true],
  ['a list', ['x']],
  ['an empty list', []],
  ['a function', () => undefined],
];

/** Every kind of value that is not a list. */
const NOT_A_LIST: readonly (readonly [string, unknown])[] = [
  ['null', null],
  ['text', 'text'],
  ['a number', 7],
  ['a boolean', true],
  ['an object', { a: 1 }],
  ['an empty object', {}],
  ['a function', () => undefined],
];

/** Every kind of value that is not a function. */
const NOT_A_FUNCTION: readonly (readonly [string, unknown])[] = [
  ['nothing', undefined],
  ['null', null],
  ['text', 'text'],
  ['a number', 7],
  ['a boolean', true],
  ['a list', ['x']],
  ['an object', { call: () => undefined }],
];

/** Every kind of value that is none of the names an option declares. */
const NOT_A_NAME: readonly (readonly [string, unknown])[] = [
  ['nothing', undefined],
  ['null', null],
  ['other text', 'cookie'],
  ['a name in another case', 'URL'],
  ['a number', 7],
  ['a list of one name', ['url']],
  ['an object', { url: true }],
  ['a function', () => 'url'],
];

/** The diagnostic a call refuses with, or `undefined` when it did not refuse. */
const refusal = (call: () => unknown) => {
  try {
    call();
    return undefined;
  } catch (error) {
    if (error instanceof LocalizationError) return error.diagnostic;
    throw error;
  }
};

const LOCALES = { 'en-US': 'en-us', 'ar-EG': 'ar-eg' } as const;
const ORIGINS = {
  'en-US': 'https://en.example',
  'ar-EG': 'https://ar.example',
} as const;

const prefixed = (options: object) =>
  createPathPrefixLocalePolicy({
    defaultLocale: 'en-US',
    locales: LOCALES,
    ...options,
  } as never);
const defaulted = (options: object) =>
  createDefaultLocalePrefixPolicy({
    defaultLocale: 'en-US',
    locales: LOCALES,
    ...options,
  } as never);
const neutral = (options: object) =>
  createLocaleNeutralPolicy({
    defaultLocale: 'en-US',
    locales: ['en-US', 'ar-EG'],
    ...options,
  } as never);
const hosted = (options: object) =>
  createHostLocalePolicy({
    defaultLocale: 'en-US',
    origins: ORIGINS,
    ...options,
  } as never);

const GENERATED = {
  profile: 'equator-route-projection/1',
  identity: 'sha256-OptionsOfAnotherKindTestIdentity01234567890',
  routes: [
    { id: 'home', path: '', parameterNames: [] },
    { id: 'item', path: 'item/:id', parameterNames: ['id'] },
  ],
} as const;
const PROJECTION = {
  generated: GENERATED,
  parameters: { item: { id: createIdentifierParameterCodec() } },
  localizedPaths: { item: { 'ar-EG': 'ar-item/:id' } },
  historical: { retired: { kind: 'gone' } },
} as const;
const CONFIGURATION = {
  locales: ['en-US', 'ar-EG'],
} as unknown as GeneratedConfiguration;
const CACHE = { successMaxAge: 600, permanentRedirectMaxAge: 86_400 } as const;

const projected = (options: object) =>
  validateRouteProjection({ ...PROJECTION, ...options } as never);
const handling = (options: object) =>
  createLocaleRequestHandler({
    policy: prefixed({}),
    projection: PROJECTION,
    cache: CACHE,
    cookie: false,
    ...options,
  } as never);
const serverRoutes = (declarations: unknown, options?: unknown) =>
  localizedServerRoutes(
    prefixed({}),
    PROJECTION as never,
    CONFIGURATION,
    declarations as never,
    options as never,
  );

/** A localization context from options the harness makes valid, with some replaced. */
const context = (options: (valid: Record<string, unknown>) => unknown) => {
  const set = compileSet();
  return createLocalizationRuntime(
    options({
      setup: {
        configuration: set.configuration,
        catalogSet: set.descriptor,
        catalogLoaders: loadersFor(set),
      } as unknown as LocalizationSetup,
      bootstrapScopes: [scope('shell')],
    }) as never,
  );
};

const SHELL = scope('shell');

/** Each option declared as an object, with the call that hands it a value. */
const OBJECTS: readonly (readonly [string, (value: unknown) => unknown])[] = [
  [
    'createPathPrefixLocalePolicy(options)',
    (v) => createPathPrefixLocalePolicy(v as never),
  ],
  ['createPathPrefixLocalePolicy locales', (v) => prefixed({ locales: v })],
  ['createPathPrefixLocalePolicy aliases', (v) => prefixed({ aliases: v })],
  [
    'createDefaultLocalePrefixPolicy(options)',
    (v) => createDefaultLocalePrefixPolicy(v as never),
  ],
  ['createDefaultLocalePrefixPolicy locales', (v) => defaulted({ locales: v })],
  ['createDefaultLocalePrefixPolicy aliases', (v) => defaulted({ aliases: v })],
  [
    'createLocaleNeutralPolicy(options)',
    (v) => createLocaleNeutralPolicy(v as never),
  ],
  [
    'createHostLocalePolicy(options)',
    (v) => createHostLocalePolicy(v as never),
  ],
  ['createHostLocalePolicy origins', (v) => hosted({ origins: v })],
  [
    'createIdentifierParameterCodec(pattern)',
    (v) => createIdentifierParameterCodec(v as never),
  ],
  [
    'createLocaleRequestHandler(options)',
    (v) => createLocaleRequestHandler(v as never),
  ],
  ['createLocaleRequestHandler policy', (v) => handling({ policy: v })],
  ['createLocaleRequestHandler projection', (v) => handling({ projection: v })],
  ['createLocaleRequestHandler cache', (v) => handling({ cache: v })],
  ['createLocaleRequestHandler cookie', (v) => handling({ cookie: v })],
  [
    'createLocaleRequestHandler configuration',
    (v) => handling({ configuration: v }),
  ],
  [
    'a written-out path-prefix policy, locales',
    (v) => handling({ policy: { ...prefixed({}), locales: v } }),
  ],
  [
    'a written-out path-prefix policy, prefixes',
    (v) => handling({ policy: { ...prefixed({}), prefixes: v } }),
  ],
  [
    'a written-out path-prefix policy, aliases',
    (v) => handling({ policy: { ...prefixed({}), aliases: v } }),
  ],
  [
    'a written-out host policy, locales',
    (v) => handling({ policy: { ...hosted({}), locales: v } }),
  ],
  [
    'a written-out host policy, origins',
    (v) => handling({ policy: { ...hosted({}), origins: v } }),
  ],
  [
    'a written-out locale-neutral policy, locales',
    (v) => handling({ policy: { ...neutral({}), locales: v } }),
  ],
  ['a projection', (v) => validateRouteProjection(v as never)],
  ['a projection, generated', (v) => projected({ generated: v })],
  [
    'a projection, a generated route',
    (v) => projected({ generated: { ...GENERATED, routes: [v] } }),
  ],
  ['a projection, parameters', (v) => projected({ parameters: v })],
  [
    'a projection, the parameters of a route',
    (v) => projected({ parameters: { item: v } }),
  ],
  [
    'a projection, a codec',
    (v) => projected({ parameters: { item: { id: v } } }),
  ],
  ['a projection, localizedPaths', (v) => projected({ localizedPaths: v })],
  [
    'a projection, the localized paths of a route',
    (v) => projected({ localizedPaths: { item: v } }),
  ],
  ['a projection, historical', (v) => projected({ historical: v })],
  [
    'a projection, a historical outcome',
    (v) => projected({ historical: { retired: v } }),
  ],
  ['localizedServerRoutes options', (v) => serverRoutes([], v)],
  ['the Router integration, options', (v) => refuseOptionsOfAnotherKind(v)],
  [
    'the Router integration, a scope',
    (v) => refuseOptionsOfAnotherKind({ requiredScopes: [v] }),
  ],
  [
    'the Router integration, documentMetadata',
    (v) => refuseOptionsOfAnotherKind({ documentMetadata: v }),
  ],
  [
    'the Router integration, the document metadata of a route',
    (v) => refuseOptionsOfAnotherKind({ documentMetadata: { home: v } }),
  ],
  [
    'the Router integration, outcomeDocuments',
    (v) => refuseOptionsOfAnotherKind({ outcomeDocuments: v }),
  ],
  ['a localization context, options', (v) => context(() => v)],
  [
    'a localization context, setup',
    (v) => context((valid) => ({ ...valid, setup: v })),
  ],
];

/** Each option declared as a list, with the call that hands it a value. */
const LISTS: readonly (readonly [string, (value: unknown) => unknown])[] = [
  [
    'createPathPrefixLocalePolicy localeNeutralRoots',
    (v) => prefixed({ localeNeutralRoots: v }),
  ],
  [
    'createDefaultLocalePrefixPolicy localeNeutralRoots',
    (v) => defaulted({ localeNeutralRoots: v }),
  ],
  ['createLocaleNeutralPolicy locales', (v) => neutral({ locales: v })],
  [
    'createLocaleNeutralPolicy localeNeutralRoots',
    (v) => neutral({ localeNeutralRoots: v }),
  ],
  [
    'createHostLocalePolicy localeNeutralRoots',
    (v) => hosted({ localeNeutralRoots: v }),
  ],
  [
    'a written-out path-prefix policy, localeNeutralRoots',
    (v) => handling({ policy: { ...prefixed({}), localeNeutralRoots: v } }),
  ],
  [
    'a written-out host policy, localeNeutralRoots',
    (v) => handling({ policy: { ...hosted({}), localeNeutralRoots: v } }),
  ],
  [
    'a written-out locale-neutral policy, localeNeutralRoots',
    (v) => handling({ policy: { ...neutral({}), localeNeutralRoots: v } }),
  ],
  [
    'a generated configuration, locales',
    (v) => handling({ configuration: { locales: v } }),
  ],
  [
    'a projection, the generated routes',
    (v) => projected({ generated: { ...GENERATED, routes: v } }),
  ],
  [
    'a projection, the parameter names of a generated route',
    (v) =>
      projected({
        generated: {
          ...GENERATED,
          routes: [{ id: 'home', path: '', parameterNames: v }],
        },
      }),
  ],
  ['localizedServerRoutes declarations', (v) => serverRoutes(v)],
  [
    'the Router integration, the scopes of a route',
    (v) => refuseOptionsOfAnotherKind({ progressiveScopes: { home: v } }),
  ],
  [
    'a localization context, bootstrapScopes',
    (v) => context((valid) => ({ ...valid, bootstrapScopes: v })),
  ],
];

describe('an option declared as an object', () => {
  for (const [option, call] of OBJECTS) {
    it.each(NOT_AN_OBJECT)(`${option} is refused when it is %s`, (_, value) => {
      expect(refusal(() => call(value))).toMatchObject({
        code: 'invalid-configuration',
        outcome: 'operational-failure',
      });
    });
  }
});

describe('an option declared as a list', () => {
  for (const [option, call] of LISTS) {
    it.each(NOT_A_LIST)(`${option} is refused when it is %s`, (_, value) => {
      expect(refusal(() => call(value))).toMatchObject({
        code: 'invalid-configuration',
        outcome: 'operational-failure',
      });
    });
  }
});

describe('a scope option of the Router integration', () => {
  it.each([null, 'text', 7, true, () => undefined])(
    'is refused when it is neither a list nor a table: %j',
    (value) => {
      for (const name of ['requiredScopes', 'progressiveScopes']) {
        expect(
          refusal(() => refuseOptionsOfAnotherKind({ [name]: value })),
        ).toMatchObject({ code: 'invalid-configuration' });
      }
    },
  );
});

describe('an option declared as a function', () => {
  it.each(NOT_A_FUNCTION)('is refused when it is %s', (_, value) => {
    expect(refusal(() => ɵfunctionOption(value, 'The option'))).toMatchObject({
      code: 'invalid-configuration',
      outcome: 'operational-failure',
      reason: 'malformed-input',
    });
  });

  it('is taken as given when it is one', () => {
    const given = (): number => 1;
    expect(ɵfunctionOption(given, 'The option')).toBe(given);
  });
});

describe('an option declared as text', () => {
  it.each([
    ['nothing', undefined],
    ['null', null],
    ['a number', 7],
    ['a boolean', true],
    ['a list of text', ['text']],
    ['an object', { toString: () => 'text' }],
    ['a function', () => 'text'],
  ])('is refused when it is %s', (_, value) => {
    expect(refusal(() => ɵtextOption(value, 'The option'))).toMatchObject({
      code: 'invalid-configuration',
      outcome: 'operational-failure',
      reason: 'malformed-input',
    });
  });

  it('is taken as given when it is text, empty text included', () => {
    expect(ɵtextOption('shell', 'The option')).toBe('shell');
    expect(ɵtextOption('', 'The option')).toBe('');
  });
});

describe('an option declared as one of a set of named values', () => {
  it.each(NOT_A_NAME)('is refused when it is %s', (_, value) => {
    expect(
      refusal(() => ɵnamedOption(value, ['url', 'stored'], 'The option')),
    ).toMatchObject({
      code: 'invalid-configuration',
      outcome: 'operational-failure',
      reason: 'malformed-input',
    });
  });

  it('names the values it takes and never the one it was given', () => {
    expect(
      refusal(() => ɵnamedOption('cookie', ['url', 'stored'], 'The option'))
        ?.message,
    ).toBe('The option must be one of url, stored, and other text was given.');
  });

  it('is taken as given when it is one of them', () => {
    expect(ɵnamedOption('stored', ['url', 'stored'], 'The option')).toBe(
      'stored',
    );
  });
});

describe('an observability sink', () => {
  const SINKS: readonly (readonly [string, unknown])[] = [
    ...NOT_AN_OBJECT,
    ['an object with no emit', {}],
    ['an object whose emit is text', { emit: 'text' }],
  ];

  it.each(SINKS)('is refused by the emitter when it is %s', (_, value) => {
    expect(
      refusal(() => createLocalizationEventEmitter(value as never)),
    ).toMatchObject({ code: 'invalid-configuration' });
  });

  it.each(SINKS)('is refused by a context when it is %s', (_, value) => {
    const set = compileSet();
    expect(
      refusal(() =>
        createLocalizationContext({
          setup: {
            configuration: set.configuration,
            catalogSet: set.descriptor,
            catalogLoaders: loadersFor(set),
          } as unknown as LocalizationSetup,
          observability: value as never,
        }),
      ),
    ).toMatchObject({ code: 'invalid-configuration' });
  });

  it('is taken when it is an object that emits', () => {
    expect(
      refusal(() => createLocalizationEventEmitter({ emit: () => undefined })),
    ).toBeUndefined();
  });
});

describe('options of the kind their declaration names', () => {
  it('are taken by each constructor', () => {
    expect(
      prefixed({ aliases: { en: 'en-US' }, localeNeutralRoots: ['api'] }),
    ).toMatchObject({ aliases: { en: 'en-US' }, localeNeutralRoots: ['api'] });
    expect(defaulted({}).omitDefaultPrefix).toBe(true);
    expect(
      neutral({ localeNeutralRoots: ['api'] }).localeNeutralRoots,
    ).toStrictEqual(['api']);
    expect(
      hosted({ localeNeutralRoots: ['api'] }).localeNeutralRoots,
    ).toStrictEqual(['api']);
    expect(
      createIdentifierParameterCodec(/^[a-z]+$/u).parse('abc'),
    ).toStrictEqual({ ok: true, value: 'abc' });
    expect(projected({})).toBeDefined();
    expect(handling({ cookie: {}, configuration: CONFIGURATION })).toBeTypeOf(
      'function',
    );
    expect(serverRoutes([], {})).toBeDefined();
    expect(context((valid) => valid)).toBeDefined();
  });

  it('are taken by the Router integration', () => {
    for (const options of [
      {},
      { requiredScopes: [SHELL], progressiveScopes: { home: [SHELL] } },
      { documentMetadata: { home: {} }, outcomeDocuments: {} },
    ]) {
      expect(
        refusal(() => refuseOptionsOfAnotherKind(options)),
      ).toBeUndefined();
    }
  });
});
