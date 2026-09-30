// Drives the browser rows' call bound and their page teardown with objects of its own in place of a
// browser, and the occurrence record the verification suite reads back. A page whose close never
// settles is closed with its context and recorded; a context that does not close either fails.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  UnsettledCall,
  closePageWithItsContext,
  createCallBound,
} from './browser-call-bound.mjs';
import {
  OCCURRENCES_FILE_VARIABLE,
  collectOccurrences,
  ledgerOccurrences,
  recordOccurrence,
  verdictOccurrences,
} from './gate-occurrences.mjs';

const boundCalls = createCallBound({
  timeoutMs: 50,
  describe: () => ({ stage: 'self-test' }),
});
const never = () => new Promise(() => {});

class Page {
  constructor(closes) {
    this.closes = closes;
  }
  close() {
    return this.closes ? Promise.resolve() : never();
  }
  evaluate() {
    return Promise.resolve(1);
  }
}
class Context {
  closed = false;
  constructor(closes) {
    this.closes = closes;
  }
  close() {
    if (!this.closes) return never();
    this.closed = true;
    return Promise.resolve();
  }
}

// The bound reports a call that never settles as unsettled, and leaves one that does alone.
{
  const page = boundCalls(new Page(false), 'page');
  await assert.rejects(page.close(), (error) => {
    assert.ok(
      error instanceof UnsettledCall,
      'the bound did not report its own kind of error',
    );
    assert.match(error.message, /^page\.close did not settle within 50ms/u);
    return true;
  });
  assert.equal(await page.evaluate(), 1);
}

const runs = mkdtempSync(join(tmpdir(), 'equator-teardown-'));
try {
  const file = join(runs, 'row.occurrences.jsonl');
  const environment = { [OCCURRENCES_FILE_VARIABLE]: file };
  const record = (error) =>
    recordOccurrence(
      {
        kind: 'page-close-unsettled',
        signature:
          'firefox-localized-not-found: its context was closed in its place',
        detail: error.message.split('\n')[0],
      },
      environment,
    );

  // A page that closes: its context is closed after it, and nothing is recorded.
  {
    const context = boundCalls(new Context(true), 'context');
    const page = boundCalls(new Page(true), 'page');
    assert.equal(
      await closePageWithItsContext(page, context, record),
      undefined,
    );
    assert.equal(
      context.closed,
      true,
      'the page closed and its context was left open',
    );
    assert.deepEqual(
      collectOccurrences(['row'], () => file),
      [],
    );
  }

  // A page whose close never settles: the context is closed in its place, the row goes on, and
  // the occurrence reaches the file the suite reads.
  {
    const context = boundCalls(new Context(true), 'context');
    const page = boundCalls(new Page(false), 'page');
    const occurrence = await closePageWithItsContext(page, context, record);
    assert.equal(
      context.closed,
      true,
      'the unsettled page was not ended by closing its context',
    );
    assert.equal(occurrence?.kind, 'page-close-unsettled');
    const read = collectOccurrences(['row'], () => file);
    assert.equal(
      read.length,
      1,
      'the occurrence did not reach the file the suite reads',
    );
    assert.deepEqual(ledgerOccurrences(read), [
      {
        stage: 'row',
        kind: 'page-close-unsettled',
        signature:
          'firefox-localized-not-found: its context was closed in its place',
      },
    ]);
    assert.match(read[0].detail, /^page\.close did not settle within 50ms/u);
    assert.equal(verdictOccurrences(read), ', 1 occurrence(s) worked around');
  }

  // A context that does not close either: the row fails, naming both calls.
  {
    const context = boundCalls(new Context(false), 'context');
    const page = boundCalls(new Page(false), 'page');
    await assert.rejects(
      closePageWithItsContext(page, context, record),
      (error) => {
        assert.match(error.message, /page\.close did not settle within 50ms/u);
        assert.match(
          error.message,
          /context was closed in its place, and that did not settle either/u,
        );
        assert.match(
          error.message,
          /context\.close did not settle within 50ms/u,
        );
        return true;
      },
    );
  }

  // Any other failure of the close is the row's, and the context is left alone.
  {
    const context = boundCalls(new Context(true), 'context');
    const failing = {
      close: () =>
        Promise.reject(
          new Error('Target page, context or browser has been closed'),
        ),
    };
    await assert.rejects(
      closePageWithItsContext(failing, context, record),
      /has been closed/u,
    );
    assert.equal(
      context.closed,
      false,
      'a close that failed outright was treated as unsettled',
    );
  }

  assert.equal(verdictOccurrences([]), '');
} finally {
  rmSync(runs, { force: true, recursive: true });
}
console.log('browser teardown self-test: every path behaved as required');
