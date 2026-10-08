import { describe, expect, it } from 'vitest';

import { LocalizationError } from '@neolorn/equator/core';

import { instant, zonedDateTime } from '../src/formatting.js';

/**
 * What `zonedDateTime` stores, and what it refuses.
 *
 * `specs/08-formatting-parsing-and-domain.spec.md` section 2 has every domain value normalized
 * where it is created. A zoned date-time is an instant, the zone it is read in and the calendar it
 * is counted in, and the calendar is asked of the platform together with the zone before the value
 * exists.
 */

// 2024-03-14T12:00:00Z
const NOON = instant('1710417600000000000');

function refusal(create: () => unknown): LocalizationError {
  let thrown: unknown;
  try {
    create();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(LocalizationError);
  return thrown as LocalizationError;
}

describe('a zoned date-time', () => {
  it('is counted in the ISO calendar where none is named', () => {
    expect(zonedDateTime(NOON, 'Asia/Tokyo')).toStrictEqual({
      kind: 'zoned-date-time',
      instant: NOON,
      timeZone: 'Asia/Tokyo',
      calendar: 'iso8601',
    });
  });

  it('keeps the calendar it names', () => {
    expect(zonedDateTime(NOON, 'Asia/Tokyo', 'hebrew')).toStrictEqual({
      kind: 'zoned-date-time',
      instant: NOON,
      timeZone: 'Asia/Tokyo',
      calendar: 'hebrew',
    });
  });

  it('is refused with what the platform said where its calendar is not a calendar name', () => {
    const failure = refusal(() => zonedDateTime(NOON, 'Asia/Tokyo', 'x'));

    expect(failure.diagnostic.code).toBe('invalid-message-input');
    expect(failure.diagnostic.outcome).toBe('operational-failure');
    expect(failure.diagnostic.reason).toBe('malformed-input');
    expect(failure.cause).toBeInstanceOf(RangeError);
  });
});
