# How to translate catalogs

Export the catalogs to
[XLIFF 2.2](https://docs.oasis-open.org/xliff/xliff-core/v2.2/xliff-core-v2.2.html), hand the
documents to translators, and import what comes back. What travels is the message and the notes you
wrote beside it.

## Before you begin

You need catalogs, which is [How to write a message](write-messages.md).

## Export

Name each locale you want translated:

```text
npx thoth exchange export --locale ar-EG --locale fr-FR
```

Without `--locale`, it exports every locale in `thoth.config.json` except the source locale. This
writes one document per locale, `xliff/ar-EG.xlf` and `xliff/fr-FR.xlf`, and each holds every
scope of the project as a `<file>` of its own. Every message carries the `description` and
`context` you authored, so a translator has the notes rather than a bare string, and a message the
target catalog already translates arrives with its translation.

A message without variants reaches the translator as text, with its placeholders and markup as
XLIFF inline codes a translation tool protects. A message with variants, one written with `.match`,
travels as its MessageFormat 2 text, and the translator edits the variants in that syntax.

`--dir <path>` writes the documents to another folder in the project. `i18n/`, the generated root
and `.thoth/` are refused, because Thoth reads or owns them. `--dry-run` lists the files that would
change and writes none of them.

## Import

Put the returned documents where the export wrote them, and import the same locales:

```text
npx thoth exchange import --locale ar-EG --locale fr-FR
```

Each translated unit is written into `i18n/<scope>/<locale>.yaml`. In a catalog that exists, only
the entries a unit translates change: comments, key order, block scalars and every other entry stay
as you wrote them, and an entry the catalog did not have is added at the end. A scope with no
catalog for the locale gets one.

A unit that is not imported leaves its entry as it was, and the units around it are imported:

- A segment still in the `initial` state holds a placeholder rather than translated work, and is
  reported as a warning.
- A unit exported before its source message changed is stale, and is reported as a warning. Export
  again to send the current wording.
- A translation that drops or adds a placeholder, or is not a valid message, is an error, and the
  run exits with `1`.

An export does not replace a document holding a translation the catalogs do not. It writes
nothing and names each unit with what the document holds and what the catalog holds: import the
document when it holds returned translations, or delete it when the catalogs hold the newer text.

`exportXliff22` and `importXliff22`, exported from `@neolorn/thoth-toolkit`, do the same for one
scope in one locale from code, on catalogs read with `parseCatalog`. Each returns a result rather
than throwing for content it cannot take: check `ok`, then read the document or the catalog from
`value`.

Nothing about your build, your routes or your project goes into the document, and nothing in the
document can introduce markup or a destination into your page, which is
[About the trust model for translated content](../explanation/about-trusted-content.md).

## Check what is finished

A locale that is not finished has four shapes: no catalog for a scope, a catalog missing a message, a
message missing a plural form its language needs, and a translation written against a source message
that has since changed.

```text
npx thoth check --require-complete
```

All four stop the run under `--require-complete` and are ordinary warnings without it, because during
development the source language lands first and the translations follow. An inherited answer counts
as an answer.

## Ship a locale that is not ready

Name the locale rather than turning the gate off for every locale.

`thoth.config.json` takes an `inProgress` entry naming the locale and a note, which
`thoth init --in-progress` writes for you. That locale's findings are still printed, with your
note quoted into them, and they stop blocking.

The note is required, and it is what tells the next person whether the exemption still holds.

## Review a translation in place

`withOverlayLocale` renders a locale on top of the one that is committed, without changing it. A
reviewer opens the page as it will read in Arabic while the application, its state and its addresses
stay where they are.

It is not a way to serve a locale you have not declared. What it overlays has to be a locale you
compiled.

## Accept a translation that still fits

After a source edit that does not change the meaning, the translation written against the old
wording is reported stale until it changes. `.thoth-translation-state.json` records, one line per
message and locale, the source each translation was written against. Delete the line for that
message and locale, and the next `generate` records the translation as written against the current
source. When it is the last entry, delete the comma that ends the line before it too. A record that
is not valid JSON, such as one a merge left conflict markers in, stops `generate` and `check` with
`TH1702` and is left as it is until you resolve it.

## What is checked in

The catalogs, `thoth.config.json` and `.thoth-translation-state.json` are yours and are checked
in. Without the translation state, a fresh checkout reports no translation stale. The documents in
`xliff/` are rewritten by every export, and are checked in only where translators work from the
repository.

Everything under the generated root, `src/generated/i18n/` unless configured otherwise, is output:
it carries an ownership marker, it regenerates, and `thoth clean` removes it. A hand-edited
generated file is overwritten by the next `generate`. `.thoth/` holds a cache that is safe to
delete. Where the project has a `.gitignore`, `thoth init` and `ng add` add both to it, and
`thoth uninstall` takes them out again:

```text
src/generated/i18n/
.thoth/
```

## Related

- [How to run generation in your build](run-generation-in-your-build.md)
- [About compilation and generated contracts](../explanation/about-compilation.md)
- [Command line](../reference/cli.md)
