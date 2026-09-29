import { describe, expect, it } from 'vitest';

import { formatInstant, instant } from '../src/formatting.js';
import { type FormattingContext } from '@neolorn/equator/core';

import { claimCapability } from '../../../tools/capability-claims-in-tests.mjs';

/**
 * An application whose catalogs never format in the context's zone can start without naming one,
 * so the refusal of an instant with no zone at all is only observable here, below any application.
 */

const NO_ZONE: FormattingContext = Object.freeze({ locale: 'en-US' });

describe('an instant with no time zone', () => {
  it('is refused when neither the context nor the call names a zone', () => {
    expect(
      formatInstant(instant('0'), NO_ZONE, { year: 'numeric' }),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: 'unsupported-formatting-capability' },
    });
    claimCapability('format:formatInstant');
  });

  it('is formatted in the zone the call names', () => {
    const result = formatInstant(instant('0'), NO_ZONE, {
      year: 'numeric',
      timeZone: 'UTC',
    });

    expect(result.ok && result.value.text).toBe('1970');
  });
});
