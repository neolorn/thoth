import { describe, expect, it } from 'vitest';

import { compareCodePoint } from '../src/runtime-safety.js';

/**
 * The comparator every canonical table and canonical text is ordered by.
 *
 * ECMA-262 leaves the order of a sort implementation-defined where its comparator is not a
 * consistent one, so a comparator that answers 0 for a pair in the wrong order sorts the same on
 * one engine and not on the next. Its three answers are held here, away from any engine's sort.
 */
describe('the key order comparator', () => {
  it('answers below, above and equal', () => {
    expect(compareCodePoint('a', 'b')).toBe(-1);
    expect(compareCodePoint('b', 'a')).toBe(1);
    expect(compareCodePoint('a', 'a')).toBe(0);
  });

  it('is antisymmetric over keys that share a prefix or differ in case', () => {
    const keys = ['', 'a', 'A', 'aa', 'ab', 'b', '0', '-'];
    for (const left of keys) {
      for (const right of keys) {
        expect(compareCodePoint(left, right)).toBe(
          0 - compareCodePoint(right, left),
        );
      }
    }
  });
});
