import { describe, expect, it } from 'vitest';

import type { LocalizationCommitHook } from '../src/localization.js';

import { rejectionOf } from './catalog-store-harness.js';
import { runtime } from './transaction-runtime-harness.js';

// `apply` runs before a snapshot is current. A context destroyed there has nothing to publish to,
// so the change is one in flight when its context was destroyed, not a commit that stands.
describe('a context destroyed by a hook while a snapshot is applied', () => {
  it('ends a locale change as cancelled and holds no snapshot', async () => {
    let made: ReturnType<typeof runtime> | undefined;
    let armed = false;
    const told: string[] = [];
    const hook: LocalizationCommitHook = {
      apply: () => {
        if (armed) made?.localization.dispose();
      },
      committed: (snapshot) => {
        told.push(snapshot.primaryLocale);
      },
    };
    made = runtime({ options: { commitHooks: [hook] } });
    const { localization } = made;
    await localization.initialize();
    armed = true;

    const result = await localization.changeLocale('ar-EG');

    expect(result.status).toBe('cancelled');
    expect(localization.snapshot()).toBeUndefined();
    expect(localization.lifecycle()).toBe('failed');
    expect(told).toEqual(['en-US']);
  });

  it('ends an initialization with the disposed failure and holds no snapshot', async () => {
    let made: ReturnType<typeof runtime> | undefined;
    const told: string[] = [];
    const hook: LocalizationCommitHook = {
      apply: () => {
        made?.localization.dispose();
      },
      committed: (snapshot) => {
        told.push(snapshot.primaryLocale);
      },
    };
    made = runtime({ options: { commitHooks: [hook] } });
    const { localization } = made;

    const diagnostic = await rejectionOf(() => localization.initialize());

    expect(diagnostic).toMatchObject({ code: 'disposed' });
    expect(localization.snapshot()).toBeUndefined();
    expect(told).toEqual([]);
  });
});
