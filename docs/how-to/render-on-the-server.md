# How to render on the server

Resolve the locale before anything renders, so the first response is in the visitor's language and
hydration claims that HTML rather than rewriting it.

## Before you begin

`@neolorn/equator/ssr` is a separate entry point with `@angular/ssr` as an optional peer. A
browser-only application installs neither the peer nor this code.

## Compose the server providers

```text
providers: [provideLocalizedServerRendering()],
```

It goes in your server configuration, beside Angular's own server providers. It adds the per-request
work: negotiating the locale for the request, preparing the scopes that request needs, and making
the result available to the render.

The localization a request renders under is scoped to that request, so two concurrent renders never
share a committed locale. Catalogs are admitted once per process rather than once per request:
verifying a catalog does not depend on who asked for it.

## Know which locale the HTML was written in

`renderedLocale()` returns the locale the server-rendered document was written in, and the runtime
reads it to decide whether hydration claims that HTML or builds it fresh. What a locale mismatch does
to hydrated content is
[About how a locale switch is a transaction](../explanation/about-locale-switching.md).

## Prerender

Prerendering writes the pages ahead of time, one per address, which under a localized URL policy
means one per route per locale. The addresses come from the projection the head and the sitemap use,
so what is prerendered and what is advertised are one list.

A prerendered page has no request and therefore no negotiation. Its locale is the one its address
states, which is why a locale that appears nowhere in your addresses cannot be prerendered
separately.

A parameterised route says which pages to write through `prerender`. Write the values where the
table is, or give a function the build calls for them:

```text
{
  routeId: 'article',
  renderMode: RenderMode.Prerender,
  prerender: async () =>
    (await articles.published()).map((article) => ({ slug: article.id })),
}
```

Both forms are serialized per locale through the route's codecs, so one entry writes
`/en-us/articles/handbook` and `/ar-eg/articles/دليل`. The function is called once for
the route rather than once per locale, and a value with no spelling in some locale fails the build
rather than being left out of that language.

A prerendered page is one file that every visitor is given, so a route declared `per-visitor` or
`not-stored`, or indexed as `private`, fails the build that renders it, with the route and its
address named. That holds whether the route has an entry of its own or the build reaches it through
a fallback or an application shell. Render such a route with `RenderMode.Server`. A
[floor](control-caching.md#declare-a-floor-for-every-page) in the handler's cache options is not
known to the build, so only what the routes declare is checked.

## Serve a domain per locale

Under a policy that puts the locale in the origin, the build has to be told which origin it is. Pass
the same value to `provideLocalizedRouter(routes, { origin })` and as `origin` in the options of
`provideLocalizedServerRendering`. It must be one of the policy's own, and the build prerenders that
origin's locale only, at the addresses that origin serves. The head still advertises the others.
Serving several domains means a build per domain.

That policy also needs the server told the same list of domains. `@angular/ssr` answers a `Host`
header it does not recognize with `400`, before your application runs, and it recognizes loopback and
nothing else by default. `allowedLocaleHosts(routePolicy)` derives the list, so `allowedHosts` is the
policy rather than a second copy of it. It returns an empty list for the policies that serve one
origin, so the line is the same whichever policy you end up with.

## Know what a redirect carries

A render whose address moves answers with the status routing gives the move. An address that names
no locale is sent to the one the request preferred with `307`, and a correction to the canonical
spelling is `308`. The first also carries `Cache-Control: private, no-cache` and
`Vary: Accept-Language`, because neither depends on your deployment. A page at an address more than
one locale spells, which only a locale-neutral policy has, carries the same `Vary`.

How long a correction or a page may be kept does depend on your deployment, so a render leaves that
out. The handler in `@neolorn/equator/http` writes it from the numbers you give it, which is
[How to control how your pages are cached](control-caching.md).

## Related

- [How to negotiate a locale on your own server](negotiate-on-your-own-server.md)
- [How to publish a sitemap](publish-a-sitemap.md)
- [About how routing derives addresses](../explanation/about-addresses.md)
- [About how a locale switch is a transaction](../explanation/about-locale-switching.md)
