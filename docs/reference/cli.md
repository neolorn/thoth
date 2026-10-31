# Command line

Every command and every flag the `thoth` command line accepts. The text below is the output of
`--help` on the built CLI, captured by running it.

This page is generated from the packages and is not edited by hand.

Running these commands in a project is
[How to run generation in your build](../how-to/run-generation-in-your-build.md).

```text
Usage: thoth <command> [options]

Commands:
  init       Add compatible Thoth configuration and package setup
  generate   Compile and safely publish generated #i18n artifacts
  check      Validate authored inputs, analysis, and generated freshness
  format     Canonically format Thoth configuration and catalogs
  exchange   Export XLIFF documents for translators, or import them back
  clean      Remove only verified Thoth-owned generated and work state
  uninstall  Remove Thoth from this owner, keeping authored catalogs
  watch      Reconcile changes in one foreground process
  migrate    Preview or apply one explicit Thoth-authored migration plan

Common options:
  --project <path>   Select an owner directory or thoth.config.json
  --json             Emit deterministic machine-readable JSON
  --dry-run          Preview init, generate, format, exchange, clean, uninstall, or migrate
  --help             Show this help
  --version          Show the toolkit version

Init options:
  --source-locale <locale>
      The locale the authored source catalogs are written in.
  --default-locale <locale>
      The locale served when a request asks for none Thoth supports.
  --locale <locale>   (repeatable)
      Every locale this project supports. Repeat for each one.
  --person-name-locale <locale>   (repeatable)
      Locales a person name may be written in, beyond the ones this project is translated into.
  --pseudo-locale <locale>[.<option>=<value>]   (repeatable)
      Generated only on request, in the source language, with a script and a pseudo-locale region.
      lengthFactor (number)
        Signed length change. Positive expands, negative elides vowels; absent leaves length alone.
      markers (boolean)
        Wrap the whole rendered message in boundary markers, so untranslated text has none.
  --formatting <locale>.<option>=<value>   (repeatable)
      How a locale is written, where the application disagrees with CLDR about that locale.
      numberingSystem (string)
        The digits this locale is written in, where they differ from the ones CLDR gives it.
      calendar (string)
        The calendar this locale is written in, where it differs from the one CLDR gives it.
      hourCycle (string)
        The hour cycle this locale is written in, where it differs from the one CLDR gives it.
  --in-progress <locale>.<option>=<value>   (repeatable)
      Locales still being translated. Their completeness findings never block a release.
      note (string)
        Why this locale is not complete yet. Quoted back in every finding it downgrades.
  --parent-locale <locale>=<locale>   (repeatable)
      Which locale a locale inherits from, where CLDR is wrong for this project. `und` means none.
  --alias <alias>=<locale>   (repeatable)
      Extra identifiers that resolve to a supported locale.
  --url-policy path-prefix|locale-host|locale-neutral
      Where the locale appears in an address: path-prefix, locale-host or locale-neutral.
  --locale-prefix <locale>=<segment>   (repeatable)
      A locale's path prefix, where it is not the locale's tag in lowercase. path-prefix only.
  --prefix-alias <segment>=<locale>   (repeatable)
      A further path prefix that reaches a locale and is corrected to its own. path-prefix only.
  --omit-default-prefix true|false
      Serve the default locale without a prefix, at the root. path-prefix only.
  --locale-origin <locale>=<origin>   (repeatable)
      The origin each locale is served at, scheme included. Required by locale-host, and only there.
  --locale-neutral-root <segment>   (repeatable)
      A first path segment that no locale owns, such as an API root. Repeat for each one.
  --x-default <path-or-origin>
      The x-default alternate: a path, or under locale-host an origin. Absent means none.
  --recovery-message <scope>/<message>
      The message a visitor reads when no catalog can be loaded, as <scope>/<message>.
  --recovery-retry <scope>/<message>
      The wording of the retry control beside it, as <scope>/<message>. Absent means no control.

  A repeatable flag may appear more than once. Where a value contains "=", the left side is a
  path beneath the field: "eg=ar-EG" sets one entry, "en-Latn-XA.markers=true" sets one
  option of one entry. Every field thoth.config.json accepts has a flag above.

Uninstall options:
  --catalogs         Also remove authored catalogs (off by default)

Check options:
  --fix              Apply only semantic-preserving canonical formatting
  --require-complete Fail when a required target locale omits a source message
  --require-fresh    Fail when generated output does not match the sources
  --pseudo           Also generate the configured pseudo-locales (development only)

Exchange options:
  thoth exchange export|import [--locale <locale> ...]
  --locale <locale>  A target locale, one XLIFF document each (repeatable; default: every one)
  --dir <path>       Where the documents are written and read (default: xliff in the owner)

Migrate options:
  --plan <path>      Select one thoth-authored-change-plan/1 JSON file
  --project <owner>  Select the explicit migration owner (required)

Exit codes: 0 success, 1 diagnostics, 2 invocation/configuration, 3 environment, 130 interruption.
```

## Exit codes

A build reads the exit code rather than the output, because "your catalogs have a problem" and
"this invocation was wrong" are two different things to wake someone up for.

| Code  | Means                                         |
| ----- | --------------------------------------------- |
| `0`   | Success                                       |
| `1`   | Diagnostics were reported                     |
| `2`   | The invocation or the configuration was wrong |
| `3`   | The environment could not support the run     |
| `130` | Interrupted                                   |
