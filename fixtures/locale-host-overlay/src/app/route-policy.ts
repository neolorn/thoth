import { createHostLocalePolicy, type LocaleUrlPolicy } from '@neolorn/equator';

/**
 * The origin this build answers at, which must be one of the policy's own. A build serves one
 * origin, so the consumer row builds once for each.
 */
export const SITE_ORIGIN = 'http://en-us.localhost';

/**
 * Each locale on an origin of its own. `.localhost` names are reserved for loopback, so a request
 * the gate fails to route still never leaves the machine.
 */
export const routePolicy: LocaleUrlPolicy = createHostLocalePolicy({
  defaultLocale: 'en-US',
  origins: {
    'en-US': 'http://en-us.localhost',
    'ar-EG': 'http://ar-eg.localhost',
    'en-Arab-XB': 'http://en-arab-xb.localhost',
  },
  localeNeutralRoots: ['assets'],
  xDefaultUrl: 'http://en-us.localhost',
});
