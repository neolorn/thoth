import { describe, expect, it } from 'vitest';

import { PLATFORM_ID, REQUEST } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PlatformLocation } from '@angular/common';
import {
  MOCK_PLATFORM_LOCATION_CONFIG,
  MockPlatformLocation,
} from '@angular/common/testing';
import {
  Localization,
  createDefaultLocalePrefixPolicy,
  createHostLocalePolicy,
  createLocaleNeutralPolicy,
  createPathPrefixLocalePolicy,
  defineRouteProjection,
  provideLocalizationSetup,
  withRouting,
  type LocaleUrlPolicy,
} from '@neolorn/equator';
import { configuration, localizationSetup } from '#i18n';
import { routeProjection } from '#i18n/routes';
import { messages } from '#i18n/shell';

import { claimCapability } from '../../../tools/capability-claims-in-tests.mjs';

/**
 * The fallback chain under each URL policy.
 *
 * This panel's default, `ar-EG`, inherits from `ar`, and its catalog leaves out the greeting `ar`
 * has. The panel itself states no locale in its addresses, so these cases compose it with each
 * policy kind in turn and reach `ar-EG` the way each one does: a path segment, an address without
 * one under a policy that leaves the default unprefixed, no statement at all, and an origin. The
 * chain is the same whichever way the locale was reached, and each case holds it to that.
 */

// The panel's routes take no parameters, so the generated projection is the whole of it.
const projection = defineRouteProjection({ generated: routeProjection });

const PREFIXES = { 'en-US': 'en-us', ar: 'ar', 'ar-EG': 'ar-eg' };
const ORIGINS = {
  'en-US': 'https://en.embedded.test',
  ar: 'https://ar.embedded.test',
  'ar-EG': 'https://eg.embedded.test',
};

const CASES: readonly (readonly [string, LocaleUrlPolicy, string])[] = [
  [
    'a prefix on every locale',
    createPathPrefixLocalePolicy({ defaultLocale: 'ar-EG', locales: PREFIXES }),
    'https://embedded.test/ar-eg/about',
  ],
  [
    'no prefix on the default',
    createDefaultLocalePrefixPolicy({
      defaultLocale: 'ar-EG',
      locales: PREFIXES,
    }),
    'https://embedded.test/about',
  ],
  [
    'no locale in the address',
    createLocaleNeutralPolicy({
      defaultLocale: 'ar-EG',
      locales: ['en-US', 'ar', 'ar-EG'],
    }),
    'https://embedded.test/about',
  ],
  [
    'an origin for each locale',
    createHostLocalePolicy({ defaultLocale: 'ar-EG', origins: ORIGINS }),
    `${ORIGINS['ar-EG']}/about`,
  ],
];

function setup(policy: LocaleUrlPolicy, url: string): Localization {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      // A server render, where an address is supplied whole, origin included.
      { provide: PLATFORM_ID, useValue: 'server' },
      { provide: REQUEST, useValue: new Request(url) },
      { provide: MOCK_PLATFORM_LOCATION_CONFIG, useValue: { startUrl: url } },
      { provide: PlatformLocation, useClass: MockPlatformLocation },
      provideLocalizationSetup(
        localizationSetup,
        withRouting({ policy, projection }),
      ),
    ],
  });
  return TestBed.inject(Localization);
}

describe('the fallback chain under each URL policy', () => {
  for (const [addresses, policy, url] of CASES) {
    it(`supplies what ar-EG leaves out from ar with ${addresses}`, async () => {
      expect(configuration.localeFallbacks).toEqual({ 'ar-EG': ['ar'] });
      const localization = setup(policy, url);

      expect(
        (await localization.initialize()).primaryLocale,
        `the locale the ${policy.kind} policy reaches at ${url}`,
      ).toBe('ar-EG');
      expect(localization.evaluateText(messages.heading).supplyingLocale).toBe(
        'ar-EG',
      );
      expect(
        localization.evaluateText(messages.greeting).supplyingLocale,
        'the greeting the ar-EG catalog leaves out, from ar, the next locale in localeFallbacks',
      ).toBe('ar');
      claimCapability('capability:fallback-chain', {
        policy,
        platform: TestBed.inject(PLATFORM_ID) as string,
      });
    });
  }
});
