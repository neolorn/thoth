import { describe, expect, it } from 'vitest';

import {
  localeProfile,
  openGraphAlternates,
  openGraphLocale,
} from '../core/src/locale-profile.js';

/**
 * A locale with no territory, and the alternates a page lists beside its own locale.
 *
 * Open Graph's `language_TERRITORY` has two parts, so a tag that maximizes to no territory has no
 * spelling there. `tlh-Latn` is one: the likely-subtags data gives Klingon a script when asked and
 * no region.
 */

const NO_TERRITORY = 'tlh-Latn';

describe('a locale that maximizes to no territory', () => {
  it('has a profile with no region member', () => {
    expect(localeProfile(NO_TERRITORY)).toStrictEqual({
      locale: 'tlh-Latn',
      language: 'tlh',
      script: 'Latn',
      direction: 'ltr',
    });
  });

  it('has no Open Graph spelling', () => {
    expect(openGraphLocale(NO_TERRITORY)).toBeUndefined();
  });
});

describe('the social alternates of a page', () => {
  const CLUSTER = [
    { hreflang: 'en-US' },
    { hreflang: 'ar-EG' },
    { hreflang: 'x-default' },
  ];

  it('lists every other locale and never the routing default', () => {
    expect(openGraphAlternates('en-US', CLUSTER)).toEqual(['ar_EG']);
    expect(openGraphAlternates('ar-EG', CLUSTER)).toEqual(['en_US']);
  });

  it('lists every locale when the page states none of its own', () => {
    expect(openGraphAlternates(undefined, CLUSTER)).toEqual(['en_US', 'ar_EG']);
  });

  it('drops an alternate with no Open Graph spelling', () => {
    expect(
      openGraphAlternates('en-US', [
        { hreflang: NO_TERRITORY },
        { hreflang: 'not a tag' },
        { hreflang: 'ar-EG' },
      ]),
    ).toEqual(['ar_EG']);
    expect(
      openGraphAlternates(undefined, [{ hreflang: NO_TERRITORY }]),
    ).toEqual([]);
  });

  it('lists a territory once when two alternates spell the same one', () => {
    expect(
      openGraphAlternates('en-US', [{ hreflang: 'ar' }, { hreflang: 'ar-EG' }]),
    ).toEqual(['ar_EG']);
  });
});
