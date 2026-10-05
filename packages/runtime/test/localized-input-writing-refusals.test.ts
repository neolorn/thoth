import { describe, expect, it } from 'vitest';

import { plainDate, plainDateTime, plainTime } from '../src/formatting.js';
import { formatLocalizedInput } from '../src/localized-input.js';
import {
  type FormattingContext,
  type FormattingResult,
  type LocalizedInputProfile,
} from '@neolorn/equator/core';

/**
 * Writing a field answers with text or with a reported failure. A value read from storage or built
 * by other code can be anything, and so can the locale of a context, so each case here hands the
 * writer something its types rule out and reads the answer it gives instead of a throw.
 */

const EN: FormattingContext = Object.freeze({ locale: 'en-US' });
const NOT_A_LOCALE: FormattingContext = Object.freeze({ locale: 'not a tag' });

const REFUSED = { ok: false, diagnostic: { code: 'invalid-localized-input' } };

const DATE: LocalizedInputProfile = {
  kind: 'plain-date',
  order: 'year-month-day',
  separator: '-',
};
const TIME = { hourCycle: 'h23', precision: 'minute', separator: ':' } as const;
const DATE_TIME: LocalizedInputProfile = {
  kind: 'plain-date-time',
  date: { order: 'year-month-day', separator: '-' },
  time: TIME,
  separator: ' ',
};

// The value is typed as anything, which is what the writer is given by a caller outside the types.
const write = (
  value: unknown,
  profile: LocalizedInputProfile,
  context: FormattingContext = EN,
): FormattingResult => formatLocalizedInput(value as never, profile, context);

describe('a field written in a locale that is not a language tag', () => {
  it('reports a date instead of throwing', () => {
    expect(write(plainDate(2026, 3, 14), DATE, NOT_A_LOCALE)).toMatchObject(
      REFUSED,
    );
  });

  it('reports a date and time instead of throwing', () => {
    expect(
      write(
        plainDateTime(plainDate(2026, 3, 14), plainTime(9, 30)),
        DATE_TIME,
        NOT_A_LOCALE,
      ),
    ).toMatchObject(REFUSED);
  });

  it('writes the same values in a locale that is one', () => {
    expect(write(plainDate(2026, 3, 14), DATE)).toMatchObject({
      ok: true,
      value: { text: '2026-03-14' },
    });
    expect(
      write(plainDateTime(plainDate(2026, 3, 14), plainTime(9, 30)), DATE_TIME),
    ).toMatchObject({ ok: true, value: { text: '2026-03-14 09:30' } });
  });
});

describe('a value that is not of the shape its kind declares', () => {
  const amount = { kind: 'decimal', value: '5' };

  it.each<[string, unknown, LocalizedInputProfile]>([
    ['nothing at all', undefined, { kind: 'decimal' }],
    ['null', null, { kind: 'decimal' }],
    ['a text', '5', { kind: 'decimal' }],
    [
      'money with no amount',
      { kind: 'money', currency: 'USD' },
      { kind: 'money', currency: 'USD' },
    ],
    [
      'money whose amount is a text',
      { kind: 'money', currency: 'USD', amount: '5' },
      { kind: 'money', currency: 'USD' },
    ],
    [
      'a measurement with no amount',
      { kind: 'measurement', unit: 'day' },
      { kind: 'measurement', unit: 'day' },
    ],
    [
      'a percentage with no amount',
      { kind: 'percent', scale: 'percent-unit' },
      { kind: 'percent', scale: 'percent-unit' },
    ],
    [
      'a percentage whose amount is not a number',
      {
        kind: 'percent',
        scale: 'percent-unit',
        amount: { kind: 'decimal', value: 'abc' },
      },
      { kind: 'percent', scale: 'percent-unit' },
    ],
    [
      'percentage points with no amount',
      { kind: 'percentage-points' },
      { kind: 'percentage-points' },
    ],
    [
      'an instant with no count',
      { kind: 'instant' },
      { kind: 'instant', syntax: 'rfc3339' },
    ],
    [
      'an instant whose count is not a whole number',
      { kind: 'instant', epochNanoseconds: '1.5' },
      { kind: 'instant', syntax: 'rfc3339' },
    ],
    [
      'an instant whose count is not a number',
      { kind: 'instant', epochNanoseconds: 'abc' },
      { kind: 'instant', syntax: 'rfc3339' },
    ],
    [
      'a duration with no seconds',
      {
        kind: 'duration',
        sign: 1,
        years: 0,
        months: 1,
        weeks: 0,
        days: 0,
        hours: 0,
        minutes: 0,
      },
      { kind: 'duration', pattern: [{ field: 'months' }, 'mo'] },
    ],
  ])('is reported and not thrown: %s', (_, value, profile) => {
    expect(write(value, profile)).toMatchObject(REFUSED);
  });

  it('is told apart from a value of the declared shape', () => {
    expect(
      write(
        { kind: 'money', currency: 'USD', amount },
        { kind: 'money', currency: 'USD' },
      ),
    ).toMatchObject({ ok: true });
  });
});
