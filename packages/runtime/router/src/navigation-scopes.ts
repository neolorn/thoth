/**
 * Which of a route's scopes a navigation waits for, and which arrive beside it.
 *
 * `specs/06-runtime-and-angular.spec.md` section 9. Kept apart from the Router integration so the
 * rule is one function of the mode, the route's scopes and whether a view is already on screen,
 * which a test can call without a Router.
 */

import {
  LocalizationError,
  type LocaleChangeMode,
  type LocalizationScope,
} from '@neolorn/equator/core';

/**
 * Refuses a mode the Router integration is configured with that is neither declared value.
 *
 * Read as a value of no known type, because the declared type is the caller's claim and a
 * configuration written without type checking makes none. Refused where the configuration is
 * given: left to the first navigation, every navigation fails on it and nothing says why until a
 * page is opened.
 */
export function refuseUndeclaredMode(mode: unknown): void {
  if (mode === undefined || mode === 'coordinated' || mode === 'progressive') {
    return;
  }
  throw new LocalizationError({
    code: 'invalid-configuration',
    outcome: 'operational-failure',
    message:
      'The mode of the localized Router integration is coordinated or progressive.',
  });
}

/** What a navigation is deciding from. */
export interface NavigationScopeInput {
  /** The mode the integration was configured with. */
  readonly mode: LocaleChangeMode;
  /** Whether a navigation has landed, so a view is on screen for this one to replace. */
  readonly landed: boolean;
  /** The scopes the generated route table lists for the route. */
  readonly derived: readonly LocalizationScope[];
  /** The scopes the application named for the route as required. */
  readonly required: readonly LocalizationScope[];
  /** The scopes the application named for the route as progressive. */
  readonly progressive: readonly LocalizationScope[];
}

/** A route's scopes, split by whether the navigation waits for them. */
export interface NavigationScopes {
  /** Loaded before the navigation completes. */
  readonly held: readonly LocalizationScope[];
  /** Loaded while the navigation completes, and published when they arrive. */
  readonly alongside: readonly LocalizationScope[];
}

function mergeScopes(
  ...groups: readonly (readonly LocalizationScope[])[]
): readonly LocalizationScope[] {
  const merged = new Map<string, LocalizationScope>();
  for (const group of groups) {
    for (const scope of group) {
      merged.set(`${scope.providerId}\u0000${scope.scopeId}`, scope);
    }
  }
  return Object.freeze([...merged.values()]);
}

const NONE: readonly LocalizationScope[] = Object.freeze([]);

export function navigationScopes(
  input: NavigationScopeInput,
): NavigationScopes {
  // A scope named as progressive arrives beside a navigation because the page before it stays on
  // screen meanwhile. Before the first navigation has landed there is no such page: a server
  // render or a prerender would end without the scope, and the first render in a browser would
  // draw without it. A coordinated change commits once everything the view renders is ready, so
  // there the navigation waits for the scope as well. Section 9 of
  // `specs/06-runtime-and-angular.spec.md` requires both.
  const alongside = input.landed && input.mode === 'progressive';
  return Object.freeze({
    held: mergeScopes(
      input.derived,
      input.required,
      alongside ? NONE : input.progressive,
    ),
    alongside: alongside ? input.progressive : NONE,
  });
}
