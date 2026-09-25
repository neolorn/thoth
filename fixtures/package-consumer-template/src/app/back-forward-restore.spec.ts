import { describe, expect, it, vi } from 'vitest';

import { TestBed } from '@angular/core/testing';
import {
  Localization,
  createHostLocalePolicy,
  createLocaleNeutralPolicy,
  memoryStore,
  provideLocalizationSetup,
  withPersistence,
  withRouting,
  type LocaleUrlPolicy,
  type LocalizationPersistenceStore,
} from '@neolorn/equator';
import { configuration } from '#i18n';
import { catalogLoaders } from '#i18n/catalog-loaders';
import { catalogSet } from '#i18n/catalog-set';
import { recoveryPayload } from '#i18n/recovery-payload';
import { routeProjection } from '#i18n/routes';

import { runtimeExtensions } from './runtime-extensions';
import { routePolicy, appRouteProjection } from './localization.routes';
import { localeInPath, pagePath } from './addresses';

/**
 * A page the browser restores from its back-forward cache, after the visitor chose another language.
 *
 * `specs/07-routing-rendering-and-seo.spec.md` section 5 lets a browser keep a page whose language
 * came from a cookie, on the condition that it asks the server again before reusing it. A restored
 * page is the one reuse that does not ask: the browser brings back the page as it was in memory. So
 * the page asks itself, on `pageshow`, and moves only where the address it is at would not have
 * chosen its current language.
 */

const NEUTRAL: LocaleUrlPolicy = createLocaleNeutralPolicy({
  defaultLocale: 'en-US',
  locales: ['en-US', 'ar-EG', 'en-Arab-XB'],
  xDefaultPath: '/',
});

interface Seat {
  readonly localization: Localization;
  /** What another tab writes, standing in for the cookie every tab of the site shares. */
  readonly shared: LocalizationPersistenceStore;
  readonly reads: () => number;
  readonly written: readonly string[];
}

function setup(policy: LocaleUrlPolicy): Seat {
  const shared = memoryStore()();
  let reads = 0;
  const written: string[] = [];
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideLocalizationSetup(
        {
          configuration,
          catalogSet,
          catalogLoaders,
          recoveryPayload,
          extensions: runtimeExtensions,
          routeProjection,
        },
        withRouting({ policy, projection: appRouteProjection }),
        withPersistence(() => ({
          id: 'shared',
          read: () => {
            reads += 1;
            return shared.read();
          },
          write: (locale: string) => {
            written.push(locale);
            return shared.write(locale);
          },
        })),
      ),
    ],
  });
  return {
    localization: TestBed.inject(Localization),
    shared,
    reads: () => reads,
    written,
  };
}

function restore(persisted: boolean): void {
  window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted }));
}

async function settled(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
}

describe('a page restored from the back-forward cache', () => {
  it('moves to the language chosen since it was left, and records nothing', async () => {
    const seat = setup(NEUTRAL);
    expect((await seat.localization.initialize()).primaryLocale).toBe('en-US');

    await seat.shared.write('ar-EG');
    restore(true);

    await vi.waitFor(() =>
      expect(seat.localization.snapshot()?.primaryLocale).toBe('ar-EG'),
    );
    // Resolved rather than chosen, and only a deliberate change is written.
    expect(seat.written).toEqual([]);
  });

  // Where the path states the language. A document's origin cannot be moved from here, so the
  // origin's own case below names this document's origin instead.
  it.runIf(localeInPath)(
    'stays in the language its address states',
    async () => {
      history.replaceState(null, '', pagePath('home', 'en-US'));
      const seat = setup(routePolicy);
      expect((await seat.localization.initialize()).primaryLocale).toBe(
        'en-US',
      );

      await seat.shared.write('ar-EG');
      const before = seat.reads();
      restore(true);
      await new Promise((done) => setTimeout(done, 0));

      // The store was consulted, which is what makes staying put an answer rather than a miss.
      expect(seat.reads()).toBeGreaterThan(before);
      expect(seat.localization.targetLocale()).toBeUndefined();
      expect(seat.localization.snapshot()?.primaryLocale).toBe('en-US');
    },
  );

  it('stays in the language its origin states', async () => {
    // This document's own origin, named as the Arabic one, so the origin is the only thing here
    // that states Arabic: the path is the same in every locale.
    const seat = setup(
      createHostLocalePolicy({
        defaultLocale: 'en-US',
        origins: {
          'en-US': 'http://en-us.localhost',
          'ar-EG': location.origin,
        },
      }),
    );
    expect((await seat.localization.initialize()).primaryLocale).toBe('ar-EG');

    await seat.shared.write('en-US');
    const before = seat.reads();
    restore(true);
    await new Promise((done) => setTimeout(done, 0));

    expect(seat.reads()).toBeGreaterThan(before);
    expect(seat.localization.targetLocale()).toBeUndefined();
    expect(seat.localization.snapshot()?.primaryLocale).toBe('ar-EG');
  });

  it('does nothing on a first showing', async () => {
    const seat = setup(NEUTRAL);
    await seat.localization.initialize();
    await seat.shared.write('ar-EG');
    const before = seat.reads();

    restore(false);
    await settled();

    expect(seat.reads()).toBe(before);
  });

  it('lets go of the window once the application is gone', async () => {
    // A listener left on the window keeps the whole application reachable after it is destroyed.
    const added = vi.spyOn(window, 'addEventListener');
    const removed = vi.spyOn(window, 'removeEventListener');
    const pageshow = (calls: readonly (readonly unknown[])[]) =>
      calls
        .filter(([type]) => type === 'pageshow')
        .map(([, listener]) => listener);
    try {
      const seat = setup(NEUTRAL);
      await seat.localization.initialize();
      const listeners = pageshow(added.mock.calls);

      TestBed.resetTestingModule();

      expect(listeners).toHaveLength(1);
      expect(pageshow(removed.mock.calls)).toEqual(
        expect.arrayContaining(listeners),
      );
    } finally {
      added.mockRestore();
      removed.mockRestore();
    }
  });
});
