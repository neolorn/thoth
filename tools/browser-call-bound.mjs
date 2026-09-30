/**
 * The bound on every Playwright call a browser row makes, and the teardown that survives a page
 * the browser never finishes closing.
 *
 * Kept apart from the row so its self-test drives the same bound the rows run under, with objects
 * of its own in place of a browser.
 */

import assert from 'node:assert/strict';

/** A call that was still outstanding when its bound tripped. */
export class UnsettledCall extends Error {
  name = 'UnsettledCall';
}

// The argument itself is the name. A line number would name this file, which is not where the wait
// is, and a label per call site is a list that goes stale the first time one is added.
const describeArgument = (target) =>
  target === undefined
    ? ''
    : `: ${String(typeof target === 'function' ? target.toString() : target)
        .replace(/\s+/gu, ' ')
        .trim()
        .slice(0, 160)}`;

/**
 * `boundCalls(target, kind)` wraps every method of `target` so a call that returns a thenable
 * rejects with an `UnsettledCall` once `timeoutMs` passes, naming the method, its first argument
 * and what `describe()` says the row was doing.
 */
export function createCallBound({ timeoutMs, describe }) {
  // The walk has to actually reach the calls this exists for. Asserting it means a Playwright
  // release that moves them fails loudly here, rather than going quiet with a page whose close or
  // evaluate nothing bounds.
  const requireCoverage = (wrapped, kind) => {
    if (kind !== 'page') return;
    for (const required of ['close', 'evaluate']) {
      assert.ok(
        wrapped.has(required),
        `the call bound did not reach page.${required}, so nothing is bounding it`,
      );
    }
  };

  // What was wrapped, per object, rather than merely whether it was. A page usually arrives here
  // already wrapped: it comes back from `context.newPage()`, which is itself a bounded call, so the
  // resolve path below wraps it on the way out and the explicit call at the site is the second
  // one. Recording the names means that second call can still check coverage rather than
  // returning early, which would leave this guard unreachable.
  const boundNames = new WeakMap();

  const boundCalls = (target, kind) => {
    if (
      target === null ||
      (typeof target !== 'object' && typeof target !== 'function')
    ) {
      return target;
    }
    const already = boundNames.get(target);
    if (already !== undefined) {
      requireCoverage(already, kind);
      return target;
    }
    const wrapped = new Set();
    boundNames.set(target, wrapped);
    for (
      let level = Object.getPrototypeOf(target);
      level !== null && level !== Object.prototype;
      level = Object.getPrototypeOf(level)
    ) {
      for (const name of Object.getOwnPropertyNames(level)) {
        if (
          name === 'constructor' ||
          name.startsWith('_') ||
          wrapped.has(name)
        ) {
          continue;
        }
        const descriptor = Object.getOwnPropertyDescriptor(level, name);
        if (!descriptor || typeof descriptor.value !== 'function') continue;
        wrapped.add(name);
        const original = descriptor.value;
        Object.defineProperty(target, name, {
          configurable: true,
          enumerable: false,
          writable: true,
          value: function boundCall(...args) {
            const started = original.apply(this, args);
            // Synchronous returns (`page.locator(...)`, `page.url()`, `page.on(...)`) are not
            // waits and are handed back untouched.
            if (started === null || typeof started?.then !== 'function') {
              return started;
            }
            let timer;
            return Promise.race([
              started,
              new Promise((_resolve, reject) => {
                timer = setTimeout(() => {
                  reject(
                    new UnsettledCall(
                      `${kind}.${name} did not settle within ${timeoutMs}ms${describeArgument(args[0])}\n` +
                        `Playwright's own bound would have fired first had this call carried one, so this is a call it does not bound.\n` +
                        `What the row was doing: ${JSON.stringify(describe(), null, 2)}`,
                    ),
                  );
                }, timeoutMs);
              }),
            ]).then(
              (value) => {
                clearTimeout(timer);
                // A handle carries the same unbounded `evaluate` the page does.
                return typeof value?.evaluate === 'function'
                  ? boundCalls(value, 'handle')
                  : value;
              },
              (error) => {
                clearTimeout(timer);
                throw error;
              },
            );
          },
        });
      }
    }
    requireCoverage(wrapped, kind);
    return target;
  };
  return boundCalls;
}

/**
 * Close a page that has a browser context to itself, and then that context.
 *
 * Firefox under Playwright has been seen acknowledging a page's close and never reporting the page
 * detached, after every check on the page had passed, so the close never settles. That is the
 * driver's teardown failing rather than a verification, and closing the context disposes of the
 * page with it. `record` is handed the unsettled close and returns what it recorded; the result is
 * that record, or `undefined` when the page closed. A context that does not close either means the
 * browser is not answering, and that throws, naming both.
 *
 * Only for a page whose context holds nothing else: closing a context the row goes on using would
 * turn a teardown into a failure of whatever runs next.
 */
export async function closePageWithItsContext(page, context, record) {
  let occurrence;
  try {
    await page.close();
  } catch (error) {
    if (!(error instanceof UnsettledCall)) throw error;
    occurrence = record(error);
    try {
      await context.close();
    } catch (contextError) {
      throw new Error(
        `${error.message}\n\nThe page's own context was closed in its place, and that did not settle either:\n${contextError.message}`,
        { cause: contextError },
      );
    }
    return occurrence;
  }
  await context.close();
  return undefined;
}
