# Configuration

Every field `thoth.config.json` accepts. The table is read from the schema that validates the
file and produces the flags of `thoth init --help`.

This page is generated from the packages and is not edited by hand.

What the locale fields mean for a visitor is
[About how a locale is resolved](../explanation/about-locale-resolution.md).

| Field                | Accepts                                            | Required | What it is                                                                                     |
| -------------------- | -------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------- |
| `sourceLocale`       | string                                             | yes      | The locale the authored source catalogs are written in.                                        |
| `defaultLocale`      | string                                             | yes      | The locale served when a request asks for none Thoth supports.                                 |
| `locales`            | a list of string                                   | yes      | Every locale this project supports. Repeat for each one.                                       |
| `personNameLocales`  | a list of string                                   | no       | Locales a person name may be written in, beyond the ones this project is translated into.      |
| `pseudoLocales`      | a map of an object                                 | no       | Generated only on request, in the source language, with a script and a pseudo-locale region.   |
| `formatting`         | a map of an object                                 | no       | How a locale is written, where the application disagrees with CLDR about that locale.          |
| `inProgress`         | a map of an object                                 | no       | Locales still being translated. Their completeness findings never block a release.             |
| `parentLocales`      | a map of string                                    | no       | Which locale a locale inherits from, where CLDR is wrong for this project. `und` means none.   |
| `aliases`            | a map of string                                    | no       | Extra identifiers that resolve to a supported locale.                                          |
| `urlPolicy`          | `path-prefix` or `locale-host` or `locale-neutral` | no       | Where the locale appears in an address: path-prefix, locale-host or locale-neutral.            |
| `localePrefixes`     | a map of string                                    | no       | A locale's path prefix, where it is not the locale's tag in lowercase. path-prefix only.       |
| `prefixAliases`      | a map of string                                    | no       | A further path prefix that reaches a locale and is corrected to its own. path-prefix only.     |
| `omitDefaultPrefix`  | boolean                                            | no       | Serve the default locale without a prefix, at the root. path-prefix only.                      |
| `localeOrigins`      | a map of string                                    | no       | The origin each locale is served at, scheme included. Required by locale-host, and only there. |
| `localeNeutralRoots` | a list of string                                   | no       | A first path segment that no locale owns, such as an API root. Repeat for each one.            |
| `xDefault`           | string                                             | no       | The x-default alternate: a path, or under locale-host an origin. Absent means none.            |
| `recoveryMessage`    | string                                             | no       | The message a visitor reads when no catalog can be loaded, as <scope>/<message>.               |
| `recoveryRetry`      | string                                             | no       | The wording of the retry control beside it, as <scope>/<message>. Absent means no control.     |

## The version field

`schemaVersion` is written by `thoth init` and read by everything that opens the file. It is not
a field you set: it says which shape the rest of the file is in, and a version this release does
not understand is refused rather than guessed at.

## When the pseudo-locales are generated

Declaring a pseudo-locale in `pseudoLocales` does not generate it. The `pseudoLocales` option of
the `build`, `serve` and `test` builders asks for it, and `ng add` sets that option where a
development run reads it: the `development` configuration of the serve and build targets, and
the options of the test target. `thoth generate --pseudo` and `thoth check --pseudo` ask for it
outside the builders. A production build asks for none, so it holds no catalog, no locale table
entry and no transform for a pseudo-locale.
