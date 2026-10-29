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
  - `init`, `generate`, `check`, `watch`, `format`, `clean`, `uninstall`, and `migrate`, with options generated from the configuration schema.
  - Stable exit codes, `--json` machine output, and `--dry-run` on every command that writes.
  - Release-completeness and freshness checks, with a per-locale in-progress declaration.
- **Interchange**
  - [XLIFF 2.2](https://docs.oasis-open.org/xliff/xliff-core/v2.2/xliff-core-v2.2.html) export and import through `exportXliff22` and `importXliff22`, with translation-state tracking and the authored notes carried alongside each message.
  - JSON Schemas published for every file format the toolkit reads or writes.
- **Diagnostics**
  - Stable codes, listed in `DIAGNOSTICS.md` inside this package and in the [diagnostics reference](https://github.com/neolorn/thoth/blob/main/docs/reference/diagnostics.md).
  - Severity that decides whether a run continues, and no authored content in any event.

## Requirements

The Angular, TypeScript, and Node.js ranges an install accepts are on [Compatibility](https://github.com/neolorn/thoth/blob/main/docs/reference/compatibility.md).

## Install

```sh install
npm install @neolorn/thoth
npm install --save-dev @neolorn/thoth-toolkit
```

This package runs at build time and ships in nothing, which is why it is a development dependency. [`@neolorn/thoth`](https://www.npmjs.com/package/@neolorn/thoth) is what the application ships.

## Quick start

Declare the locales the project serves:

```text
npx thoth init --source-locale en-US --default-locale en-US --locale en-US --locale ar-EG
```

`init` writes `thoth.config.json`, maps `#i18n` in `package.json`, creates the `i18n/` directory, and adds the `thoth:generate`, `thoth:check`, `thoth:format`, `thoth:clean`, and `thoth:watch` scripts. It stops on anything that would conflict rather than overwriting it. Run it on a TTY with no arguments and it asks the same questions. `thoth init --help` lists a flag for every field the configuration accepts.

The file it writes holds the locale set and nothing else:

```json excerpt thoth.config.json
{
  "schemaVersion": 1,
  "sourceLocale": "en-US",
  "defaultLocale": "en-US",
  "locales": ["en-US", "ar-EG"]
}
```

Every other field, including the entries for a locale spelled differently from CLDR and for a locale that is not finished yet, is on [Configuration](https://github.com/neolorn/thoth/blob/main/docs/reference/configuration.md).

`init` writes no catalog. Write one at `i18n/<scope>/<locale>.yaml`, one file per locale per scope:

```yaml excerpt i18n/shell/en-US.yaml
messages:
  app-title: Hello, world
  recovery-message: The page could not be shown. Please reload.
```

Keys are kebab-case in the file and camelCase in code, so `app-title` is `messages.appTitle`. A message may also be a record carrying `description` and `context` for whoever translates it, and both travel into the interchange document with the message.

Compile the catalogs:

```text
npx thoth generate
```

`generate` writes the `#i18n` modules the application imports. Wiring them into an application is the [tutorial](https://github.com/neolorn/thoth/blob/main/docs/tutorial.md).

## Documentation

- [Tutorial](https://github.com/neolorn/thoth/blob/main/docs/tutorial.md): a two-locale application from `ng new` to a localized route.
- [Command line](https://github.com/neolorn/thoth/blob/main/docs/reference/cli.md): every command, flag, and exit code.
- [Configuration](https://github.com/neolorn/thoth/blob/main/docs/reference/configuration.md): every field `thoth.config.json` accepts.
- [DIAGNOSTICS.md](./DIAGNOSTICS.md): every code this package reports, shipped with the package.
- [How to translate catalogs](https://github.com/neolorn/thoth/blob/main/docs/how-to/translate-catalogs.md): getting catalogs to translators and back.
- [Thoth](https://github.com/neolorn/thoth): the repository, the specifications, and how to contribute.

## License

[MIT](https://github.com/neolorn/thoth/blob/main/LICENSE).
