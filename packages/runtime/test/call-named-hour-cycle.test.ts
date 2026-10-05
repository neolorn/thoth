import { expect, it } from 'vitest';

import {
  formatPlainDateTime,
  formatPlainTime,
  plainDate,
  plainDateTime,
  plainTime,
} from '../src/formatting.js';

const EN = Object.freeze({ locale: 'en-US' });

it('keeps the hour cycle a plain-time call names when the context names none', () => {
  const result = formatPlainTime(plainTime(13, 5), EN, {
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  });
  expect(result.ok && result.value.text).toBe('13:05');
});

it('keeps the hour cycle a plain-date-time call names when the context names none', () => {
  const result = formatPlainDateTime(
    plainDateTime(plainDate(2024, 3, 14), plainTime(13, 5)),
    EN,
    { hour: 'numeric', minute: 'numeric', hourCycle: 'h23' },
  );
  expect(result.ok && result.value.text).toBe('13:05');
});
