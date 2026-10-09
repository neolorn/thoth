import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  compareLocalized,
  decimal,
  duration,
  formatDisplayName,
  formatDuration,
  formatInstantRange,
  formatList,
  formatNumberRange,
  formatPersonName,
  formatPlainDate,
  formatPlainDateTime,
  formatPlainTime,
  formatRelativeTime,
  formatZonedDateTime,
  instant,
  localeMetadata,
  personName,
  plainDate,
  plainDateTime,
  plainTime,
  segmentText,
  selectPlural,
  zonedDateTime,
} from '../src/formatting.js';
import { type FormattingContext } from '@neolorn/equator/core';

import { runtime, type Runtime } from './transaction-runtime-harness.js';

/**
 * The formatting and locale-capability calls of a localization context.
 *
 * A context formats in the locale it has committed and under the formatting defaults it was given,
 * so a call on it takes a value and options and no locale. Each call here is held to the answer of
 * the standalone function handed that same locale and those same defaults. The context is in
 * Arabic and the defaults name a zone, so an answer in the default locale or in no zone is a
 * different text.
 */

const COMMITTED: FormattingContext = Object.freeze({
  locale: 'ar-EG',
  timeZone: 'UTC',
});

const DATE = plainDate(2024, 3, 14);
const TIME = plainTime(13, 5, 9, 0);
const START = instant('0');
const END = instant('90000000000000');
const DATE_TIME: Intl.DateTimeFormatOptions = Object.freeze({
  dateStyle: 'medium',
  timeStyle: 'short',
});

describe('a call on a localization context', () => {
  let localization: Runtime;

  beforeAll(async () => {
    ({ localization } = runtime({
      options: {
        initialLocale: 'ar-EG',
        formattingContext: { timeZone: 'UTC' },
      },
    }));
    await localization.initialize();
  });

  afterAll(() => {
    localization.dispose();
  });

  it('formats in a locale whose answers differ from the default locale’s', () => {
    expect(formatPlainDate(DATE, COMMITTED)).not.toStrictEqual(
      formatPlainDate(DATE, { locale: 'en-US', timeZone: 'UTC' }),
    );
  });

  it('formats a plain date, with the default fields and with the ones it is handed', () => {
    const options = { month: 'long' } as const;

    expect(localization.formatPlainDate(DATE)).toStrictEqual(
      formatPlainDate(DATE, COMMITTED),
    );
    expect(localization.formatPlainDate(DATE, options)).toStrictEqual(
      formatPlainDate(DATE, COMMITTED, options),
    );
    expect(localization.formatPlainDate(DATE, options)).not.toStrictEqual(
      localization.formatPlainDate(DATE),
    );
  });

  it('formats a plain time, with the default fields and with the ones it is handed', () => {
    const options = { hour: 'numeric' } as const;

    expect(localization.formatPlainTime(TIME)).toStrictEqual(
      formatPlainTime(TIME, COMMITTED),
    );
    expect(localization.formatPlainTime(TIME, options)).toStrictEqual(
      formatPlainTime(TIME, COMMITTED, options),
    );
    expect(localization.formatPlainTime(TIME, options)).not.toStrictEqual(
      localization.formatPlainTime(TIME),
    );
  });

  it('formats a plain date-time, with the default fields and with the ones it is handed', () => {
    const value = plainDateTime(DATE, TIME);

    expect(localization.formatPlainDateTime(value)).toStrictEqual(
      formatPlainDateTime(value, COMMITTED),
    );
    expect(localization.formatPlainDateTime(value, DATE_TIME)).toStrictEqual(
      formatPlainDateTime(value, COMMITTED, DATE_TIME),
    );
    expect(
      localization.formatPlainDateTime(value, DATE_TIME),
    ).not.toStrictEqual(localization.formatPlainDateTime(value));
  });

  it('formats a zoned date-time', () => {
    const value = zonedDateTime(START, 'Asia/Tokyo');

    expect(localization.formatZonedDateTime(value, DATE_TIME)).toStrictEqual(
      formatZonedDateTime(value, COMMITTED, DATE_TIME),
    );
    expect(localization.formatZonedDateTime(value, DATE_TIME).ok).toBe(true);
  });

  it('formats a range of numbers, with no options and with the ones it is handed', () => {
    const options = { minimumFractionDigits: 2 } as const;

    expect(
      localization.formatNumberRange(decimal('1'), decimal('2')),
    ).toStrictEqual(formatNumberRange(decimal('1'), decimal('2'), COMMITTED));
    expect(
      localization.formatNumberRange(decimal('1'), decimal('2'), options),
    ).toStrictEqual(
      formatNumberRange(decimal('1'), decimal('2'), COMMITTED, options),
    );
    expect(
      localization.formatNumberRange(decimal('1'), decimal('2'), options),
    ).not.toStrictEqual(
      localization.formatNumberRange(decimal('1'), decimal('2')),
    );
  });

  it('formats a range of instants in the zone its defaults name', () => {
    const result = localization.formatInstantRange(START, END, DATE_TIME);

    expect(result).toStrictEqual(
      formatInstantRange(START, END, COMMITTED, DATE_TIME),
    );
    expect(result.ok).toBe(true);
    // With no zone there is no wall clock to read an instant against, and the call is refused.
    expect(
      formatInstantRange(START, END, { locale: 'ar-EG' }, DATE_TIME).ok,
    ).toBe(false);
  });

  it('formats a duration', () => {
    const value = duration({ hours: 2, minutes: 5 });

    expect(localization.formatDuration(value)).toStrictEqual(
      formatDuration(value, COMMITTED),
    );
    expect(localization.formatDuration(value, { style: 'long' })).toStrictEqual(
      formatDuration(value, COMMITTED, { style: 'long' }),
    );
    expect(localization.formatDuration(value).ok).toBe(true);
  });

  it('formats a list', () => {
    const values = ['أ', 'ب', 'ج'];

    expect(localization.formatList(values)).toStrictEqual(
      formatList(values, COMMITTED),
    );
    expect(
      localization.formatList(values, { type: 'disjunction' }),
    ).toStrictEqual(formatList(values, COMMITTED, { type: 'disjunction' }));
    expect(localization.formatList(values).ok).toBe(true);
  });

  it('formats an offset in a unit', () => {
    expect(localization.formatRelativeTime(decimal('-3'), 'day')).toStrictEqual(
      formatRelativeTime(decimal('-3'), 'day', COMMITTED),
    );
    expect(
      localization.formatRelativeTime(decimal('-1'), 'day', {
        numeric: 'auto',
      }),
    ).toStrictEqual(
      formatRelativeTime(decimal('-1'), 'day', COMMITTED, { numeric: 'auto' }),
    );
    expect(localization.formatRelativeTime(decimal('-3'), 'day').ok).toBe(true);
  });

  it('formats the name of a code', () => {
    const options = { type: 'region' } as const;

    expect(localization.formatDisplayName('JP', options)).toStrictEqual(
      formatDisplayName('JP', COMMITTED, options),
    );
    expect(localization.formatDisplayName('JP', options).ok).toBe(true);
  });

  it('formats a person name', () => {
    const value = personName('en', { given: 'Mary', surname: 'Hamish' });

    expect(localization.formatPersonName(value)).toStrictEqual(
      formatPersonName(value, COMMITTED),
    );
    expect(
      localization.formatPersonName(value, { order: 'sorting' }),
    ).toStrictEqual(formatPersonName(value, COMMITTED, { order: 'sorting' }));
    expect(localization.formatPersonName(value).ok).toBe(true);
  });

  it('selects a plural category by the committed locale’s rules', () => {
    // Arabic has a category for two, which English does not.
    expect(localization.selectPlural(decimal('2'))).toStrictEqual({
      ok: true,
      value: 'two',
    });
    expect(selectPlural(decimal('2'), { locale: 'en-US' })).toStrictEqual({
      ok: true,
      value: 'other',
    });
    expect(
      localization.selectPlural(decimal('2'), { type: 'ordinal' }),
    ).toStrictEqual(selectPlural(decimal('2'), COMMITTED, { type: 'ordinal' }));
    expect(
      localization.selectPlural(decimal('2'), { type: 'ordinal' }),
    ).not.toStrictEqual(localization.selectPlural(decimal('2')));
  });

  it('compares two strings, with no options and with the ones it is handed', () => {
    const options = { sensitivity: 'base' } as const;

    expect(localization.compare('a', 'b')).toStrictEqual({
      ok: true,
      value: -1,
    });
    expect(localization.compare('a', 'A')).toStrictEqual(
      compareLocalized('a', 'A', COMMITTED),
    );
    expect(localization.compare('a', 'A').ok).toBe(true);
    expect(localization.compare('a', 'A')).not.toStrictEqual({
      ok: true,
      value: 0,
    });
    expect(localization.compare('a', 'A', options)).toStrictEqual({
      ok: true,
      value: 0,
    });
  });

  it('segments text, by graphemes with no options and by the granularity it is handed', () => {
    const input = 'مرحبا بالعالم';
    const words = localization.segment(input, { granularity: 'word' });

    expect(localization.segment(input)).toStrictEqual(
      segmentText(input, COMMITTED),
    );
    expect(words).toStrictEqual(
      segmentText(input, COMMITTED, { granularity: 'word' }),
    );
    expect(words).toMatchObject({
      ok: true,
      value: [
        { segment: 'مرحبا', index: 0, wordLike: true },
        { segment: ' ', index: 5, wordLike: false },
        { segment: 'بالعالم', index: 6, wordLike: true },
      ],
    });
  });

  it('describes the committed locale', () => {
    expect(localization.localeMetadata()).toStrictEqual(
      localeMetadata('ar-EG'),
    );
    expect(localization.localeMetadata()).toMatchObject({
      ok: true,
      value: { locale: 'ar-EG', language: 'ar', direction: 'rtl' },
    });
  });
});
