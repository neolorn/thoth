import {
  createPathPrefixLocalePolicy,
  type LocaleUrlPolicy,
} from '@neolorn/equator';

/**
 * The site this deployment answers at, declared once because two things compose it.
 *
 * The router builds every canonical and alternate URL from it, and `server.ts` builds the sitemap
 * from it. Written twice they could disagree, and the failure would be a sitemap advertising
 * addresses the head of every page contradicts, which is exactly the disagreement the two are
 * supposed to be incapable of.
 */
export const SITE_ORIGIN = 'https://site.example';

/**
 * The pseudo-locale is in here beside the two real ones, and that is the whole of what a consumer
 * writes to make one addressable.
 *
 * A prerendered page has no request, so a locale that is never in a URL can never be prerendered
 * or server-rendered: it is reachable only by a client-side switch, which is half the product.
 * Giving it a prefix here says where it lives *if this build has it*. Whether it has it is decided
 * by `equator generate --pseudo`, and `localizedServerRoutes` reads the generated configuration to
 * find out: a production build lists no `en-Arab-XB` catalog, so no address for it is emitted, no
 * page is prerendered at it, and no `hreflang` advertises it.
 *
 * That division is why this line is safe to write once and leave. Before the configuration reached
 * the routing layer it was not: the same three entries produced `/en-arab-xb/second` and
 * `/en-arab-xb/articles/handbook` in a production build. Redirects rather than fake
 * content, but two published addresses for a locale that only exists on a developer's machine.
 *
 * Typed as every policy rather than as the one built here, because this file and `addresses.json`
 * beside it are what a consumer row replaces to run the same application under another policy, and
 * the specs ask the running policy which kind it is.
 */
export const routePolicy: LocaleUrlPolicy = createPathPrefixLocalePolicy({
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
