import { describe, expect, it } from 'vitest';

import { putBackPageLeft } from '../router/src/navigation-scopes.js';
import { createLocalizationRuntime } from '../src/localization.js';
import type {
  LocalizationRouteSnapshot,
  LocalizationSetup,
} from '@neolorn/equator/core';

import { compileSet, loadersFor, scope } from './catalog-store-harness.js';

/**
 * The page a navigation left, put back where the navigation ends without its own.
 *
 * Section 7 of `specs/07-routing-rendering-and-seo.spec.md`. A navigation commits its locale before
 * its page is on screen, and three endings leave that commit to undo: the navigation is cancelled,
 * it fails, or it lands and its document cannot be written. The Router integration answers all
 * three with the function called here, against the context it is called with there.
 */

const LEFT: LocalizationRouteSnapshot = Object.freeze({
  routeId: 'route:left',
  projectionIdentity: 'sha256-NavigationPagePutBackTestIdentity0123456789',
  canonicalPath: '/left',
});
const DESTINATION: LocalizationRouteSnapshot = Object.freeze({
  ...LEFT,
  routeId: 'route:destination',
  canonicalPath: '/destination',
});

/** A context on the page a navigation is about to leave, in English. */
async function onPageLeft() {
  const set = compileSet();
  const localization = createLocalizationRuntime({
    setup: {
      configuration: set.configuration,
      catalogSet: set.descriptor,
      catalogLoaders: loadersFor(set),
    } as unknown as LocalizationSetup,
    bootstrapScopes: [scope('shell')],
  });
  await localization.initialize();
  const arrived = await localization.changeLocale('en-US', {
    requiredScopes: [scope('shell')],
    route: LEFT,
  });
  expect(arrived.status).toBe('committed');
  const previousSnapshot = localization.snapshot();
  expect(previousSnapshot?.route?.canonicalPath).toBe('/left');
  return { localization, previousSnapshot };
}

describe('the page a navigation left, where the navigation ends without its own', () => {
  it('is put back in the locale a change made in place committed after the navigation did', async () => {
    const { localization, previousSnapshot } = await onPageLeft();
    // The navigation's own commit, to another page in the locale already on screen.
    await localization.changeLocale('en-US', {
      requiredScopes: [scope('shell'), scope('lazy')],
      route: DESTINATION,
    });
    const inPlace = await localization.changeLocale('ar-EG');
    expect(inPlace.status).toBe('committed');

    const restored = await putBackPageLeft(localization, {
      mode: 'coordinated',
      previousSnapshot,
      navigationLocale: 'en-US',
    });

    expect(restored).toBe(true);
    const snapshot = localization.snapshot();
    // What the caller of the change was told and what the state is are one locale.
    expect(snapshot?.primaryLocale).toBe('ar-EG');
    expect(snapshot?.route?.routeId).toBe('route:left');
    expect(snapshot?.requiredScopes).toStrictEqual([scope('shell')]);
    localization.dispose();
  });

  it('is put back in the locale from before the navigation where no change was made in place', async () => {
    const { localization, previousSnapshot } = await onPageLeft();
    await localization.changeLocale('ar-EG', {
      requiredScopes: [scope('shell')],
      route: DESTINATION,
    });

    const restored = await putBackPageLeft(localization, {
      mode: 'coordinated',
      previousSnapshot,
      navigationLocale: 'ar-EG',
    });

    expect(restored).toBe(true);
    const snapshot = localization.snapshot();
    expect(snapshot?.primaryLocale).toBe('en-US');
    expect(snapshot?.route).toStrictEqual(LEFT);
    localization.dispose();
  });

  it('answers that nothing was put back where the navigation left no page', async () => {
    const { localization } = await onPageLeft();

    const restored = await putBackPageLeft(localization, {
      mode: 'coordinated',
      previousSnapshot: undefined,
      navigationLocale: 'en-US',
    });

    expect(restored).toBe(false);
    expect(localization.snapshot()?.route?.canonicalPath).toBe('/left');
    localization.dispose();
  });
});
