import { describe, expect, it } from 'vitest';

import { createLocaleRequestHandler } from '@neolorn/equator/http';
import { configuration } from '#i18n';

import { expectedPageCaching, pageUrl } from './addresses';
import { localeCookie } from './locale-cookie';
import { appRouteProjection, routePolicy } from './localization.routes';
import { responseCaching } from './response-caching';

import { claimCapability } from '../../tools/capability-claims-in-tests.mjs';

/**
 * The floor this deployment declares for every page, answered by a handler given what `server.ts`
 * gives its own.
 *
 * Runs where the address table says the row declares one. The expectation is the table's and the
 * declaration is `response-caching.ts`'s, so a floor removed from the declaration fails here rather
 * than turning this off.
 */
describe.runIf(expectedPageCaching !== undefined)(
  'the floor this deployment declares for every page',
  () => {
    const answer = createLocaleRequestHandler({
      policy: routePolicy,
      projection: appRouteProjection,
      configuration,
      cache: responseCaching,
      cookie: localeCookie,
      render: () =>
        new Response('<!doctype html>', {
          headers: { 'content-type': 'text/html' },
        }),
    });

    it('raises a page and leaves a redirect as routing classified it', async () => {
      const page = await answer(new Request(pageUrl('second', 'en-US')));
      const replaced = await answer(
        new Request(`${pageUrl('legacy', 'en-US')}?tab=one`),
      );

      // The floor the answers show is the one the declaration makes, so a floor missing from it
      // fails by name rather than as a header.
      expect(responseCaching?.pageCaching).toBe(expectedPageCaching);
      expect(page.status).toBe(200);
      expect(page.headers.get('cache-control')).toBe(
        expectedPageCaching === 'not-stored'
          ? 'private, no-store'
          : 'private, no-cache',
      );
      // A redirect carries no page, so the floor does not reach it.
      expect(replaced.status).toBe(308);
      expect(replaced.headers.get('cache-control')).toBe(
        'public, max-age=86400',
      );
      claimCapability('declaration:host-page-floor', { policy: routePolicy });
    });
  },
);
