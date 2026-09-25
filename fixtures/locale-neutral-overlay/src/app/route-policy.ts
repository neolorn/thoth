import {
  createLocaleNeutralPolicy,
  type LocaleUrlPolicy,
} from '@neolorn/equator';

/** The site this deployment answers at, which the router and `server.ts` both compose from. */
export const SITE_ORIGIN = 'https://site.example';

/**
 * One address for every locale, with the locale coming from the reader rather than from the URL.
 * The same locales as the development row, so what differs is only where the locale is not.
 */
export const routePolicy: LocaleUrlPolicy = createLocaleNeutralPolicy({
  defaultLocale: 'en-US',
  locales: ['en-US', 'ar-EG', 'en-Arab-XB'],
  localeNeutralRoots: ['assets'],
  xDefaultPath: '/',
});
