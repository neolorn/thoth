/**
 * What a context remembers of the locale it was moved to, forgets on request, and takes back from
 * its stores for a page shown without reading them.
 *
 * `specs/03-locale-identity-and-resolution.spec.md` section 8: a deliberate change is written to
 * the configured stores after it commits, removal drops it from them and says where it did not
 * land, and a page restored from memory moves to the stored choice only where nothing newer was
 * asked for while the stores were being read. A restore is the stores speaking, so it moves the
 * reader and writes nothing back. `specs/06-runtime-and-angular.spec.md` section 11 keeps
 * persistence outside the commit: none of this decides whether a change commits.
 */
import { describe, expect, it } from 'vitest';

import type { LocalizationPersistenceStore } from '../src/persistence.js';

import { catalogKey, diagnosticOf } from './catalog-store-harness.js';
import { runtime, until } from './transaction-runtime-harness.js';

/** Every microtask and timer already due, for a case that states what was not written. */
const settled = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

/**
 * A store a case can read from the outside, write to as another tab would, and hold open.
 *
 * `holdReads` makes every read after it wait for `releaseReads`, which is what puts a case between
 * the moment the stores are asked and the moment they answer.
 */
function memory() {
  let remembered: string | undefined;
  const writes: string[] = [];
  let pending = 0;
  let gate: Promise<void> | undefined;
  let open: (() => void) | undefined;
  const store: LocalizationPersistenceStore = {
    id: 'memory-under-test',
    read: () => {
      if (gate === undefined) return remembered;
      pending += 1;
      return gate.then(() => remembered);
    },
    write: (locale) => {
      writes.push(locale);
      remembered = locale;
    },
    forget: () => {
      remembered = undefined;
    },
  };
  return {
    store,
    writes,
    remembered: () => remembered,
    /** A choice made elsewhere, which the context under test did not write. */
    chooseElsewhere: (locale: string) => {
      remembered = locale;
    },
    holdReads: () => {
      gate = new Promise<void>((resolve) => {
        open = resolve;
      });
    },
    reading: () => pending > 0,
    releaseReads: () => open?.(),
  };
}

async function ready(fixture: Parameters<typeof runtime>[0] = {}) {
  const remembered = memory();
  const made = runtime({
    ...fixture,
    options: { ...fixture.options, persistence: [remembered.store] },
  });
  await made.localization.initialize();
  return { ...made, remembered };
}

const HERE = { url: '/second' };

describe('the locale a change commits', () => {
  it('is written to the stores once the change has committed', async () => {
    const { localization, remembered } = await ready();

    await localization.changeLocale('ar-EG');
    await settled();

    expect(remembered.writes).toStrictEqual(['ar-EG']);
    localization.dispose();
  });

  it('is written when the request says to remember it', async () => {
    const { localization, remembered } = await ready();

    await localization.changeLocale('ar-EG', { remember: true });
    await settled();

    expect(remembered.writes).toStrictEqual(['ar-EG']);
    localization.dispose();
  });

  it('is committed and not written when the request says not to remember it', async () => {
    const { localization, remembered } = await ready();

    const result = await localization.changeLocale('ar-EG', {
      remember: false,
    });
    await settled();

    expect(result).toMatchObject({
      status: 'committed',
      snapshot: { primaryLocale: 'ar-EG' },
    });
    expect(remembered.writes).toStrictEqual([]);
    localization.dispose();
  });

  it('is not written when the locale negotiated at startup is the one committed', async () => {
    const { localization, remembered } = await ready();
    await settled();

    expect(localization.snapshot()?.primaryLocale).toBe('en-US');
    expect(remembered.writes).toStrictEqual([]);
    localization.dispose();
  });
});

describe('forgetting the remembered locale', () => {
  it('drops it from the stores and reports that it reached them', async () => {
    const { localization, remembered } = await ready();
    await localization.changeLocale('ar-EG');
    await settled();

    const report = await localization.forgetRememberedLocale();

    expect(report).toStrictEqual({ complete: true, unreached: [] });
    expect(remembered.remembered()).toBeUndefined();
    // The page is where it was: forgetting drops the record and moves nothing.
    expect(localization.snapshot()?.primaryLocale).toBe('ar-EG');
    localization.dispose();
  });

  it('is refused once the context is disposed', async () => {
    const { localization } = await ready();
    localization.dispose();

    expect(
      diagnosticOf(() => localization.forgetRememberedLocale()),
    ).toMatchObject({ code: 'disposed' });
  });
});

describe('a page restored without its stores having been read', () => {
  it('moves to the stored locale, and writes nothing back', async () => {
    const { localization, remembered } = await ready();
    remembered.chooseElsewhere('ar-EG');

    const result = await localization.ɵrestoreLocale(HERE);
    await settled();

    expect(result).toMatchObject({
      status: 'committed',
      targetLocale: 'ar-EG',
      snapshot: { primaryLocale: 'ar-EG' },
    });
    expect(remembered.writes).toStrictEqual([]);
    localization.dispose();
  });

  it('stays where it is when nothing is stored', async () => {
    const { localization } = await ready();

    await expect(localization.ɵrestoreLocale(HERE)).resolves.toBeUndefined();

    expect(localization.lastResult()).toBeUndefined();
    expect(localization.snapshot()?.primaryLocale).toBe('en-US');
    localization.dispose();
  });

  it('is left alone before there is a committed locale to restore over', async () => {
    const remembered = memory();
    remembered.chooseElsewhere('ar-EG');
    const { localization } = runtime({
      options: { persistence: [remembered.store] },
    });

    await expect(localization.ɵrestoreLocale(HERE)).resolves.toBeUndefined();

    expect(localization.lifecycle()).toBe('uninitialized');
    expect(localization.lastResult()).toBeUndefined();
    localization.dispose();
  });

  it('is left alone while a change is in flight', async () => {
    const { localization, remembered, release } = await ready({
      hold: [catalogKey('shell', 'ar-EG')],
    });
    const change = localization.changeLocale('ar-EG');
    await until(() => localization.targetLocale() === 'ar-EG');
    remembered.chooseElsewhere('ar-EG');

    const restored = localization.ɵrestoreLocale(HERE);
    release(catalogKey('shell', 'ar-EG'));

    await expect(restored).resolves.toBeUndefined();
    await expect(change).resolves.toMatchObject({ status: 'committed' });
    localization.dispose();
  });

  it('gives way to a change asked for while the stores were being read', async () => {
    const { localization, remembered } = await ready();
    remembered.chooseElsewhere('ar-EG');
    remembered.holdReads();

    const restored = localization.ɵrestoreLocale(HERE);
    await until(remembered.reading);
    const asked = await localization.changeLocale('en-US');
    remembered.releaseReads();

    await expect(restored).resolves.toBeUndefined();
    expect(localization.lastResult()).toBe(asked);
    expect(localization.snapshot()?.primaryLocale).toBe('en-US');
    localization.dispose();
  });

  it('gives way to a removal asked for while the stores were being read', async () => {
    const { localization, remembered } = await ready();
    remembered.chooseElsewhere('ar-EG');
    remembered.holdReads();

    const restored = localization.ɵrestoreLocale(HERE);
    await until(remembered.reading);
    const removal = localization.forgetRememberedLocale();
    remembered.releaseReads();

    await expect(restored).resolves.toBeUndefined();
    await expect(removal).resolves.toMatchObject({ complete: true });
    expect(localization.snapshot()?.primaryLocale).toBe('en-US');
    localization.dispose();
  });

  it('ends without a move, and without an error, when the context is disposed while the stores are read', async () => {
    const { localization, remembered } = await ready();
    remembered.chooseElsewhere('ar-EG');
    remembered.holdReads();

    const restored = localization.ɵrestoreLocale(HERE);
    await until(remembered.reading);
    localization.dispose();
    remembered.releaseReads();

    await expect(restored).resolves.toBeUndefined();
  });
});
