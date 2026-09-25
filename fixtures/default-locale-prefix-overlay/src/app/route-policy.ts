import {
  createDefaultLocalePrefixPolicy,
  type LocaleUrlPolicy,
} from '@neolorn/equator';

/** The site this deployment answers at, which the router and `server.ts` both compose from. */
export const SITE_ORIGIN = 'https://site.example';

/**
 * The development row's policy with the default locale written without its prefix, which is the
 * shape of a site that was English at `/` before it had a second language.
 */
export const routePolicy: LocaleUrlPolicy = createDefaultLocalePrefixPolicy({
  defaultLocale: 'en-US',
  locales: {
    'en-US': 'en-us',
    'ar-EG': 'ar-eg',
    'en-Arab-XB': 'en-arab-xb',
  },
  aliases: {
    en: 'en-US',
    ar: 'ar-EG',
  },
  localeNeutralRoots: ['assets'],
  xDefaultPath: '/',
});
