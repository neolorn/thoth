/**
 * The consumer's exercise sheet, read and held to its authority, and the claims that follow.
 *
 * The sheet is `src/app/exercise-route.ts` in the consumer: every pipe and every formatting
 * function, each on a line of its own, writing the inputs in `src/app/exercise-inputs.json`. The
 * consumer stage reads it as the server answered it and as the build prerendered it; the browser
 * stage reads it as each engine adopted it and as a client navigation drew it. Both hold every line
 * to `exerciseAuthority`, run on the host that wrote the line, and claim what they held here, so
 * one list says which capability each line is evidence for.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { JSDOM } from 'jsdom';

import { recordCapabilityClaim } from './capability-evidence.mjs';

export { exerciseAuthority } from './exercise-authority.mjs';

/** The inputs the consumer's sheet writes. */
export async function readExerciseInputs(consumerRoot) {
  return JSON.parse(
    await readFile(
      resolve(consumerRoot, 'src/app/exercise-inputs.json'),
      'utf8',
    ),
  );
}

/**
 * The message the sheet localizes, as the translator wrote it in the consumer's catalog for the
 * locale. Read from the catalog line itself, which holds a plain or single-quoted scalar.
 */
export async function readCatalogMessage(consumerRoot, locale, key) {
  const catalog = await readFile(
    resolve(consumerRoot, 'i18n/shell', `${locale}.yaml`),
    'utf8',
  );
  const line = new RegExp(
    `^  ${key.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}: (.+)$`,
    'mu',
  ).exec(catalog);
  assert.ok(line, `The ${locale} catalog has no line for ${key}`);
  const written = line[1].trim();
  return written.startsWith("'")
    ? written.slice(1, -1).replaceAll("''", "'")
    : written;
}

/** What a page's sheet says: its locale, its policy, and each line by the capability it shows. */
export function sheetOf({ locale, sheet, policy, lines }) {
  return Object.freeze({
    locale,
    sheet,
    policy: JSON.parse(policy),
    // Angular keeps one space where the template breaks the line around an interpolation. A
    // direction mark the formatter writes is not white space, and survives.
    lines: new Map(lines.map(([id, text]) => [id, text.trim()])),
  });
}

/** The sheet in a document a server answered or a build wrote. */
export function sheetInDocument(html) {
  const { document } = new JSDOM(html).window;
  const section = document.querySelector('[data-route-view="exercise"]');
  assert.notEqual(section, null, 'The document shows no exercise sheet');
  return sheetOf({
    locale: section.getAttribute('data-exercise-locale'),
    sheet: section.getAttribute('data-exercise-sheet'),
    policy: section.getAttribute('data-url-policy'),
    lines: [...section.querySelectorAll('[data-exercise]')].map((line) => [
      line.getAttribute('data-exercise'),
      line.textContent,
    ]),
  });
}

/** One line of the sheet, held to what the host's own formatter wrote for it. */
function holds({ lines }, expected, id) {
  assert.ok(lines.has(id), `The exercise sheet has no ${id} line`);
  assert.equal(
    lines.get(id),
    expected[id],
    `The exercise sheet's ${id} line is not what the host writes for its input`,
  );
}

/**
 * Every pipe, held and claimed. A duration is claimed only where the host has a duration
 * formatter; elsewhere the line holds the empty text a pipe renders for the typed result.
 */
export function claimExercisedPipes(check, sheet, expected, context) {
  holds(sheet, expected, 'localize');
  recordCapabilityClaim(check, 'pipe:localize', context);
  holds(sheet, expected, 'localizedDecimal');
  recordCapabilityClaim(check, 'pipe:localizedDecimal', context);
  holds(sheet, expected, 'localizedMoney');
  recordCapabilityClaim(check, 'pipe:localizedMoney', context);
  holds(sheet, expected, 'localizedMeasurement');
  recordCapabilityClaim(check, 'pipe:localizedMeasurement', context);
  holds(sheet, expected, 'localizedPercent');
  recordCapabilityClaim(check, 'pipe:localizedPercent', context);
  holds(sheet, expected, 'localizedPercentagePoints');
  recordCapabilityClaim(check, 'pipe:localizedPercentagePoints', context);
  holds(sheet, expected, 'localizedInstant');
  recordCapabilityClaim(check, 'pipe:localizedInstant', context);
  holds(sheet, expected, 'localizedPlainDate');
  recordCapabilityClaim(check, 'pipe:localizedPlainDate', context);
  holds(sheet, expected, 'localizedPlainTime');
  recordCapabilityClaim(check, 'pipe:localizedPlainTime', context);
  holds(sheet, expected, 'localizedPlainDateTime');
  recordCapabilityClaim(check, 'pipe:localizedPlainDateTime', context);
  holds(sheet, expected, 'localizedZonedDateTime');
  recordCapabilityClaim(check, 'pipe:localizedZonedDateTime', context);
  holds(sheet, expected, 'localizedDuration');
  if (expected.localizedDuration !== '') {
    recordCapabilityClaim(check, 'pipe:localizedDuration', context);
  }
}

/**
 * A field kind's two lines: the text its value is written as, held to the host's, and what reading
 * that text back gives, which must be the value the field was given.
 */
function holdsField(sheet, expected, value, written, read) {
  holds(sheet, expected, written);
  assert.ok(sheet.lines.has(read), `The exercise sheet has no ${read} line`);
  assert.deepEqual(
    JSON.parse(sheet.lines.get(read)),
    value,
    `The exercise sheet's ${read} line is not the value its field was given`,
  );
}

/** Every field kind, held and claimed. */
export function claimExercisedControls(
  check,
  sheet,
  expected,
  controls,
  context,
) {
  const field = (kind) =>
    holdsField(
      sheet,
      expected,
      controls[kind].value,
      `formatLocalizedInput:${kind}`,
      `parseLocalizedInput:${kind}`,
    );
  field('decimal');
  recordCapabilityClaim(check, 'control:decimal', context);
  field('money');
  recordCapabilityClaim(check, 'control:money', context);
  field('measurement');
  recordCapabilityClaim(check, 'control:measurement', context);
  field('percent');
  recordCapabilityClaim(check, 'control:percent', context);
  field('percentage-points');
  recordCapabilityClaim(check, 'control:percentage-points', context);
  field('plain-date');
  recordCapabilityClaim(check, 'control:plain-date', context);
  field('plain-time');
  recordCapabilityClaim(check, 'control:plain-time', context);
  field('plain-date-time');
  recordCapabilityClaim(check, 'control:plain-date-time', context);
  field('time-zone');
  recordCapabilityClaim(check, 'control:time-zone', context);
  field('duration');
  recordCapabilityClaim(check, 'control:duration', context);
  field('instant');
  recordCapabilityClaim(check, 'control:instant', context);
}

/** Every formatting function, held and claimed, durations as above. */
export function claimExercisedFormats(check, sheet, expected, context) {
  holds(sheet, expected, 'formatNumber');
  recordCapabilityClaim(check, 'format:formatNumber', context);
  holds(sheet, expected, 'formatMoney');
  recordCapabilityClaim(check, 'format:formatMoney', context);
  holds(sheet, expected, 'formatMeasurement');
  recordCapabilityClaim(check, 'format:formatMeasurement', context);
  holds(sheet, expected, 'formatPercent');
  recordCapabilityClaim(check, 'format:formatPercent', context);
  holds(sheet, expected, 'formatPercentagePoints');
  recordCapabilityClaim(check, 'format:formatPercentagePoints', context);
  holds(sheet, expected, 'formatInstant');
  recordCapabilityClaim(check, 'format:formatInstant', context);
  holds(sheet, expected, 'formatPlainDate');
  recordCapabilityClaim(check, 'format:formatPlainDate', context);
  holds(sheet, expected, 'formatPlainTime');
  recordCapabilityClaim(check, 'format:formatPlainTime', context);
  holds(sheet, expected, 'formatPlainDateTime');
  recordCapabilityClaim(check, 'format:formatPlainDateTime', context);
  holds(sheet, expected, 'formatZonedDateTime');
  recordCapabilityClaim(check, 'format:formatZonedDateTime', context);
  holds(sheet, expected, 'formatNumberRange');
  recordCapabilityClaim(check, 'format:formatNumberRange', context);
  holds(sheet, expected, 'formatInstantRange');
  recordCapabilityClaim(check, 'format:formatInstantRange', context);
  holds(sheet, expected, 'formatList');
  recordCapabilityClaim(check, 'format:formatList', context);
  holds(sheet, expected, 'formatRelativeTime');
  recordCapabilityClaim(check, 'format:formatRelativeTime', context);
  holds(sheet, expected, 'resolveRelativeTime');
  recordCapabilityClaim(check, 'format:resolveRelativeTime', context);
  holds(sheet, expected, 'formatDisplayName');
  recordCapabilityClaim(check, 'format:formatDisplayName', context);
  holds(sheet, expected, 'selectPlural');
  recordCapabilityClaim(check, 'format:selectPlural', context);
  holds(sheet, expected, 'compareLocalized');
  recordCapabilityClaim(check, 'format:compareLocalized', context);
  holds(sheet, expected, 'segmentText');
  recordCapabilityClaim(check, 'format:segmentText', context);
  holds(sheet, expected, 'formatPersonName');
  recordCapabilityClaim(check, 'format:formatPersonName', context);
  holds(sheet, expected, 'formatLocalizedInput');
  recordCapabilityClaim(check, 'format:formatLocalizedInput', context);
  holds(sheet, expected, 'parseLocalizedInput');
  recordCapabilityClaim(check, 'format:parseLocalizedInput', context);
  holds(sheet, expected, 'formatDuration');
  if (expected.formatDuration !== 'unsupported-formatting-capability') {
    recordCapabilityClaim(check, 'format:formatDuration', context);
  }
}
