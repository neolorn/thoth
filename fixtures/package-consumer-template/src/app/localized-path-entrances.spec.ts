import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocationStrategy } from '@angular/common';
import { MOCK_PLATFORM_LOCATION_CONFIG } from '@angular/common/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  Router,
  UrlHandlingStrategy,
  UrlSerializer,
  type Routes,
} from '@angular/router';
import {
  createHostLocalePolicy,
  createLocaleNeutralPolicy,
  defineRouteProjection,
  Localization,
  withRouting,
  type LocaleUrlPolicy,
} from '@neolorn/equator';
import { provideLocalizedRouter } from '@neolorn/equator/router';
import { provideLocalizationTesting } from '@neolorn/equator/testing';
import { configuration } from '#i18n';
import { catalogLoaders } from '#i18n/catalog-loaders';
import { catalogSet } from '#i18n/catalog-set';
import { recoveryPayload } from '#i18n/recovery-payload';
import { routeProjection } from '#i18n/routes';

import { runtimeExtensions } from './runtime-extensions';
import { appRouteProjection } from './localization.routes';

import { claimCapability } from '../../tools/capability-claims-in-tests.mjs';

/**
 * A localized path, at both entrances, under the two policies with no locale in the path.
 *
 * Under `locale-neutral` a route with a localized path has one address per locale, and under
 * `locale-host` one per origin. The Router matches the authored spelling only, so both entrances
 * translate the localized one as they translate a prefixed one: the location strategy for the
 * address the browser holds, and the URL handling strategy for one the application hands the
 * Router. Under a host policy a path names a locale only with the origin it is read at, which is
 * the origin this build is configured to answer at.
 *
 * Each case builds its own policy, so every row runs the same cases.
 */

@Component({
  standalone: true,
  template: `route`,
})
class RouteProbe {}

const routes: Routes = [
  { path: '', component: RouteProbe },
  { path: 'second', component: RouteProbe },
  { path: '**', component: RouteProbe },
];

/** The fixture's routes, with an Arabic spelling of one path. */
const projection = defineRouteProjection({
  ...appRouteProjection,
  localizedPaths: {
    'route:second': { 'en-US': 'second', 'ar-EG': 'الثاني' },
  },
});

/** Percent-encoded, as the browser holds it. */
const ARABIC_SECOND = `/${encodeURIComponent('الثاني')}`;

const NEUTRAL: LocaleUrlPolicy = createLocaleNeutralPolicy({
  defaultLocale: 'en-US',
  locales: ['en-US', 'ar-EG', 'en-Arab-XB'],
});

const HOST: LocaleUrlPolicy = createHostLocalePolicy({
  defaultLocale: 'en-US',
  origins: {
    'en-US': 'https://site.example',
    'ar-EG': 'https://ar.site.example',
    'en-Arab-XB': 'https://xb.site.example',
  },
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * The two strategies of a build that answers at `origin`, with the browser at `address` there.
 *
 * Initialized before it is read, because the next reset disposes the context, and a disposal
 * during initialization rejects it.
 */
async function entrances(
  policy: LocaleUrlPolicy,
  origin: string,
  address: string,
): Promise<{
  readonly location: LocationStrategy;
  readonly handed: (address: string) => string;
}> {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      {
        provide: MOCK_PLATFORM_LOCATION_CONFIG,
        useValue: { startUrl: `${origin}${address}` },
      },
      provideLocalizedRouter(routes, { origin }),
      provideLocalizationTesting(
        {
          configuration,
          catalogSet,
          catalogLoaders,
          recoveryPayload,
          extensions: runtimeExtensions,
          routeProjection,
        },
        withRouting({ policy, projection }),
      ),
    ],
  });
  await TestBed.inject(Localization).initialize();
  const handling = TestBed.inject(UrlHandlingStrategy);
  const serializer = TestBed.inject(UrlSerializer);
  const router = TestBed.inject(Router);
  return {
    location: TestBed.inject(LocationStrategy),
    handed: (supplied) =>
      serializer.serialize(handling.extract(router.parseUrl(supplied))),
  };
}

describe('a localized path under a policy with no locale in the path', () => {
  it('reaches its route from the address bar under a locale-neutral policy', async () => {
    const { location } = await entrances(
      NEUTRAL,
      'https://site.example',
      ARABIC_SECOND,
    );

    expect(location.path()).toBe('/second');
    claimCapability('policy:locale-neutral', { policy: NEUTRAL });
  });

  it('reaches its route from the address bar under a host policy, at the origin the build answers at', async () => {
    const { location } = await entrances(
      HOST,
      'https://ar.site.example',
      ARABIC_SECOND,
    );
    expect(location.path()).toBe('/second');

    // The control: a build for the default origin reads the same path as no route of its own and
    // hands it through, so the answer above is the configured origin's.
    const control = await entrances(
      HOST,
      'https://site.example',
      ARABIC_SECOND,
    );
    expect(control.location.path()).toBe(ARABIC_SECOND);
    claimCapability('policy:locale-host', { policy: HOST });
  });

  it('reaches its route when the application hands it to the Router', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const neutral = await entrances(NEUTRAL, 'https://site.example', '/');
    expect(neutral.handed(ARABIC_SECOND)).toBe('/second');

    const host = await entrances(HOST, 'https://ar.site.example', '/');
    expect(host.handed(ARABIC_SECOND)).toBe('/second');
    claimCapability('policy:locale-neutral', { policy: NEUTRAL });
    claimCapability('policy:locale-host', { policy: HOST });
  });
});
