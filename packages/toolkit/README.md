# @neolorn/thoth-toolkit

### Compiler and command line for Thoth (MessageFormat 2, XLIFF 2.2, JSON Schema)

[![npm version](https://img.shields.io/npm/v/@neolorn/thoth-toolkit?style=flat-square)](https://www.npmjs.com/package/@neolorn/thoth-toolkit)
[![license](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](https://github.com/neolorn/thoth/blob/main/LICENSE)

**@neolorn/thoth-toolkit** is the build-time half of [Thoth](https://github.com/neolorn/thoth). It reads the authored YAML catalogs, validates them against the [MessageFormat 2](https://www.unicode.org/reports/tr35/tr35-78/tr35-messageFormat.html) specification and the source language, analyzes the application's templates and routes to derive scopes and localized addresses, and generates the typed `#i18n` modules [`@neolorn/thoth`](https://www.npmjs.com/package/@neolorn/thoth) imports.

## Features

- **Compilation**
  - YAML catalogs compiled into typed message handles, checked by the TypeScript compiler at the line that uses them.
  - Message scopes and localized addresses derived from template and route analysis, so no second list is maintained by hand.
  - Compiled artifacts carrying content digests and compatibility fingerprints, admitted only after verification.
- **Command line**
  - `init`, `generate`, `check`, `watch`, `format`, `exchange`, `clean`, `uninstall`, and `migrate`, with options generated from the configuration schema.
  - Stable exit codes, `--json` machine output, and `--dry-run` on every command that writes.
  - Release-completeness and freshness checks, with a per-locale in-progress declaration.
- **Interchange**
  - [XLIFF 2.2](https://docs.oasis-open.org/xliff/xliff-core/v2.2/xliff-core-v2.2.html) export and import through `thoth exchange`, one document per target locale holding every scope, with translation-state tracking and the authored notes carried alongside each message. Imports keep the comments and layout of the catalogs they write into.
  - JSON Schemas published for every file format the toolkit reads or writes.
- **Diagnostics**
  - Stable codes, listed in `DIAGNOSTICS.md` inside this package and in the [diagnostics reference](https://github.com/neolorn/thoth/blob/main/docs/reference/diagnostics.md).
  - Severity that decides whether a run continues, and no authored content in any event.

## Requirements

The Angular, TypeScript, and Node.js ranges an install accepts are on [Compatibility](https://github.com/neolorn/thoth/blob/main/docs/reference/compatibility.md).

## Install

```sh run
npx ng add @neolorn/thoth-toolkit
```

`ng add` installs this package as a development dependency, because it runs at build time and ships in nothing, and [`@neolorn/thoth`](https://www.npmjs.com/package/@neolorn/thoth), which the application ships. It asks for the source locale, the default locale, the locales the application serves, and where a URL carries the locale, and each has an option, such as `--url-policy path-prefix`. Then it sets the project up:

- `thoth.config.json`, and the `#i18n` import and the `thoth:*` scripts in `package.json`, which are what `thoth init` writes.
- In `angular.json`, the builders `@neolorn/thoth-toolkit:build`, `:serve` and `:test` for `ng build`, `ng serve` and `ng test`. Each generates before the Angular target it runs, which keeps its options as `angular-build`, `angular-serve` or `angular-test`.
- In `app.config.ts`, `provideLocalizedRouter(routes)` in place of `provideRouter(routes)`, and `provideLocalization(withRouting())`. Where the application renders on the server, `provideLocalizedServerRendering` in `app.config.server.ts`, which needs `--origin`.

It writes no catalog, refuses a setup it would have to overwrite, and run again changes nothing.

In a workspace with several applications, `--project` names the one to set up, and its `thoth.config.json` and `package.json` go in that application's root. Run it once for each application.

## Quick start

In a project that is not an Angular CLI workspace, `thoth init` writes the configuration and the package entries. It takes the locales the project serves, where a URL carries the locale, and which messages the recovery screen shows:

```text
npx thoth init --source-locale en-US --default-locale en-US --locale en-US --locale ar-EG --url-policy path-prefix --recovery-message shell/recovery-message --recovery-retry shell/recovery-retry
```

`init` writes `thoth.config.json`, maps `#i18n` in `package.json`, creates the `i18n/` directory, and adds the `thoth:generate`, `thoth:check`, `thoth:format`, `thoth:clean`, `thoth:watch`, `thoth:export`, and `thoth:import` scripts. It stops on anything that would conflict rather than overwriting it. Run it on a TTY with no arguments and it asks the same questions. `thoth init --help` lists a flag for every field the configuration accepts.

The file it writes holds what the flags said:

```json excerpt thoth.config.json
{
  "schemaVersion": 1,
  "sourceLocale": "en-US",
  "defaultLocale": "en-US",
  "locales": ["en-US", "ar-EG"],
  "urlPolicy": "path-prefix",
  "recoveryMessage": "shell/recovery-message",
  "recoveryRetry": "shell/recovery-retry"
}
```

`path-prefix` puts the locale in the first path segment, spelled as the tag in lowercase, so the addresses are `/en-us` and `/ar-eg`. Every other field, including the other URL policies, the entries for a locale spelled differently from CLDR, and a locale that is not finished yet, is on [Configuration](https://github.com/neolorn/thoth/blob/main/docs/reference/configuration.md).

`init` writes no catalog. Write one at `i18n/<scope>/<locale>.yaml`, one file per locale per scope, with the two messages the recovery keys name:

```yaml excerpt i18n/shell/en-US.yaml
messages:
  app-title: Hello, world
  recovery-message: The page could not be shown. Please reload.
  recovery-retry: Try again
```

Keys are kebab-case in the file and camelCase in code, so `app-title` is `messages.appTitle`. A message may also be a record carrying `description` and `context` for whoever translates it, and both travel into the interchange document with the message.

`ng build` compiles the catalogs into the `#i18n` modules the application imports, and `thoth generate` does the same for a step the builders do not run. Wiring them into an application is the [tutorial](https://github.com/neolorn/thoth/blob/main/docs/tutorial.md).

## Documentation

- [Tutorial](https://github.com/neolorn/thoth/blob/main/docs/tutorial.md): a two-locale application from `ng new` to a localized route.
- [Command line](https://github.com/neolorn/thoth/blob/main/docs/reference/cli.md): every command, flag, and exit code.
- [Configuration](https://github.com/neolorn/thoth/blob/main/docs/reference/configuration.md): every field `thoth.config.json` accepts.
- [DIAGNOSTICS.md](./DIAGNOSTICS.md): every code this package reports, shipped with the package.
- [How to translate catalogs](https://github.com/neolorn/thoth/blob/main/docs/how-to/translate-catalogs.md): getting catalogs to translators and back.
- [Thoth](https://github.com/neolorn/thoth): the repository, the specifications, and how to contribute.

## License

[MIT](https://github.com/neolorn/thoth/blob/main/LICENSE).
