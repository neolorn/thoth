import { describe, expect, it } from 'vitest';

import {
  LocalizationError,
  createPathPrefixLocalePolicy,
  provideLocalizationSetup,
  withExtensions,
  withFormattingContext,
  withRecoveryMessage,
  withRelativeTimePolicy,
  withRouting,
} from '@neolorn/equator';
import { provideLocalizedRouter } from '@neolorn/equator/router';

import { routes } from './app.routes';
import { appRouteProjection } from './localization.routes';

/**
 * A provider handed a value of another kind than its declaration names.
 *
 * Section 3 of `specs/07-routing-rendering-and-seo.spec.md` holds an option declared as an object
 * or as a list to that kind where the configuration is given. Each call here is one an application
 * that is not type-checked can write, and each is refused by the call itself with
 * `invalid-configuration`, before any provider is built.
 */

const POLICY = createPathPrefixLocalePolicy({
  defaultLocale: 'en-US',
  locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg', 'en-Arab-XB': 'en-arab-xb' },
});

/** The diagnostic code a call refuses with, the name of any other error, or `undefined`. */
const refusal = (call: () => unknown): string | undefined => {
  try {
    call();
    return undefined;
  } catch (error) {
    return error instanceof LocalizationError
      ? error.diagnostic.code
      : `a bare ${(error as Error).constructor.name}`;
  }
};

const NOT_AN_OBJECT: readonly unknown[] = [
  null,
  'text',
  7,
  true,
  ['x'],
  () => undefined,
];
const NOT_A_LIST: readonly unknown[] = [
  null,
  'text',
  7,
  true,
  { a: 1 },
  () => undefined,
];

const OBJECTS: readonly (readonly [string, (value: never) => unknown])[] = [
  ['withRouting(options)', (v) => withRouting(v)],
  [
    'withRouting policy',
    (v) => withRouting({ policy: v, projection: appRouteProjection }),
  ],
  [
    'withRouting projection',
    (v) => withRouting({ policy: POLICY, projection: v }),
  ],
  [
    'withRouting projection.generated',
    (v) =>
      withRouting({
        policy: POLICY,
        projection: { ...appRouteProjection, generated: v },
      }),
  ],
  [
    'withRouting indexing',
    (v) =>
      withRouting({
        policy: POLICY,
        projection: appRouteProjection,
        indexing: v,
      }),
  ],
  [
    'withRouting sitemap',
    (v) =>
      withRouting({
        policy: POLICY,
        projection: appRouteProjection,
        sitemap: v,
      }),
  ],
  [
    'withRouting caching',
    (v) =>
      withRouting({
        policy: POLICY,
        projection: appRouteProjection,
        caching: v,
      }),
  ],
  ['withFormattingContext(context)', (v) => withFormattingContext(v)],
  ['withRelativeTimePolicy(policy)', (v) => withRelativeTimePolicy(v)],
  ['withRecoveryMessage(options)', (v) => withRecoveryMessage(v)],
  ['withRecoveryMessage message', (v) => withRecoveryMessage({ message: v })],
  ['provideLocalizationSetup(setup)', (v) => provideLocalizationSetup(v)],
  ['provideLocalizedRouter(options)', (v) => provideLocalizedRouter(routes, v)],
  [
    'provideLocalizedRouter documentMetadata',
    (v) => provideLocalizedRouter(routes, { documentMetadata: v }),
  ],
  [
    'provideLocalizedRouter outcomeDocuments',
    (v) => provideLocalizedRouter(routes, { outcomeDocuments: v }),
  ],
  [
    'provideLocalizedRouter, a scope',
    (v) => provideLocalizedRouter(routes, { requiredScopes: [v] }),
  ],
];

const LISTS: readonly (readonly [string, (value: never) => unknown])[] = [
  ['withExtensions(bindings)', (v) => withExtensions(v)],
  ['provideLocalizedRouter(routes)', (v) => provideLocalizedRouter(v)],
  [
    'provideLocalizedRouter, the scopes of a route',
    (v) => provideLocalizedRouter(routes, { progressiveScopes: { home: v } }),
  ],
];

describe('a provider option declared as an object', () => {
  for (const [option, call] of OBJECTS) {
    it.each(NOT_AN_OBJECT)(`${option} is refused when it is %j`, (value) => {
      expect(refusal(() => call(value as never))).toBe('invalid-configuration');
    });
  }
});

describe('a provider option declared as a list', () => {
  for (const [option, call] of LISTS) {
    it.each(NOT_A_LIST)(`${option} is refused when it is %j`, (value) => {
      expect(refusal(() => call(value as never))).toBe('invalid-configuration');
    });
  }
});

describe('a scope option of provideLocalizedRouter', () => {
  it.each([null, 'text', 7, true])(
    'is refused when it is neither a list nor a table: %j',
    (value) => {
      for (const name of ['requiredScopes', 'progressiveScopes']) {
        expect(
          refusal(() =>
            provideLocalizedRouter(routes, { [name]: value as never }),
          ),
        ).toBe('invalid-configuration');
      }
    },
  );
});

describe('provider options of the kind their declaration names', () => {
  it('are taken', () => {
    expect(
      refusal(() =>
        withRouting({ policy: POLICY, projection: appRouteProjection }),
      ),
    ).toBeUndefined();
    expect(
      refusal(() => withFormattingContext({ timeZone: 'UTC' })),
    ).toBeUndefined();
    expect(refusal(() => withExtensions([]))).toBeUndefined();
    expect(refusal(() => provideLocalizedRouter(routes, {}))).toBeUndefined();
  });
});
