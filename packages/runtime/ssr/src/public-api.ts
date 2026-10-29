// Server rendering, configured once, from the same projection the client was.
//
// A secondary entry point rather than part of `@neolorn/thoth`, because this is the only Thoth
// code that imports `@angular/ssr`, and `specs/02-packages-and-platform.spec.md` section 6 states
// that an optional integration must not put its peer on the primary entry point.
// `specs/02-packages-and-platform.spec.md` section 2 permits the entry point on exactly this
// condition, a capability carrying a distinct optional peer, so a browser-only consumer
// installs neither the peer nor this code.
//
// **Why the setup is an argument and not read from DI.** It cannot be. This is called in
// `app.config.server.ts` at module scope, where no injector exists, and
// `withRoutes(routes: ServerRoute[])` takes a concrete array at call time rather than a factory
// (`@angular/ssr` 22.2.1, `withRoutes`). Its own token is private: `SERVER_ROUTES_CONFIG` is
// a constant of that module and is not in the module's export list, so a factory-based
// install would mean naming a private API, which the fundamental rules forbid without approval.
// The client can do this because `ROUTES` is public and the Router reads it at injection time.
//
// The generated setup is the argument because it already carries the three things the table is
// built from: the URL policy the configuration declares, the generated route table, and the
// configuration. The client reads the same setup, so the two cannot be handed different copies.
// The localized spellings and codecs an application writes are the one part it passes, the same
// object it passes to `withRouting()`.
//
// The table this builds is `specs/07-routing-rendering-and-seo.spec.md` section 9: a prerendered
// route has no request, so every locale's copy is its own address that has to exist in the build,
// and the expansion is derived from the projection and the narrowed policy rather than declared
// once per locale.

import type { EnvironmentProviders } from '@angular/core';
import {
  provideServerRendering,
  withAppShell,
  withRoutes,
  type RenderMode,
  type ServerRenderingOptions,
} from '@angular/ssr';
import {
  LocalizationError,
  localizedServerRoutes,
  type GeneratedRouteProjection,
  type LocaleUrlPolicy,
  type LocalizationSetup,
  type LocalizedServerRouteDeclaration,
  type LocalizedServerRoutesOptions,
  type RoutingProjectionOptions,
} from '@neolorn/thoth';

/**
 * What `provideLocalizedServerRendering` accepts beyond the routes themselves.
 *
 * Carries the route-declaration options a localized server route set takes, plus the two things
 * Angular's server rendering leaves to an application. Every field is optional; the default is a
 * server that renders the declared routes and nothing else.
 */
export interface LocalizedServerRenderingOptions extends LocalizedServerRoutesOptions<RenderMode> {
  /**
   * The application shell, and the only Angular server-rendering feature a consumer can supply.
   *
   * Thoth owns `withRoutes`, so a second one cannot be passed and there is no variadic feature
   * list to admit one. The type is read off `withAppShell` rather than restated: `@angular/ssr`
   * exports no `ServerRenderingFeature` or `ServerRenderingFeatureKind`, and a hand-written copy
   * of a shape Angular does not publish would be Thoth asserting a contract it does not have.
   */
  readonly appShell?: Parameters<typeof withAppShell>[0];
  /** Passed through to `provideServerRendering` unchanged. Thoth reads nothing in it. */
  readonly rendering?: ServerRenderingOptions;
  /**
   * The URL policy, for an application that builds one in code and passes it to `withRouting()`.
   * Defaults to the one the setup carries.
   */
  readonly policy?: LocaleUrlPolicy;
  /** The localized spellings, parameter codecs and retired addresses passed to `withRouting()`. */
  readonly projection?: RoutingProjectionOptions;
}

/**
 * One server install: the localized route table, the canonical suppression, and the fallback.
 *
 * Replaces a consumer's `app.routes.server.ts` and the `provideServerRendering(withRoutes(...))`
 * line in `app.config.server.ts` with a single call that imports nothing from `@angular/ssr`
 * except the render modes the declarations name.
 */
export function provideLocalizedServerRendering<
  const Setup extends LocalizationSetup,
>(
  setup: Setup,
  declarations: readonly LocalizedServerRouteDeclaration<
    RenderMode,
    { readonly generated: NonNullable<Setup['routeProjection']> }
  >[],
  options: LocalizedServerRenderingOptions = {},
): EnvironmentProviders {
  const generated: GeneratedRouteProjection | undefined = setup.routeProjection;
  const policy = options.policy ?? setup.urlPolicy;
  if (generated === undefined || policy === undefined) {
    throw new LocalizationError({
      code: 'invalid-configuration',
      outcome: 'operational-failure',
      message:
        generated === undefined
          ? 'provideLocalizedServerRendering() was given a setup with no route projection. Regenerate this owner so that the setup carries one.'
          : 'provideLocalizedServerRendering() has no locale URL policy. Declare urlPolicy in thoth.config.json and regenerate, so that the setup carries one.',
    });
  }
  // A generated table passed beside the setup's is one built for another owner or a stale
  // generation, and the server table would then disagree with the client's.
  const given = options.projection?.generated;
  if (given !== undefined && given.identity !== generated.identity) {
    throw new LocalizationError({
      code: 'invalid-configuration',
      outcome: 'operational-failure',
      message: `provideLocalizedServerRendering() was given a route projection generated for something else. The setup carries ${JSON.stringify(generated.identity)} and the projection passed carries ${JSON.stringify(given.identity)}. Regenerate, or leave the generated table out of the projection.`,
    });
  }
  const routes = localizedServerRoutes(
    policy,
    { ...options.projection, generated: given ?? generated },
    setup.configuration,
    declarations,
    options,
  );
  const features = [
    withRoutes(routes),
    ...(options.appShell === undefined ? [] : [withAppShell(options.appShell)]),
  ];
  return options.rendering === undefined
    ? provideServerRendering(...features)
    : provideServerRendering(options.rendering, ...features);
}
