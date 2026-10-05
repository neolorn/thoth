/**
 * The surviving mutants nobody will write a test for, each with its reason.
 *
 * `stryker.config.mjs` runs on request and outside the gate. A mutant its suites execute and do not
 * notice is either a line no test can see fail, which is answered with a test, or a change no test
 * could notice, which is answered here: `tools/mutation-reasons.json` lists each of those by the
 * file, the mutator, the text it replaced and the replacement, under one of a closed set of
 * categories and with a sentence about that site.
 *
 * Without arguments this is the gate's half. It reads no report, so it cannot say a listed mutant
 * still survives; it says the entry still describes the source: the file exists, the text the
 * mutant replaced is still in it as often as the entry counts, the category is one the file
 * declares, and the reason is written. An entry whose text has gone is refused, so an edit to a
 * line with a recorded mutant has to look at the record.
 *
 * With `--report <stryker json>` it is the reading's half. Every survivor in the report must have
 * an entry. A survivor is a verdict only where every test planned for the mutant ran: a runner
 * that stops a mutant's tests at the first failure scores a run cut short with no failure recorded
 * as survived, with fewer tests completed than planned. Both configurations set `disableBail`, so
 * a report that carries such a mutant was not taken with them, and it is refused. An entry no
 * survivor matched is counted and printed, not refused, because a recorded mutant that timed out
 * in one run is still the same mutant.
 *
 * Usage: node tools/verify-mutation-reasons.mjs [--report <path>]
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { inputsRoot } from './stage-self-test.mjs';

const root = inputsRoot();
const RECORD = 'tools/mutation-reasons.json';
// A mutant that replaces a whole block is identified by the start of it; the rest is the block's
// body, which the entry would otherwise have to repeat in full.
export const ORIGINAL_LIMIT = 400;
const MINIMUM_REASON = 40;

const record = JSON.parse(readFileSync(resolve(root, RECORD), 'utf8'));
const failures = [];
const fail = (message) => failures.push(message);
const keyOf = ({ file, mutator, original, replacement }) =>
  JSON.stringify([file, mutator, original, replacement]);
const occurrences = (text, part) => text.split(part).length - 1;

const categories = new Map(Object.entries(record.categories ?? {}));
const used = new Set();
const entries = new Map();
const sources = new Map();
const sourceOf = (file) => {
  if (!sources.has(file)) {
    const path = resolve(root, file);
    sources.set(
      file,
      existsSync(path)
        ? readFileSync(path, 'utf8').replaceAll('\r\n', '\n')
        : undefined,
    );
  }
  return sources.get(file);
};

for (const [index, entry] of (record.survivors ?? []).entries()) {
  const where = `${RECORD} survivors[${index}] (${entry.file}, ${entry.mutator})`;
  for (const field of ['file', 'mutator', 'original', 'replacement']) {
    if (typeof entry[field] !== 'string') {
      fail(`${where}: ${field} is not written.`);
    }
  }
  if (!categories.has(entry.category)) {
    fail(
      `${where}: the category ${entry.category} is not one the file declares.`,
    );
  }
  used.add(entry.category);
  if (
    typeof entry.reason !== 'string' ||
    entry.reason.trim().length < MINIMUM_REASON
  ) {
    fail(`${where}: the reason is not written.`);
  }
  const count = entry.count ?? 1;
  if (!Number.isInteger(count) || count < 1) {
    fail(`${where}: the count is not a positive whole number.`);
  }
  if (
    typeof entry.original === 'string' &&
    entry.original.length > ORIGINAL_LIMIT
  ) {
    fail(
      `${where}: the replaced text is longer than ${ORIGINAL_LIMIT} characters.`,
    );
  }
  const key = keyOf(entry);
  if (entries.has(key)) fail(`${where}: the same mutant is listed twice.`);
  entries.set(key, { ...entry, count, where });
  if (typeof entry.file !== 'string' || typeof entry.original !== 'string')
    continue;
  const source = sourceOf(entry.file);
  if (source === undefined) {
    fail(`${where}: the file does not exist.`);
  } else if (occurrences(source, entry.original) < count) {
    fail(
      `${where}: the text the mutant replaced is in the file ${occurrences(source, entry.original)} time(s), the entry counts ${count}.`,
    );
  }
}
for (const id of categories.keys()) {
  if (!used.has(id)) fail(`${RECORD}: the category ${id} has no entry.`);
}

const reportIndex = process.argv.indexOf('--report');
let read = '';
if (reportIndex !== -1) {
  const report = JSON.parse(
    readFileSync(resolve(process.argv[reportIndex + 1]), 'utf8'),
  );
  const seen = new Map();
  let survivors = 0;
  let unsettled = 0;
  let unmatched = 0;
  for (const [file, { source, mutants }] of Object.entries(report.files)) {
    const lines = source.replaceAll('\r\n', '\n').split('\n');
    const starts = [0];
    for (const line of lines) starts.push(starts.at(-1) + line.length + 1);
    const offset = ({ line, column }) => starts[line - 1] + column - 1;
    const text = lines.join('\n');
    for (const mutant of mutants) {
      if (mutant.status !== 'Survived') continue;
      if ((mutant.testsCompleted ?? 0) < (mutant.coveredBy ?? []).length) {
        unsettled += 1;
        fail(
          `${file}:${mutant.location.start.line} ${mutant.mutatorName} is scored as survived with ${mutant.testsCompleted ?? 0} of ${(mutant.coveredBy ?? []).length} planned tests run, which is no verdict. Take the reading with disableBail.`,
        );
        continue;
      }
      survivors += 1;
      const key = keyOf({
        file,
        mutator: mutant.mutatorName,
        original: text
          .slice(offset(mutant.location.start), offset(mutant.location.end))
          .slice(0, ORIGINAL_LIMIT),
        replacement: mutant.replacement ?? '',
      });
      seen.set(key, (seen.get(key) ?? 0) + 1);
      const entry = entries.get(key);
      if (entry === undefined || seen.get(key) > entry.count) {
        fail(
          `${file}:${mutant.location.start.line} ${mutant.mutatorName} survived and has no reason: ${JSON.parse(key)[2].slice(0, 80)} => ${(mutant.replacement ?? '').slice(0, 60)}`,
        );
      }
    }
  }
  for (const [key, entry] of entries) {
    if ((seen.get(key) ?? 0) < entry.count) unmatched += 1;
  }
  read = `, ${survivors} survivor(s) in the report, ${unsettled} more with no verdict, ${unmatched} entr${unmatched === 1 ? 'y' : 'ies'} the report did not score as survived`;
}

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`${failure}\n`);
  process.stderr.write(
    `verify:mutation-reasons failed: ${failures.length} finding(s).\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `verify:mutation-reasons passed: ${entries.size} recorded mutant(s) in ${sources.size} file(s), ${categories.size} categories${read}.\n`,
  );
}
