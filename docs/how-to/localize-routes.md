# How to localize your routes

Give every page an address in every locale you serve, and make that address resolve back to the same
route. Your Angular routes are unchanged.

## Before you begin

You need a project that `ng add @neolorn/thoth-toolkit` has set up, which the [tutorial](../tutorial.md)
does.

## Declare a policy

`urlPolicy` in `thoth.config.json` states where the locale appears in a URL:

```json excerpt thoth.config.json
{
  "urlPolicy": "path-prefix"
}
```

`ng add` writes it when you answer `path-prefix`, as `thoth init --url-policy path-prefix` does.
`path-prefix` puts the locale in the first path segment, spelled as the locale tag in lowercase, so the home page is at `/en-us` and `/ar-eg`. A
locale added to `locales` later gets its prefix the same way.

`thoth generate` builds the policy from this key and the locale set, and writes it into the setup
the generated `provideLocalization()` closes over. Run it again after changing any key on this page.

## Compose routing

Select `withRouting` among the features `provideLocalization` receives:

```ts excerpt src/app/app.config.ts
export const localizationFeatures = [withRouting()] as const;
```

It reads the policy and the route table `generate` wrote from the setup, so it takes no arguments
here. Without a `urlPolicy` it throws `invalid-configuration` and names the key.

Replace `provideRouter` with `provideLocalizedRouter`:

```ts excerpt src/app/app.config.ts
    provideLocalizedRouter(routes),
```

## Write links as routes

Write the route. The locale is resolved:

```ts excerpt src/app/app.routes.ts
    <a routerLink="second">{{ messages.openSecond | localize }}</a>
```

A link spelled `/ar-eg/second` stops being true the moment the visitor switches, and the Router
receives the address as written: the prefix is resolved away before anything matches, so the page
renders in whichever locale is committed rather than the one the link named.

## Choose a policy

`urlPolicy` takes one of three values:

| `urlPolicy`      | Puts the locale                   | Fits a deployment where                     |
| ---------------- | --------------------------------- | ------------------------------------------- |
| `path-prefix`    | In the first path segment         | one origin serves every locale              |
| `locale-host`    | In the origin                     | one host per language, one build per origin |
| `locale-neutral` | Only in a path spelled per locale | pages sit behind a sign-in, never indexed   |

`path-prefix` is the default choice. Each policy costs something different, and a host policy
changes what a locale switch is, which is
[About how routing derives addresses](../explanation/about-addresses.md).

## Change how a prefix is spelled

Under `path-prefix`, three keys change the prefixes, and each is refused under the other policies:

```text
{
  "urlPolicy": "path-prefix",
  "localePrefixes": { "ar-EG": "ar" },
  "prefixAliases": { "arabic": "ar-EG" },
  "omitDefaultPrefix": true
}
```

- `localePrefixes` gives a locale a segment other than its tag in lowercase. Name only the locales
  that differ.
- `prefixAliases` adds a segment that reaches a locale and is corrected to that locale's own prefix.
- `omitDefaultPrefix` serves the default locale at the root, without a prefix.

The `init` flags are `--locale-prefix ar-EG=ar`, `--prefix-alias arabic=ar-EG` and
`--omit-default-prefix true`. A prefix or an alias is one to 63 lowercase ASCII letters, digits and
hyphens, beginning and ending with a letter or a digit.

## Give each locale an origin

Under `locale-host`, `localeOrigins` names the origin of every locale, scheme included:

```text
{
  "urlPolicy": "locale-host",
  "localeOrigins": {
    "en-US": "https://example.com",
    "ar-EG": "https://example.eg"
  }
}
```

Every locale in `locales` needs one, each origin is written normalized, and no two locales share
one. The `init` flag is `--locale-origin en-US=https://example.com`, repeated per locale. A build
answers at one of these origins, which is
[How to render on the server](render-on-the-server.md#serve-a-domain-per-locale).

## Keep a section out of the locale prefix

`localeNeutralRoots` lists first path segments that keep one address in every locale. Use it for a
sign-in callback, a webhook receiver, or anything a third party has already recorded the address of:

```text
"localeNeutralRoots": ["api", "auth"]
```

Every policy takes it. The `init` flag is `--locale-neutral-root`, repeated per segment.

## Point `x-default` somewhere

`xDefault` is where the `x-default` alternate points, for a visitor whose language you do not serve.
It is a path beginning with one slash, such as `"/choose-language"`, and under `locale-host` an
origin, such as `"https://example.com"`. The `init` flag is `--x-default`. Without it, no
`x-default` is published.

`generate` reports `TH1009` for a declaration that does not fit the locales: a key naming a locale
`locales` does not list, a locale with no origin under `locale-host`, two locales at one origin, one
segment claimed twice across the prefixes, the aliases and the roots, or an `xDefault` of the wrong
form.

## Pass what the configuration cannot hold

Localized paths, parameter codecs and retired addresses are content rather than policy. Pass them as
`projection`:

```text
withRouting({
  projection: {
    localizedPaths: { 'route:second': { 'ar-EG': 'الثانية' } },
  },
}),
```

`localizedPaths` is keyed by route identity and then locale, and a route it does not name is spelled
the same in every locale. `parameters` holds the codec for each parameter of a route, and
`historical` states what became of an address that no longer exists. The generated route table is
not part of it, because the setup carries it. Under server rendering, pass the same `projection` to
`provideLocalizedServerRendering`.

## Build a policy in code

A policy built in code replaces the declared one, for an application whose policy the configuration
cannot express. Build it with a creator from `@neolorn/thoth` and pass it as `policy`:

```text
withRouting({
  policy: createPathPrefixLocalePolicy({
    defaultLocale: 'en-US',
    locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg' },
  }),
}),
```

| Creator                           | Builds                                                   |
| --------------------------------- | -------------------------------------------------------- |
| `createPathPrefixLocalePolicy`    | A `path-prefix` policy                                   |
| `createDefaultLocalePrefixPolicy` | A `path-prefix` policy with `omitDefaultPrefix` set true |
| `createHostLocalePolicy`          | A `locale-host` policy                                   |
| `createLocaleNeutralPolicy`       | A `locale-neutral` policy                                |

Pass the same policy to `provideLocalizedServerRendering` under server rendering. Where
`thoth.config.json` also declares one, the two have to agree: `generate` compares them and reports
`TH1408` for a difference in kind, in whether the default locale is prefixed, or in the segments
either claims.

Write the creator's options as literals, as above. `generate` compares the policy with
`thoth.config.json` and with your route paths only where it reads an option from the call itself,
and reports `TH1417` naming each option it did not read.

Build the policy with a creator. A policy object written out by hand is accepted only where it holds
what a creator writes for its kind, and is refused with `invalid-configuration` wherever it is read
otherwise.

## Name further scopes for a route

A navigation waits for the scopes the route's code uses, which `generate` derives from the route
tree, so most applications name none. To hold a navigation for a further scope, name it in the
second argument of `provideLocalizedRouter`:

```text
import { providerId, scopeId } from '#i18n/comments';

const comments = { providerId, scopeId } as const;

provideLocalizedRouter(routes, {
  requiredScopes: { 'route:articles._': [comments] },
});
```

A key is a `routeId`, the identity `generate` gave the route. A list in place of the record names
the scopes for every route.

To let a navigation complete before a scope arrives, name the scope in `progressiveScopes` and set
`mode` to `progressive`:

```text
provideLocalizedRouter(routes, {
  mode: 'progressive',
  progressiveScopes: { 'route:articles._': [comments] },
});
```

The page renders without the scope, and `scopeReadiness(comments)` on `Localization` reports
`loading`, then `ready` or `failed`. What the region shows until then is yours to write. Under
`coordinated`, which is the mode where you name none, and in a server render, a prerender and the
first render in a browser under either mode, a progressive scope is loaded before the page renders,
as a required one is. A `mode` that is neither word fails with `invalid-configuration` where the
option is given. Why a change waits at all is
[About how a locale switch is a transaction](../explanation/about-locale-switching.md).

## Serve a prefixed address from a static host

Under a path policy the first segment of every address is a locale, so a host that serves files by
path has no file at `/ar-eg` and answers 404. Point the host's fallback at `index.html`, the same
setting any router-driven Angular application needs, and the application reads the locale out of the
address it was opened at. `ng serve` does this already, so the first place the setting is missing is
usually a deployment of the build.

A server-rendered application answers the address itself and needs no fallback; [How to render on
the server](render-on-the-server.md) covers that path.

## Related

- [About how routing derives addresses](../explanation/about-addresses.md)
- [About how a locale is resolved](../explanation/about-locale-resolution.md)
- [How to tell crawlers your pages are translations](control-indexing.md)
- [How to render on the server](render-on-the-server.md)
- [Configuration](../reference/configuration.md)
