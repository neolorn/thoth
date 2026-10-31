import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TestBed } from '@angular/core/testing';
import { RenderMode } from '@angular/ssr';
import {
  LOCALE_URL_POLICY,
  Localization,
  LocalizationError,
  withFormattingContext,
  withRouting,
  type LocalizationSetup,
  type RoutingOptions,
  type RoutingProjectionOptions,
} from '@neolorn/thoth';
import { provideLocalizedRouter } from '@neolorn/thoth/router';
import { provideLocalizedServerRendering } from '@neolorn/thoth/ssr';
import { provideLocalizationTesting } from '@neolorn/thoth/testing';
import { configuration } from '#i18n';
import { catalogLoaders } from '#i18n/catalog-loaders';
import { catalogSet } from '#i18n/catalog-set';
import { recoveryPayload } from '#i18n/recovery-payload';
import { routeProjection } from '#i18n/routes';

import { routes } from './app.routes';
import {
  appRouteProjection,
  routePolicy,
  SITE_ORIGIN,
} from './localization.routes';
import { runtimeExtensions } from './runtime-extensions';

/**
 * Routing composed from what the generated setup carries.
 *
 * Section 3 of `specs/07-routing-rendering-and-seo.spec.md`: the URL policy is declared in
 * `thoth.config.json` and generation writes it into the setup beside the route table, so
 * `withRouting()` is passed only what a declaration cannot hold, here this application's codecs and
 * translated paths, and the server rendering provider reads the same setup. A setup without a
 * policy is refused where routing is composed, with the configuration key to declare named.
 */

/** The origin the policy names, which differs between the policy variants this suite runs under. */
const ORIGIN = SITE_ORIGIN;

/**
 * What this application passes beside the setup: the codecs its parameterised routes need and its
 * translated paths, without the generated table, which the setup carries.
 */
const PARAMETERS = Object.fromEntries(
  Object.entries(appRouteProjection).filter(([key]) => key !== 'generated'),
) as RoutingProjectionOptions;

/** What a prefixing policy requires of a server table, as `app.routes.server.ts` declares it. */
const SERVER = {
  canonicalRenderMode: RenderMode.Server,
  fallback: RenderMode.Server,
  origin: ORIGIN,
} as const;

/** The setup generation writes for this owner, with the policy the configuration would declare. */
const setup = (
  urlPolicy: LocalizationSetup['urlPolicy'],
): LocalizationSetup => ({
  configuration,
  catalogSet,
  catalogLoaders,
  recoveryPayload,
  extensions: runtimeExtensions,
  routeProjection,
  ...(urlPolicy === undefined ? {} : { urlPolicy }),
});

/** Starts an application on the setup, and hands back the policy it serves or what it threw. */
async function started(
  composed: LocalizationSetup,
  options: RoutingOptions,
): Promise<{
  readonly served?: { readonly kind: string; readonly generated: string };
  readonly error?: unknown;
}> {
  TestBed.resetTestingModule();
  try {
    TestBed.configureTestingModule({
      providers: [
        provideLocalizedRouter(routes, { origin: ORIGIN }),
        provideLocalizationTesting(
          composed,
          withRouting(options),
          withFormattingContext({ timeZone: 'UTC' }),
        ),
      ],
    });
    const { policy, projection } = TestBed.inject(LOCALE_URL_POLICY);
    await TestBed.inject(Localization).initialize();
    return {
      served: { kind: policy.kind, generated: projection.generated.identity },
    };
  } catch (thrown: unknown) {
    return { error: thrown };
  } finally {
    TestBed.resetTestingModule();
  }
}

function expectRefusal(error: unknown, text: string): void {
  expect(error).toBeInstanceOf(LocalizationError);
  const { diagnostic } = error as LocalizationError;
  expect(diagnostic).toMatchObject({
    code: 'invalid-configuration',
    outcome: 'operational-failure',
  });
  expect(diagnostic.message).toContain(text);
}

describe('withRouting() on the setup', () => {
  it('serves the policy and the route table the setup carries', async () => {
    const { served, error } = await started(setup(routePolicy), {
      projection: PARAMETERS,
    });

    expect(error).toBeUndefined();
    expect(served).toEqual({
      kind: routePolicy.kind,
      generated: routeProjection.identity,
    });
  });

  it('is refused where the setup carries no policy, naming the key to declare', async () => {
    const { error } = await started(setup(undefined), {
      projection: PARAMETERS,
    });

    expectRefusal(error, 'Declare urlPolicy in thoth.config.json');
  });

  it('serves a policy passed in code where the setup carries none', async () => {
    const { served, error } = await started(setup(undefined), {
      policy: routePolicy,
      projection: PARAMETERS,
    });

    expect(error).toBeUndefined();
    expect(served?.kind).toBe(routePolicy.kind);
  });

  it('takes neither a policy nor a projection, where the setup and the routes need none', () => {
    expect(() => withRouting()).not.toThrow();
    expect(() => withRouting({})).not.toThrow();
  });

  it.each([
    [{ policy: 5 }, 'The policy of withRouting()'],
    [{ projection: 5 }, 'The projection of withRouting()'],
    [
      { projection: { ...PARAMETERS, generated: 5 } },
      'The generated half of the projection of withRouting()',
    ],
  ])(
    'refuses an option that is not an object where it is passed: %j',
    (options, name) => {
      expect(() => withRouting(options as unknown as RoutingOptions)).toThrow(
        `${name} must be an object`,
      );
    },
  );

  it('is refused where a generated table passed beside it is another one', async () => {
    const { error } = await started(setup(routePolicy), {
      projection: {
        ...PARAMETERS,
        generated: { ...routeProjection, identity: 'sha256:another' },
      },
    });

    expectRefusal(error, 'route projection generated for something else');
  });
});

describe('the server rendering provider on the setup', () => {
  // Angular's `provideServerRendering` declares the process a server by setting a global the first
  // time it is called, and spec files share one global, so each case puts it back as it found it.
  const globals = globalThis as { ngServerMode?: boolean | undefined };
  let declared = false;
  let value: boolean | undefined;

  beforeEach(() => {
    declared = 'ngServerMode' in globals;
    value = globals.ngServerMode;
  });

  afterEach(() => {
    if (declared) globals.ngServerMode = value;
    else delete globals.ngServerMode;
  });

  it('builds the table from the policy the setup carries', () => {
    expect(() =>
      provideLocalizedServerRendering(setup(routePolicy), [], {
        ...SERVER,
        projection: PARAMETERS,
      }),
    ).not.toThrow();
  });

  it('is refused where the setup carries no policy, naming the key to declare', () => {
    let error: unknown;
    try {
      provideLocalizedServerRendering(setup(undefined), [], {
        ...SERVER,
        projection: PARAMETERS,
      });
    } catch (thrown: unknown) {
      error = thrown;
    }

    expectRefusal(error, 'Declare urlPolicy in thoth.config.json');
  });

  it('is refused where a generated table passed beside it is another one', () => {
    let error: unknown;
    try {
      provideLocalizedServerRendering(setup(routePolicy), [], {
        ...SERVER,
        projection: {
          ...PARAMETERS,
          generated: { ...routeProjection, identity: 'sha256:another' },
        },
      });
    } catch (thrown: unknown) {
      error = thrown;
    }

    expectRefusal(error, 'route projection generated for something else');
  });
});
