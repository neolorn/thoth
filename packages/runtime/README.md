# @neolorn/thoth

### Localization runtime for Angular applications (MessageFormat 2, CLDR, BCP 47)

[![npm version](https://img.shields.io/npm/v/@neolorn/thoth?style=flat-square)](https://www.npmjs.com/package/@neolorn/thoth)
[![license](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](https://github.com/neolorn/thoth/blob/main/LICENSE)

**@neolorn/thoth** is the runtime half of [Thoth](https://github.com/neolorn/thoth): locale resolution, message evaluation, formatting and parsing through `Intl`, and the Angular integration for routing, forms, and server rendering. It ships as ESM with seven entry points and no dependency beyond `tslib`.

Catalogs are compiled by [`@neolorn/thoth-toolkit`](https://www.npmjs.com/package/@neolorn/thoth-toolkit) into typed modules under `#i18n`, which this package's providers read.

## Features

- **Messages**
  - [MessageFormat 2](https://www.unicode.org/reports/tr35/tr35-78/tr35-messageFormat.html) syntax with plural, ordinal, and select variants, and rich content slots bound to Angular components.
  - Typed message handles, so a key that does not exist is a compile error and a message that takes an input cannot be rendered without one.
  - Fallback through the [CLDR parent locale](https://www.unicode.org/reports/tr35/tr35-78/tr35.html#Parent_Locales) chain, then the source locale.
  - A recovery message and an accessible recovery renderer for the case where no catalog can be loaded.
- **Locales**
  - Identifiers per [RFC 5646](https://www.rfc-editor.org/rfc/rfc5646), canonicalized from pinned CLDR alias data, identical across engines.
  - Negotiation per [RFC 4647](https://www.rfc-editor.org/rfc/rfc4647) lookup, extended with script matching and [CLDR language matching](https://www.unicode.org/reports/tr35/tr35-78/tr35.html#LanguageMatching) data.
  - Resolution from the URL, a persisted preference, `Accept-Language`, or a configured default, in a declared order.
  - Persistence through cookies, browser storage, or an authenticated profile.
- **Routing and rendering**
  - Localized URLs with the locale in a path prefix, in the domain, or kept out of the address, with canonical and `hreflang` metadata and sitemaps per [sitemaps.org](https://www.sitemaps.org/protocol.html), all derived from one route projection.
  - Server-side rendering, prerendering, and hydration with the first response in the visitor's locale.
  - Locale switching as a transaction: catalogs load first, then the document, the routes, focus, and scroll position move together.
  - A locale switcher directive that keeps the visitor on the current page, with `lang`, `dir`, `aria-current`, and `href` handled.
- **Formatting and parsing**
  - Numbers, currencies, percentages, units, dates, times, durations, relative times, and lists, formatted by the host's `Intl`. Pinned CLDR 48.2 data serves locale identity, parent locales, display names, and person-name patterns.
  - Canonical value types for decimals, money, dates, times, zoned date-times, measurements, and durations.
  - Locale-aware parsing of user input, and an Angular Forms integration.
- **Safety**
  - Translated content is treated as data: it cannot introduce markup, scripts, or navigation targets.
  - Bidirectional text handling per [UAX #9](https://www.unicode.org/reports/tr9/), with isolation of interpolated values.
  - Resource ceilings on catalog size and evaluation depth, enforced at runtime.

## Requirements

The Angular, RxJS, and Node.js ranges an install accepts are on [Compatibility](https://github.com/neolorn/thoth/blob/main/docs/reference/compatibility.md).

## Install

```sh run
npx ng add @neolorn/thoth-toolkit
```

`ng add` installs this package, which is what the application ships, and `@neolorn/thoth-toolkit` as a development dependency, because it runs at build time and ships in nothing.

## Quick start

`ng add` sets the project up, which the [tutorial](https://github.com/neolorn/thoth/blob/main/docs/tutorial.md) covers. From then on `ng build`, `ng serve` and `ng test` generate a `provideLocalization` for the project, with the locale set already bound, before Angular runs, and `ng serve` generates it again whenever catalogs, routes or providers change.

`ng add` declares where the locale sits in a URL, and which messages the recovery screen shows, in `thoth.config.json`. `path-prefix` puts the locale in the first path segment, spelled as the tag in lowercase:

```json excerpt thoth.config.json
{
  "urlPolicy": "path-prefix",
  "recoveryMessage": "shell/recovery-message",
  "recoveryRetry": "shell/recovery-retry"
}
```

It composes the providers in `src/app/app.config.ts`. `provideLocalizedRouter`, from `@neolorn/thoth/router`, replaces `provideRouter`, and each `with*` selects a feature. `withRouting()` reads the policy and the generated route table from the setup, so it takes no arguments. `withPersistence` below is one you add, to keep a visitor's choice in a cookie:

```ts excerpt src/app/app.config.ts
import { provideLocalization } from '#i18n';
import { cookieStore, withPersistence, withRouting } from '@neolorn/thoth';
import { provideLocalizedRouter } from '@neolorn/thoth/router';
import { routes } from './app.routes';
```

```ts excerpt src/app/app.config.ts
export const localizationFeatures = [withRouting()] as const;

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideLocalizedRouter(routes),
    provideLocalization(
      ...localizationFeatures,
      withPersistence(cookieStore()),
    ),
  ],
};
```

The recovery message is what a visitor reads if the catalogs cannot load, and `generate` refuses an application without one. Write `recovery-message` and `recovery-retry` beside `app-title` in each locale's catalog, under the names `thoth.config.json` gives them.

Render a message with `LocalizePipe`, and a switcher option with the `LocaleChoice` directive, both imported by the component:

```ts excerpt src/app/app.ts
import { injectLocalization, LocaleChoice, LocalizePipe } from '@neolorn/thoth';
import { messages } from '#i18n/shell';
```

```ts excerpt src/app/app.ts
    <h1>{{ messages.appTitle | localize }}</h1>
```

Render one switcher option for each configured locale:

```ts excerpt src/app/app.ts
    <nav>
      @for (choice of localization.localeChoices(); track choice.locale) {
        <a [localeChoice]="choice">{{ choice.selfName }}</a>
      }
    </nav>
```

Read the facade from a component to render or switch from code:

```ts excerpt src/app/app.ts
  protected readonly localization = injectLocalization();
```

The [tutorial](https://github.com/neolorn/thoth/blob/main/docs/tutorial.md) builds the application these lines come from, and every code block in the documentation is executed against the built packages by the verification suite before each release.

## Documentation

- [Tutorial](https://github.com/neolorn/thoth/blob/main/docs/tutorial.md): a two-locale application from `ng new` to a localized route.
- [How-to guides](https://github.com/neolorn/thoth/blob/main/docs/README.md#how-to-guides): step-by-step instructions for specific tasks.
- [Reference](https://github.com/neolorn/thoth/blob/main/docs/README.md#reference): entry points, features, configuration, and diagnostics, generated from the packages.
- [Explanation](https://github.com/neolorn/thoth/blob/main/docs/README.md#explanation): how locale resolution, compilation, routing, and the trust model work.
- [Thoth](https://github.com/neolorn/thoth): the repository, the specifications, and how to contribute.

## License

[MIT](https://github.com/neolorn/thoth/blob/main/LICENSE).
