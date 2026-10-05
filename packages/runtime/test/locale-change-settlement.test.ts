/**
 * What a locale change leaves behind once it has settled, whichever way it ended.
 *
 * `specs/06-runtime-and-angular.spec.md` section 7 ends a change as committed, cancelled,
 * superseded, failed or redirected, and section 5 says what is readable afterwards: a context
 * with a committed snapshot is `ready` again with no target, whatever became of the change, and a
 * change that settles after a newer one began leaves the newer one's state alone. A change that
 * does not commit says why in a diagnostic that names the change. Section 8 lets a region that
 * prepares on its own catch up after a change, including a change that had nothing else to do,
 * and section 9 lands a scope named as progressive beside the change, and only if the change it
 * was asked beside is still the one committed. The emitter is told of each change twice: when it
 * starts and how it ended.
 */
import { describe, expect, it } from 'vitest';

import type { LocalizationCommitHook } from '../src/localization.js';
import type { LocalizationParticipantReport } from '@neolorn/equator/core';

import { catalogKey, diagnosticOf } from './catalog-store-harness.js';
import {
  HEADING,
  LAZY,
  SHELL,
  UNCOMPILED,
  observed,
  participant,
  route,
  runtime,
  until,
  withUncompiledScope,
} from './transaction-runtime-harness.js';

const FAILED: LocalizationParticipantReport = Object.freeze({
  status: 'failed',
  outcome: 'operational-failure',
  reason: 'environment-failure',
});

/** Every microtask and timer already due, for a case that states what did not happen. */
const settled = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

async function ready(fixture: Parameters<typeof runtime>[0] = {}) {
  const made = runtime(fixture);
  const snapshot = await made.localization.initialize();
  return { ...made, snapshot };
}

describe('the state a settled change leaves readable', () => {
  it('is ready with no target after a change back to the committed locale overtakes one in flight', async () => {
    const { localization, release, snapshot } = await ready({
      hold: [catalogKey('shell', 'ar-EG')],
    });
    const away = localization.changeLocale('ar-EG');
    await until(() => localization.targetLocale() === 'ar-EG');

    const back = await localization.changeLocale('en-US');

    expect(back).toMatchObject({ status: 'committed', snapshot });
    expect(localization.lifecycle()).toBe('ready');
    expect(localization.targetLocale()).toBeUndefined();
    await expect(away).resolves.toMatchObject({ status: 'superseded' });
    expect(localization.lifecycle()).toBe('ready');
    release(catalogKey('shell', 'ar-EG'));
    localization.dispose();
  });

  it('is still the newer change in flight after the change it superseded has settled', async () => {
    const { localization, release } = await ready({
      hold: [catalogKey('shell', 'ar-EG')],
    });
    const first = localization.changeLocale('ar-EG', {
      route: route('/ar-eg/first'),
    });
    const second = localization.changeLocale('ar-EG', {
      route: route('/ar-eg/second'),
    });

    await expect(first).resolves.toMatchObject({ status: 'superseded' });

    expect(localization.lifecycle()).toBe('transitioning');
    expect(localization.targetLocale()).toBe('ar-EG');
    release(catalogKey('shell', 'ar-EG'));
    await expect(second).resolves.toMatchObject({ status: 'committed' });
    expect(localization.lifecycle()).toBe('ready');
    expect(localization.targetLocale()).toBeUndefined();
    localization.dispose();
  });

  it('is ready with no target and the committed snapshot after a change that failed', async () => {
    const { localization, snapshot } = await ready({
      fail: { [catalogKey('shell', 'ar-EG')]: 1 },
    });

    const result = await localization.changeLocale('ar-EG');

    expect(result).toMatchObject({
      status: 'failed',
      diagnostic: { code: 'catalog-load-failed' },
    });
    expect(localization.lifecycle()).toBe('ready');
    expect(localization.targetLocale()).toBeUndefined();
    expect(localization.snapshot()).toBe(snapshot);
    expect(localization.lastResult()).toBe(result);
    localization.dispose();
  });

  it('is failed, with no target, after a change whose own initialization failed', async () => {
    const { localization } = runtime({
      fail: { [catalogKey('shell', 'en-US')]: 1 },
    });

    const result = await localization.changeLocale('ar-EG');

    expect(result).toMatchObject({
      status: 'failed',
      targetLocale: 'ar-EG',
      diagnostic: { code: 'catalog-load-failed' },
    });
    expect(localization.lifecycle()).toBe('failed');
    expect(localization.targetLocale()).toBeUndefined();
    expect(localization.snapshot()).toBeUndefined();
    localization.dispose();
  });
});

describe('a change that did not commit', () => {
  it('says it was superseded, in a diagnostic that names the change', async () => {
    const { localization } = await ready({
      hold: [catalogKey('shell', 'ar-EG')],
    });
    const first = localization.changeLocale('ar-EG');
    await until(() => localization.targetLocale() === 'ar-EG');
    await localization.changeLocale('en-US');

    await expect(first).resolves.toMatchObject({
      status: 'superseded',
      transitionId: 1,
      mode: 'coordinated',
      targetLocale: 'ar-EG',
      diagnostic: {
        code: 'superseded',
        outcome: 'operational-failure',
        targetLocale: 'ar-EG',
        transitionId: 1,
      },
    });
    localization.dispose();
  });

  it('says it was cancelled, in a diagnostic that names the change', async () => {
    const { localization, snapshot } = await ready({
      hold: [catalogKey('shell', 'ar-EG')],
    });
    const change = localization.changeLocale('ar-EG', { mode: 'progressive' });
    await until(() => localization.targetLocale() === 'ar-EG');

    localization.cancelTransition();

    await expect(change).resolves.toMatchObject({
      status: 'cancelled',
      transitionId: 1,
      mode: 'progressive',
      targetLocale: 'ar-EG',
      diagnostic: {
        code: 'cancelled',
        outcome: 'operational-failure',
        targetLocale: 'ar-EG',
        transitionId: 1,
      },
    });
    expect(localization.snapshot()).toBe(snapshot);
    expect(localization.lifecycle()).toBe('ready');
    expect(localization.targetLocale()).toBeUndefined();
    localization.dispose();
  });

  it('is the only thing a cancellation touches: with no change in flight it does nothing', async () => {
    const { localization, snapshot } = await ready();
    const last = await localization.changeLocale('en-US');

    expect(() => localization.cancelTransition()).not.toThrow();

    expect(localization.lastResult()).toBe(last);
    expect(localization.snapshot()).toBe(snapshot);
    expect(localization.lifecycle()).toBe('ready');
    localization.dispose();
  });

  it('cannot be cancelled through a context that is disposed', async () => {
    const { localization } = await ready();
    localization.dispose();

    expect(diagnosticOf(() => localization.cancelTransition())).toMatchObject({
      code: 'disposed',
    });
  });

  it('is cancelled, and commits nothing, when it is cancelled at any point before its snapshot reaches a hook', async () => {
    // Cancelled one turn later each time, so that every point between the request and the commit
    // is one of the points the change is cancelled at.
    const outcomes = new Set<string>();
    for (let turns = 0; outcomes.size < 2 && turns < 200; turns += 1) {
      const handed: string[] = [];
      const watching: LocalizationCommitHook = {
        apply: (snapshot) => void handed.push(snapshot.primaryLocale),
      };
      const { localization } = await ready({
        options: { commitHooks: [watching] },
      });
      // Warmed first, so that the change is turns of the microtask queue away from its commit.
      await localization.preloadScope(SHELL, 'ar-EG');
      const change = localization.changeLocale('ar-EG');
      for (let turn = 0; turn < turns; turn += 1) await Promise.resolve();
      const handedFirst = handed.includes('ar-EG');

      localization.cancelTransition();

      const { status } = await change;
      expect(status, `cancelled ${turns} turns after the request`).toBe(
        handedFirst ? 'committed' : 'cancelled',
      );
      expect(localization.snapshot()?.primaryLocale).toBe(
        handedFirst ? 'ar-EG' : 'en-US',
      );
      outcomes.add(status);
      localization.dispose();
    }
    expect([...outcomes].sort()).toStrictEqual(['cancelled', 'committed']);
  });
});

describe('what a change starts beside itself', () => {
  it('prepares a required participant again only for another locale', async () => {
    const region = participant('region');
    const { localization } = runtime();
    localization.registerParticipant(region.value);
    await localization.initialize();

    await localization.changeLocale('en-US', {
      route: route('/en-us/about'),
    });
    expect(region.calls).toStrictEqual(['prepare en-US', 'commit en-US']);

    await localization.changeLocale('ar-EG');
    expect(region.calls).toStrictEqual([
      'prepare en-US',
      'commit en-US',
      'prepare ar-EG',
      'commit ar-EG',
    ]);
    localization.dispose();
  });

  it('prepares a required participant for a locale it still shows from before, when the change arrives from another', async () => {
    // The region fails in English, so after a progressive change to English it still shows the
    // Arabic it committed at startup while the context has moved on.
    const region = participant('region', { reports: { 'en-US': FAILED } });
    const { localization } = runtime({ options: { initialLocale: 'ar-EG' } });
    const registration = localization.registerParticipant(region.value);
    await localization.initialize();
    await localization.changeLocale('en-US', { mode: 'progressive' });
    await settled();
    expect(registration.state().current?.targetLocale).toBe('ar-EG');
    const prepared = () =>
      region.calls.filter((call) => call === 'prepare ar-EG').length;
    expect(prepared()).toBe(1);

    await expect(localization.changeLocale('ar-EG')).resolves.toMatchObject({
      status: 'committed',
    });

    expect(prepared()).toBe(2);
    localization.dispose();
  });

  it('has a region that failed on its own try again, even when nothing else changed', async () => {
    const region = participant('region', { reports: { 'en-US': FAILED } });
    const { localization } = runtime();
    localization.registerParticipant(region.value, {
      coordination: 'progressive',
    });
    const snapshot = await localization.initialize();
    await settled();
    const attempts = () =>
      region.calls.filter((call) => call === 'prepare en-US').length;
    expect(attempts()).toBe(1);

    const result = await localization.changeLocale('en-US');
    await settled();

    expect(result).toMatchObject({ status: 'committed', snapshot });
    expect(attempts()).toBe(2);
    localization.dispose();
  });

  it('loads nothing again for a progressive scope the snapshot already holds', async () => {
    const { localization } = await ready();
    await localization.ensureScope(LAZY);
    const held = localization.snapshot();
    const readiness = localization.scopeReadiness(LAZY)();

    const result = await localization.changeLocale('en-US', {
      mode: 'progressive',
      progressiveScopes: [LAZY],
    });
    await settled();

    expect(result).toMatchObject({ status: 'committed', snapshot: held });
    expect(localization.snapshot()).toBe(held);
    expect(localization.scopeReadiness(LAZY)()).toBe(readiness);
    localization.dispose();
  });

  it('lands the progressive scopes that loaded when one beside them did not', async () => {
    const { localization } = await ready({ set: withUncompiledScope() });

    const result = await localization.changeLocale('ar-EG', {
      mode: 'progressive',
      progressiveScopes: [UNCOMPILED, LAZY],
    });

    expect(result).toMatchObject({
      status: 'committed',
      snapshot: { loadedScopes: [SHELL] },
    });
    await expect
      .poll(() => localization.snapshot()?.loadedScopes)
      .toStrictEqual([SHELL, LAZY]);
    expect(localization.text(HEADING)).toBe('عنوان مؤجل');
    expect(localization.scopeReadiness(UNCOMPILED)().status).toBe('failed');
    localization.dispose();
  });

  it('drops a progressive scope that loaded for a locale a later change has left', async () => {
    const { localization, release, loads } = await ready({
      hold: [catalogKey('shell', 'ar-EG')],
      setup: { maximumCachedCatalogs: 1 },
    });
    // Nothing required, so that the change back commits in fewer turns than the abandoned load
    // takes to be told it was abandoned.
    await localization.changeLocale('ar-EG', {
      mode: 'progressive',
      requiredScopes: [],
      progressiveScopes: [LAZY, SHELL],
    });
    await expect
      .poll(() => localization.scopeReadiness(LAZY)().status)
      .toBe('ready');

    const back = await localization.changeLocale('en-US', {
      requiredScopes: [],
    });
    release(catalogKey('shell', 'ar-EG'));
    await settled();

    expect(back).toMatchObject({
      status: 'committed',
      snapshot: { primaryLocale: 'en-US', loadedScopes: [] },
    });
    expect(localization.snapshot()).toMatchObject({
      primaryLocale: 'en-US',
      loadedScopes: [],
    });
    expect(diagnosticOf(() => localization.text(HEADING))).toMatchObject({
      code: 'scope-unavailable',
    });

    // What was dropped is also let go of: the cache has room for one catalog nobody holds, so the
    // Arabic one is loaded again when a change next asks for it.
    await localization.changeLocale('ar-EG', { requiredScopes: [LAZY] });
    expect(loads[catalogKey('lazy', 'ar-EG')]).toBe(2);
    localization.dispose();
  });
});

describe('what the emitter is told of a change', () => {
  it('is that it started, and then that it succeeded with the snapshot it committed', async () => {
    const watched = observed();
    const { localization } = await ready({
      options: { observability: watched.emitter },
    });

    const result = await localization.changeLocale('ar-EG');

    expect(watched.phase('transition')).toStrictEqual([
      { status: 'started', targetLocale: 'ar-EG', transitionId: 1 },
      {
        status: 'succeeded',
        snapshotId: result.status === 'committed' ? result.snapshot.id : -1,
        targetLocale: 'ar-EG',
        transitionId: 1,
      },
    ]);
    localization.dispose();
  });

  it('is how it ended, with the reason, when it did not commit', async () => {
    const watched = observed();
    const { localization, release } = await ready({
      hold: [catalogKey('shell', 'ar-EG')],
      fail: { [catalogKey('shell', 'ar-EG')]: 1 },
      options: { observability: watched.emitter },
    });

    const superseded = localization.changeLocale('ar-EG', {
      route: route('/ar-eg/first'),
    });
    const cancelled = localization.changeLocale('ar-EG', {
      route: route('/ar-eg/second'),
    });
    await superseded;
    localization.cancelTransition();
    await cancelled;
    const failed = localization.changeLocale('ar-EG');
    release(catalogKey('shell', 'ar-EG'));
    await failed;

    expect(watched.phase('transition')).toStrictEqual([
      { status: 'started', targetLocale: 'ar-EG', transitionId: 1 },
      { status: 'started', targetLocale: 'ar-EG', transitionId: 2 },
      {
        status: 'superseded',
        reason: 'superseded',
        targetLocale: 'ar-EG',
        transitionId: 1,
      },
      {
        status: 'cancelled',
        reason: 'cancelled',
        targetLocale: 'ar-EG',
        transitionId: 2,
      },
      { status: 'started', targetLocale: 'ar-EG', transitionId: 3 },
      {
        status: 'failed',
        reason: 'catalog-load-failed',
        targetLocale: 'ar-EG',
        transitionId: 3,
      },
    ]);
    localization.dispose();
  });
});
