# How to set a recovery message

The recovery message is the sentence a visitor reads when the catalogs cannot be loaded at all. It
has no default, and every application names one in `thoth.config.json`.

## Before you begin

You need a `shell` scope, or any scope that is loaded before the rest, which is
[How to write a message](write-messages.md).

## Author it

Two plain keys, no placeholders. The failure path is the one place there is nothing to interpolate
from:

```yaml excerpt i18n/shell/en-US.yaml
messages:
  app-title: Hello, world
  recovery-message: The page could not be shown. Please reload.
  recovery-retry: Try again
```

The second names the retry control. Write it in every locale you ship, the way you write the first.

## Name it in the configuration

Name each message in `thoth.config.json` as `<scope>/<message>`, with the key as the catalog writes
it:

```json excerpt thoth.config.json
{
  "recoveryMessage": "shell/recovery-message",
  "recoveryRetry": "shell/recovery-retry"
}
```

`thoth init` writes both keys when you pass `--recovery-message` and `--recovery-retry`. It writes no
message, and names the recovery message as one of the two things it leaves for you to write.
Generation binds both keys into the setup `provideLocalization()` closes over, so no application
code names them, and a changed key takes effect at the next `thoth generate`.

`recoveryRetry` is optional and is what makes the retry control appear. It needs
`recoveryMessage` beside it. Both messages are compiled into the recovery payload, which is loaded
independently of the catalogs, so the wording arrives in the locale the reader asked for even though
no catalog could be loaded.

`generate` reports `TH1310` for an application runtime whose configuration names no recovery
message, and `TH1501` for a key that names no message in the source catalogs, or names one that
takes an input or carries a slot.

## Render it

`recovery()` carries the message once localization has failed and `recoveryRetryLabel()` carries the
control's wording. `lifecycle()` reports which state the runtime is in. Render the first when the
second reports failed.

`retry()` makes another attempt rather than reloading, so application state survives it. Put it
behind the button on your failure screen. With `provideLocalizedRouter`, the address the reader
asked for stays in the address bar while the failure is on screen, and a retry that succeeds
completes the navigation to it.

`<localization-recovery />` does all of that: it renders the message in a live region with the
message's own language and direction, and the button with the retry label's. Its `retryLabel` input
takes a plain string, for an application that names no `recoveryRetry`, and the message
`recoveryRetry` names wins over it. A string is in whichever language the call site was typed in,
inside a region already marked as the reader's, so prefer the configured message.

Where a failed attempt leads is yours to decide. The HTML standard has a browser forget a module it
failed to fetch, so the next attempt fetches it again. A browser that still remembers the failure
answers every later attempt with it and sends no request, and in that page the catalog cannot be
reached again. The failure's `reason` is then `module-load-failed`, and reloading the page is the way
back. `<localization-recovery />` hands you the diagnostic of an attempt that failed through its
`retryFailed` output.

Render the rest of the template only while `snapshot()` has a value. With no catalog loaded, reading
any other message throws, and a template that reads one fails to render, recovery region included.
`lifecycle()` is not the condition to use, because a retry leaves `failed` as it starts, before
anything has loaded. Place `<localization-recovery />` outside that condition and everything
localized inside it.

## Count the failures

`withObservability` sends runtime outcomes to a sink you supply, including the failure a visitor saw
this message for. A failure carries a reason from a closed set rather than a sentence to parse, so
you can count reasons without reading them. What an event may contain is
[About diagnostics and runtime outcomes](../explanation/about-diagnostics.md).

## Related

- [About why the recovery message has no default](../explanation/about-the-recovery-message.md)
- [About diagnostics and runtime outcomes](../explanation/about-diagnostics.md)
- [How to write a message](write-messages.md), for the ordinary case of a locale that omits one
