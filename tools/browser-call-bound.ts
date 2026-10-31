/**
 * The bound on every Playwright call a browser row makes, and the teardown that survives a page
 * the browser never finishes closing, or a browser that stops answering its closes altogether or
 * refuses the close of that page's context.
 *
 * Kept apart from the row so its self-test drives the same bound the rows run under, with objects
 * of its own in place of a browser.
 */

import assert from 'node:assert/strict';

/** A call that was still outstanding when its bound tripped. */
export class UnsettledCall extends Error {
  override name = 'UnsettledCall';
}

/**
 * A browser that left the close of a page outstanding, and then left the close of that page's
 * context outstanding as well (`unsettled`) or refused it with a protocol error (`refused`).
 * `detail` is the first line of each close's message, the page's and then the context's.
 */
export class UnansweringBrowser extends Error {
  override name = 'UnansweringBrowser';
  declare readonly contextClose: 'unsettled' | 'refused';
  declare readonly detail: string;
  constructor(
    message: string,
    {
      cause,
      contextClose,
      detail,
    }: {
      readonly cause: unknown;
      readonly contextClose: 'unsettled' | 'refused';
      readonly detail: string;
    },
  ) {
    super(message, { cause });
    this.contextClose = contextClose;
    this.detail = detail;
  }
}

/**
 * Whether the browser refused a context's close with a protocol error.
 *
 * Playwright marks a protocol error on its server side only (`ProtocolError`), and what reaches the
 * client is a plain `Error` carrying the message, with the error's name `Error`, so nothing but the
 * text tells it. The form is the one the server writes, `Protocol error (<Domain>.<method>): `,
 * behind the prefix the client puts on the message of the call that failed, `browserContext.close: `.
 * Anchored at both, so an error that only mentions a protocol error, or one the client raised
 * itself (a closed target, a timeout), is not taken for it.
 */
export const isRefusedContextClose = (error: unknown): boolean =>
  error instanceof Error &&
  /^browserContext\.close: Protocol error \([A-Za-z]+\.[A-Za-z]+\): /u.test(
    error.message,
  );

export interface Closable {
  close(): Promise<unknown>;
}

export interface CallBoundOptions {
  readonly timeoutMs: number;
  readonly describe: () => unknown;
  readonly adopt?: (target: object) => void;
  readonly annotate?: (target: unknown) => string;
}

// The argument itself is the name. A line number would name this file, which is not where the wait
// is, and a label per call site is a list that goes stale the first time one is added.
const describeArgument = (target: unknown) =>
  target === undefined
    ? ''
    : `: ${String(typeof target === 'function' ? target.toString() : target)
        .replace(/\s+/gu, ' ')
        .trim()
        .slice(0, 160)}`;

/**
 * `boundCalls(target, kind)` wraps every method of `target` so a call that returns a thenable
 * rejects with an `UnsettledCall` once `timeoutMs` passes, naming the method, its first argument
 * and what `describe()` says the row was doing. `adopt(target)` is handed each object once, before
 * its methods are wrapped, and `annotate(target)` supplies what a failed call's message ends with,
 * so a wait that fails can say what its page was still waiting for.
 */
export function createCallBound({
  timeoutMs,
  describe,
  adopt = () => {},
  annotate = () => '',
}: CallBoundOptions) {
  // The walk has to actually reach the calls this exists for. Asserting it means a Playwright
  // release that moves them fails loudly here, rather than going quiet with a page whose close or
  // evaluate nothing bounds.
  const requireCoverage = (wrapped: ReadonlySet<string>, kind: string) => {
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
  const boundNames = new WeakMap<object, Set<string>>();

  const boundCalls = <Target>(target: Target, kind: string): Target => {
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
    const wrapped = new Set<string>();
    boundNames.set(target, wrapped);
    adopt(target);
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
        const original = descriptor.value as (
          this: unknown,
          ...args: unknown[]
        ) => unknown;
        Object.defineProperty(target, name, {
          configurable: true,
          enumerable: false,
          writable: true,
          value: function boundCall(this: unknown, ...args: unknown[]) {
            const started = original.apply(this, args);
            // Synchronous returns (`page.locator(...)`, `page.url()`, `page.on(...)`) are not
            // waits and are handed back untouched.
            if (
              started === null ||
              typeof (started as { readonly then?: unknown } | undefined)
                ?.then !== 'function'
            ) {
              return started;
            }
            let timer: ReturnType<typeof setTimeout> | undefined;
            return Promise.race([
              started as PromiseLike<unknown>,
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
                return typeof (
                  value as { readonly evaluate?: unknown } | null | undefined
                )?.evaluate === 'function'
                  ? boundCalls(value, 'handle')
                  : value;
              },
              (error: unknown) => {
                clearTimeout(timer);
                if (error instanceof Error) error.message += annotate(this);
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
 * page with it. `record` is handed the unsettled close once the context has closed and returns what
 * it recorded; the result is that record, or `undefined` when the page closed. A context whose
 * close does not settle either, or that the browser refuses to close with a protocol error, means
 * the browser is not answering, and that throws an `UnansweringBrowser` naming both closes, with
 * nothing recorded: what the caller does about the browser is the occurrence. Firefox has been seen
 * refusing it from its own session store, after every check on the page had passed. A context that
 * fails to close in any other way, and any failure of a context's close after its page closed, is
 * the row's failure.
 *
 * Only for a page whose context holds nothing else: closing a context the row goes on using would
 * turn a teardown into a failure of whatever runs next.
 */
export async function closePageWithItsContext<Recorded>(
  page: Closable,
  context: Closable,
  record: (close: UnsettledCall) => Recorded,
): Promise<Recorded | undefined> {
  try {
    await page.close();
  } catch (error) {
    if (!(error instanceof UnsettledCall)) throw error;
    try {
      await context.close();
    } catch (contextError) {
      const contextMessage = (contextError as Error).message;
      const detail = `${error.message.split('\n')[0]}\n${contextMessage.split('\n')[0]}`;
      if (contextError instanceof UnsettledCall) {
        throw new UnansweringBrowser(
          `${error.message}\n\nThe page's own context was closed in its place, and that did not settle either:\n${contextMessage}`,
          { cause: contextError, contextClose: 'unsettled', detail },
        );
      }
      if (isRefusedContextClose(contextError)) {
        throw new UnansweringBrowser(
          `${error.message}\n\nThe page's own context was closed in its place, and the browser refused that with a protocol error:\n${contextMessage}`,
          { cause: contextError, contextClose: 'refused', detail },
        );
      }
      throw new Error(
        `${error.message}\n\nThe page's own context was closed in its place, and that failed:\n${contextMessage}`,
        { cause: contextError },
      );
    }
    return record(error);
  }
  await context.close();
  return undefined;
}

/**
 * Run a step of a row that ends by closing a page and a context of its own.
 *
 * The close is the step's last act, so an `UnansweringBrowser` out of it means every check of the
 * step passed and only the browser's teardown is outstanding. `replace` is handed that error and
 * puts a fresh browser in the stalled one's place, and the row goes on with the step after this
 * one. Anything else a step throws is the row's failure.
 */
export async function stepClosingItsOwnPages(
  step: () => Promise<unknown>,
  replace: (error: UnansweringBrowser) => unknown,
): Promise<void> {
  try {
    await step();
  } catch (error) {
    if (!(error instanceof UnansweringBrowser)) throw error;
    await replace(error);
  }
}

/**
 * How a replaced browser is named where occurrences are counted: the stage it stalled in, the bound
 * the page's close ran past, whether the context's close ran past it too or was refused, and whether
 * its process had to be ended.
 */
export const replacementSignature = ({
  stage,
  timeoutMs,
  processEnded,
  contextClose,
}: {
  readonly stage: string;
  readonly timeoutMs: number;
  readonly processEnded: boolean;
  readonly contextClose: UnansweringBrowser['contextClose'];
}) =>
  `${stage}: ${
    contextClose === 'refused'
      ? `page.close did not settle within ${timeoutMs}ms and the browser refused context.close with a protocol error`
      : `page.close and then context.close did not settle within ${timeoutMs}ms`
  }, so the browser was closed${
    processEnded
      ? ', which did not settle either, so its process was ended,'
      : ''
  } and a fresh one launched in its place`;

/**
 * End a browser that has stopped answering, and start another in its place.
 *
 * `browser.close()` runs under the same bound as every other call. Where it does not settle
 * either, `endProcess` ends the browser's process, which is all that is left: the browser is
 * already not answering the driver. `record` is handed whether that was needed and records the
 * occurrence, before the launch, so a launch that fails still leaves it. Resolves to what `launch`
 * resolves to. A close that fails in any other way is the row's failure, and nothing is launched.
 */
export async function replaceUnansweringBrowser<Launched>({
  browser,
  endProcess,
  record,
  launch,
}: {
  readonly browser: Closable;
  readonly endProcess: () => unknown;
  readonly record: (replacement: { readonly processEnded: boolean }) => unknown;
  readonly launch: () => Launched | PromiseLike<Launched>;
}): Promise<Launched> {
  let processEnded = false;
  try {
    await browser.close();
  } catch (error) {
    if (!(error instanceof UnsettledCall)) throw error;
    await endProcess();
    processEnded = true;
  }
  record({ processEnded });
  return launch();
}
