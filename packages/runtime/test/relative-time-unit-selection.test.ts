import { describe, expect, it } from 'vitest';

import { instant } from '../src/formatting.js';
import {
  selectRelativeTime,
  type RelativeTimeUnit,
} from '../src/relative-time-policy.js';

/**
 * Which unit an elapsed span is said in.
 *
 * `specs/08-formatting-parsing-and-domain.spec.md` section 5 leaves the thresholds to the
 * application and the selection to Equator: the largest unit the span reaches, truncated, signed
 * for the past. Each unit is asked at its own size and one millisecond short of it.
 */

const REFERENCE = 1_700_000_000_000;

const at = (milliseconds: number) =>
  instant(`${String(REFERENCE + milliseconds)}000000`);

const elapsed = (milliseconds: number) =>
  selectRelativeTime(at(milliseconds), at(0));

/** Each unit's size, and the unit a span one millisecond shorter is said in. */
const SIZES: readonly (readonly [
  RelativeTimeUnit,
  number,
  RelativeTimeUnit,
])[] = [
  ['year', 31_556_952_000, 'month'],
  ['month', 2_629_746_000, 'week'],
  ['week', 604_800_000, 'day'],
  ['day', 86_400_000, 'hour'],
  ['hour', 3_600_000, 'minute'],
  ['minute', 60_000, 'second'],
];

describe('the unit a span is said in', () => {
  it.each(SIZES)('is one %s at exactly its size', (unit, size) => {
    expect(elapsed(size)).toStrictEqual({ unit, value: 1 });
    expect(elapsed(-size)).toStrictEqual({ unit, value: -1 });
  });

  it.each(SIZES)('is not yet a %s one millisecond short', (_, size, below) => {
    expect(elapsed(size - 1).unit).toBe(below);
  });

  it('is seconds for anything shorter than a minute', () => {
    expect(elapsed(1_000)).toStrictEqual({ unit: 'second', value: 1 });
    expect(elapsed(-59_999)).toStrictEqual({ unit: 'second', value: -59 });
  });

  it('is zero of the smallest unit, without a sign, for a span shorter than it', () => {
    // Strict equality tells a negative zero from zero, which is the value a truncated past span
    // would otherwise carry.
    expect(elapsed(-999)).toStrictEqual({ unit: 'second', value: 0 });
    expect(elapsed(999)).toStrictEqual({ unit: 'second', value: 0 });
  });

  it('truncates toward the reference instant', () => {
    // 119 minutes is one hour, not two: rounding up would claim a thing is older than it is.
    expect(elapsed(-119 * 60_000)).toStrictEqual({ unit: 'hour', value: -1 });
  });
});

describe('the bounds an application sets', () => {
  it('reports a span past twice the largest unit as out of range', () => {
    const policy = { largestUnit: 'day' } as const;
    const twoDays = 2 * 86_400_000;

    expect(selectRelativeTime(at(twoDays - 1), at(0), policy)).toStrictEqual({
      unit: 'day',
      value: 1,
    });
    expect(selectRelativeTime(at(twoDays), at(0), policy)).toStrictEqual({
      elapsedMilliseconds: twoDays,
    });
  });

  it('never reports a span as out of range when the largest unit is the year', () => {
    const decade = 10 * 31_556_952_000;

    expect(elapsed(decade)).toStrictEqual({ unit: 'year', value: 10 });
  });

  it('says a span shorter than the smallest unit as zero of that unit', () => {
    expect(
      selectRelativeTime(at(-90_000), at(0), { smallestUnit: 'hour' }),
    ).toStrictEqual({ unit: 'hour', value: 0 });
  });

  it('stops being relative past the ceiling and not at it', () => {
    const policy = { absoluteAfterMilliseconds: 3_600_000 };

    expect(selectRelativeTime(at(-3_600_000), at(0), policy)).toStrictEqual({
      unit: 'hour',
      value: -1,
    });
    expect(selectRelativeTime(at(-3_600_001), at(0), policy)).toStrictEqual({
      elapsedMilliseconds: -3_600_001,
    });
  });
});
