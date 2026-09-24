import { describe, expect, it } from 'vitest';

import {
  createLocaleNeutralPolicy,
  resolveLocalizedRoute,
  routeCacheHeaders,
  routeHttpDescriptor,
  type LocalePreferenceSource,
  type LocaleUrlPolicy,
  type RouteHttpDescriptor,
  type RouteRuntimeProjection,
} from '@neolorn/equator/core';

/**
 * Two questions live in a response's cache headers and only one of them is the consumer's.
 *
 * Whether a shared cache may hold a response is Equator's conclusion about its own routing. How
 * long one should then hold it is a fact about a deployment. A consumer answering both, by mapping
 * classifications to directive strings in a conditional chain, compiles, answers, and goes on
 * compiling and answering after a classification changes meaning, because a conditional chain
 * always has a last branch.
 *
 * A third thing is in the split, and it is the one Equator genuinely cannot derive: where
 * the host read the visitor's locale preference. Equator never sees the request. It knows that an
 * answer varied by locale; it cannot know whether that came from `Accept-Language`, which a shared
 * cache can hold one variant of per language, or from a cookie, which it cannot.
 *
 * Exhaustiveness of the classification itself is deliberately not pinned by a test: the `switch`
 * has no `default` and the function returns a declared type, so a fifth classification stops the
 * build rather than reaching a test that could have been forgotten.
 */

const descriptorFor = (
  cache: RouteHttpDescriptor['cache'],
): RouteHttpDescriptor =>
  cache === 'consumer-defined-permanent'
    ? { status: 308, location: '/en-us', cache }
    : { status: 200, contentLanguage: 'en-US', cache };

const FRESHNESS = {
  successMaxAge: 600,
  permanentRedirectMaxAge: 86_400,
  localePreference: 'none',
} as const;

describe('the cache headers Equator determines', () => {
  it('emits storability itself and takes freshness from the consumer', () => {
    expect(routeCacheHeaders(descriptorFor('public'), FRESHNESS)).toStrictEqual(
      {
        'cache-control': 'public, max-age=600, must-revalidate',
      },
    );
    expect(
      routeCacheHeaders(descriptorFor('consumer-defined-permanent'), FRESHNESS),
    ).toStrictEqual({ 'cache-control': 'public, max-age=86400' });
    expect(
      routeCacheHeaders(descriptorFor('private-no-cache'), FRESHNESS),
    ).toStrictEqual({ 'cache-control': 'private, no-cache' });
    expect(
      routeCacheHeaders(descriptorFor('private-no-store'), FRESHNESS),
    ).toStrictEqual({ 'cache-control': 'private, no-store' });
  });

  it('turns a varying answer into a shared variant only when the header allows it', () => {
    // `Accept-Language` is content negotiation, and a shared cache holding one variant per language
    // is exactly what it is for.
    expect(
      routeCacheHeaders(descriptorFor('varies-by-locale-preference'), {
        ...FRESHNESS,
        localePreference: 'accept-language',
      }),
    ).toStrictEqual({
      'cache-control': 'public, max-age=600, must-revalidate',
      vary: 'Accept-Language',
    });

    // A cookie is not. It carries everything, so a cache keyed on the whole of one stores a variant
    // per visitor, which is not a shared cache, and the answer is `private` rather than a `Vary`.
    expect(
      routeCacheHeaders(descriptorFor('varies-by-locale-preference'), {
        ...FRESHNESS,
        localePreference: 'cookie',
      }),
    ).toStrictEqual({ 'cache-control': 'private, no-store' });
  });

  it('refuses the contradiction of an answer that varied by a preference nobody reads', () => {
    expect(() =>
      routeCacheHeaders(descriptorFor('varies-by-locale-preference'), {
        ...FRESHNESS,
        localePreference: 'none',
      }),
    ).toThrow(/cannot both be true/u);
  });

  /**
   * The whole input space, not a sample of it.
   *
   * `LocalePreferenceSource` is a closed union of three, `cache` a closed union of five, and
   * `variesBy` is present or absent, so thirty calls is every call that can be written. Nothing in
   * that space produces `Vary: Cookie`, and nothing can be made to: there is no input anywhere on
   * this surface that names a header, so the mistake is unrepresentable rather than rejected. This
   * asserts the consequence; the type is what enforces it.
   */
  it('cannot be asked to vary a shared cache on a cookie', () => {
    const sources: readonly LocalePreferenceSource[] = [
      'none',
      'accept-language',
      'cookie',
    ];
    const classifications: readonly RouteHttpDescriptor['cache'][] = [
      'public',
      'private-no-cache',
      'private-no-store',
      'consumer-defined-permanent',
      'varies-by-locale-preference',
    ];

    const emitted = new Set<string>();
    for (const cache of classifications) {
      for (const localePreference of sources) {
        for (const variesBy of [undefined, 'locale-preference'] as const) {
          try {
            const headers = routeCacheHeaders(
              {
                ...descriptorFor(cache),
                ...(variesBy === undefined ? {} : { variesBy }),
              },
              { ...FRESHNESS, localePreference },
            );
            if (headers.vary !== undefined) emitted.add(headers.vary);
          } catch {
            // The one refused class, asserted by name in the test above.
          }
        }
      }
    }

    expect([...emitted]).toStrictEqual(['Accept-Language']);
  });

  it('keeps a negotiated answer negotiated whoever may keep it', () => {
    // `Vary` also tells the browser the answer was chosen by its language, so raising who may keep
    // a response leaves it. Under a cookie there is nothing to name, and nothing is.
    for (const cache of ['private-no-cache', 'private-no-store'] as const) {
      const descriptor: RouteHttpDescriptor = {
        ...descriptorFor(cache),
        variesBy: 'locale-preference',
      };
      expect(
        routeCacheHeaders(descriptor, {
          ...FRESHNESS,
          localePreference: 'accept-language',
        }).vary,
      ).toBe('Accept-Language');
      expect(
        routeCacheHeaders(descriptor, {
          ...FRESHNESS,
          localePreference: 'cookie',
        }).vary,
      ).toBeUndefined();
      expect(
        routeCacheHeaders(descriptorFor(cache), {
          ...FRESHNESS,
          localePreference: 'accept-language',
        }).vary,
      ).toBeUndefined();
    }
  });

  it('gives a private response no way to become shared', () => {
    // The half the consumer owns must not reach into the half they do not. Three freshness
    // settings that visibly move the `public` answer leave both private classes untouched.
    const settings = [
      { successMaxAge: 0, permanentRedirectMaxAge: 0 },
      { successMaxAge: 31_536_000, permanentRedirectMaxAge: 31_536_000 },
      {
        successMaxAge: 60,
        permanentRedirectMaxAge: 60,
        revalidateSuccess: false,
      },
    ] as const;

    const control = new Set<string>();
    for (const setting of settings) {
      expect(
        routeCacheHeaders(descriptorFor('private-no-store'), {
          ...setting,
          localePreference: 'none',
        }),
      ).toStrictEqual({ 'cache-control': 'private, no-store' });
      expect(
        routeCacheHeaders(descriptorFor('private-no-cache'), {
          ...setting,
          localePreference: 'none',
        }),
      ).toStrictEqual({ 'cache-control': 'private, no-cache' });
      control.add(
        routeCacheHeaders(descriptorFor('public'), {
          ...setting,
          localePreference: 'none',
        })['cache-control'],
      );
    }
    expect(control.size).toBe(3);
  });

  it('refuses a duration a cache cannot read', () => {
    // `delta-seconds` is an integer. A fraction is truncated by some caches and rejected by others,
    // so the header stops meaning what was written, silently, at the edge.
    for (const successMaxAge of [1.5, -1]) {
      expect(() =>
        routeCacheHeaders(descriptorFor('public'), {
          ...FRESHNESS,
          successMaxAge,
        }),
      ).toThrow(/whole number of seconds/u);
    }
    expect(() =>
      routeCacheHeaders(descriptorFor('public'), {
        ...FRESHNESS,
        successMaxAge: 0,
      }),
    ).not.toThrow();
  });
});

/**
 * Locale entry is answered for one visitor and asked again on every reuse.
 *
 * `/` carries every locale's redirect under one cache key, so no shared cache may keep any of them,
 * and a browser that kept the one it was given must ask again before using it: a visitor who
 * changes preference is then sent where the new one points. Nothing about the answer is sensitive,
 * so it is `no-cache` rather than `no-store`.
 */
describe('what locale entry may be cached as', () => {
  const POLICY: LocaleUrlPolicy = {
    kind: 'path-prefix',
    defaultLocale: 'en-US',
    locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg' },
    prefixes: { 'en-us': 'en-US', 'ar-eg': 'ar-EG' },
    aliases: {},
    localeNeutralRoots: [],
    omitDefaultPrefix: false,
  };

  const PROJECTION: RouteRuntimeProjection = {
    generated: {
      profile: 'equator-route-projection/1',
      identity: 'sha256-BuiltLocaleAddressesTestIdentity01234567890',
      routes: [{ id: 'route:about', path: 'about', parameterNames: [] }],
    },
  };

  it('is private and revalidated, with a preference and without one', () => {
    for (const context of [undefined, { locale: 'ar-EG' }]) {
      const resolution = resolveLocalizedRoute(
        '/about',
        POLICY,
        PROJECTION,
        context,
      );
      expect(resolution).toMatchObject({
        status: 'redirect',
        reason: 'locale-entry',
        cache: 'private-no-cache',
      });
      expect(
        routeCacheHeaders(routeHttpDescriptor(resolution), {
          ...FRESHNESS,
          localePreference: 'cookie',
        }),
      ).toStrictEqual({ 'cache-control': 'private, no-cache' });
    }
  });

  it('names Accept-Language where the deployment negotiates by it', () => {
    const resolution = resolveLocalizedRoute('/about', POLICY, PROJECTION, {
      locale: 'ar-EG',
    });
    expect(
      routeCacheHeaders(routeHttpDescriptor(resolution), {
        ...FRESHNESS,
        localePreference: 'accept-language',
      }),
    ).toStrictEqual({
      'cache-control': 'private, no-cache',
      vary: 'Accept-Language',
    });
  });

  it('is the same for an address that names no route', () => {
    // Entry answers before the question of whether the page exists, so the address that has no
    // page is classified the same way as the one that does.
    expect(resolveLocalizedRoute('/nowhere', POLICY, PROJECTION)).toMatchObject(
      {
        status: 'redirect',
        reason: 'locale-entry',
        cache: 'private-no-cache',
      },
    );
  });
});

/**
 * And the classification is produced by resolution, not only nameable in a type.
 *
 * A `locale-neutral` policy puts every locale at one address, so which document that address
 * returns is decided by something the address does not state. Both requests below go to the same
 * URL and get different documents.
 */
describe('what a locale-neutral policy does to cacheability', () => {
  const POLICY: LocaleUrlPolicy = createLocaleNeutralPolicy({
    defaultLocale: 'en-US',
    locales: ['en-US', 'ar-EG'],
    localeNeutralRoots: ['assets'],
  });

  const PROJECTION: RouteRuntimeProjection = {
    generated: {
      profile: 'equator-route-projection/1',
      identity: 'sha256-BuiltLocaleAddressesTestIdentity01234567890',
      routes: [{ id: 'route:about', path: 'about', parameterNames: [] }],
    },
    localizedPaths: { 'route:about': { 'en-US': 'about', 'ar-EG': 'about' } },
  };

  const headersFor = (
    locale: string | undefined,
    localePreference: LocalePreferenceSource,
  ) =>
    routeCacheHeaders(
      routeHttpDescriptor(
        resolveLocalizedRoute(
          '/about',
          POLICY,
          PROJECTION,
          locale === undefined ? undefined : { locale },
        ),
      ),
      { ...FRESHNESS, localePreference },
    );

  it('marks a success that one address answers in more than one language', () => {
    const negotiated = resolveLocalizedRoute('/about', POLICY, PROJECTION, {
      locale: 'ar-EG',
    });
    const plain = resolveLocalizedRoute('/about', POLICY, PROJECTION);

    // Same URL, two documents.
    expect([
      negotiated.status === 'success' ? negotiated.locale : negotiated.status,
      plain.status === 'success' ? plain.locale : plain.status,
    ]).toStrictEqual(['ar-EG', 'en-US']);

    // And both classified as varying, including the one that consulted nothing, which is the
    // whole point, because it shares a cache key with the one that did.
    expect([
      routeHttpDescriptor(negotiated).cache,
      routeHttpDescriptor(plain).cache,
    ]).toStrictEqual([
      'varies-by-locale-preference',
      'varies-by-locale-preference',
    ]);
  });

  it('is private under a cookie and a shared variant under Accept-Language', () => {
    expect(headersFor(undefined, 'cookie')).toStrictEqual({
      'cache-control': 'private, no-store',
    });
    expect(headersFor('ar-EG', 'accept-language')).toStrictEqual({
      'cache-control': 'public, max-age=600, must-revalidate',
      vary: 'Accept-Language',
    });
  });

  it('keeps Accept-Language on a private page it negotiated', () => {
    // Private keeps the page out of every shared cache; the language it was chosen in is still the
    // one `Accept-Language` picked.
    const privatePage: RouteRuntimeProjection = {
      ...PROJECTION,
      generated: {
        ...PROJECTION.generated,
        routes: [
          {
            id: 'route:about',
            path: 'about',
            parameterNames: [],
            indexing: 'private',
          },
        ],
      },
    };
    const descriptor = routeHttpDescriptor(
      resolveLocalizedRoute('/about', POLICY, privatePage, {
        locale: 'ar-EG',
      }),
    );

    expect(descriptor).toMatchObject({
      cache: 'private-no-store',
      variesBy: 'locale-preference',
    });
    expect(
      routeCacheHeaders(descriptor, {
        ...FRESHNESS,
        localePreference: 'accept-language',
      }),
    ).toStrictEqual({
      'cache-control': 'private, no-store',
      vary: 'Accept-Language',
    });
  });

  it('leaves an address that states its own locale publicly cacheable', () => {
    // The control. A path-prefix policy answers the same document to every request for a given
    // address, so nothing varies and the classification must not have spread.
    const prefixed: LocaleUrlPolicy = {
      kind: 'path-prefix',
      defaultLocale: 'en-US',
      locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg' },
      prefixes: { 'en-us': 'en-US', 'ar-eg': 'ar-EG' },
      aliases: {},
      localeNeutralRoots: [],
      omitDefaultPrefix: false,
    };

    expect(
      routeHttpDescriptor(
        resolveLocalizedRoute('/ar-eg/about', prefixed, PROJECTION, {
          locale: 'en-US',
        }),
      ).cache,
    ).toBe('public');
  });
});
