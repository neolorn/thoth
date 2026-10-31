# How to run generation in your build

`ng build`, `ng serve` and `ng test` generate the `#i18n` modules before Angular reads them when
your workspace runs them through the toolkit's builders. Nothing runs beside them.

## Before you begin

You need a project that `ng add @neolorn/thoth-toolkit` or `thoth init` has set up.

## Point the targets at the builders

`ng add` does this for you. In a project `thoth init` set up, do it by hand.

Each of the three builders generates, then runs an Angular target you name. Rename the `build`,
`serve` and `test` targets in `angular.json` to `angular-build`, `angular-serve` and
`angular-test`, and add three targets with the old names that run them:

```text
"build": {
  "builder": "@neolorn/thoth-toolkit:build",
  "options": { "buildTarget": "my-app:angular-build" },
  "configurations": {
    "production": { "buildTarget": "my-app:angular-build:production" },
    "development": { "buildTarget": "my-app:angular-build:development" }
  },
  "defaultConfiguration": "production"
},
"serve": {
  "builder": "@neolorn/thoth-toolkit:serve",
  "options": { "serveTarget": "my-app:angular-serve" }
},
"test": {
  "builder": "@neolorn/thoth-toolkit:test",
  "options": { "testTarget": "my-app:angular-test" }
},
"angular-build": {
  "builder": "@angular/build:application",
  "options": { "browser": "src/main.ts", "tsConfig": "tsconfig.app.json" },
  "configurations": { "production": {}, "development": { "optimization": false } },
  "defaultConfiguration": "production"
},
"angular-serve": {
  "builder": "@angular/build:dev-server",
  "options": { "buildTarget": "my-app:angular-build:development" }
},
"angular-test": {
  "builder": "@angular/build:unit-test",
  "options": { "buildTarget": "my-app:angular-build:development" }
}
```

`my-app` is your project's name, and this is what `ng add` writes. The Angular targets keep their
builders and every option they had. `angular-serve` and `angular-test` name `angular-build` as their `buildTarget`, because
Angular's dev server and unit-test builder read the options of an `@angular/build:application`
target.

`-c production` selects a configuration of the Thoth target, and that configuration names the
Angular configuration it runs. Add a configuration to the Thoth target when you add one to the
Angular target.

A schematic that edits the `build` target expects Angular's builder there, so run one, such as
`ng add @angular/ssr`, before `ng add @neolorn/thoth-toolkit`.

## What each command does

`ng build` generates, and builds only when generation succeeds. A catalog that does not compile
ends the build with its diagnostics in the output and a non-zero exit code, and Angular does not
start.

`ng serve` generates, starts the dev server, and keeps generating for as long as it runs. A saved
catalog is regenerated, and the dev server picks up the new modules the way it picks up any other
edit. A catalog that does not compile prints its diagnostics, and the dev server keeps serving the
modules from the last generation that succeeded.

`ng test` generates and runs the tests. When the tests watch, generation does too.

## Pass Angular options

`ng build`, `ng serve` and `ng test` take every option of the Angular builder their target runs,
and pass the ones you give on the command line to the Angular target:

```text
ng serve --port 4300
ng build --source-map
ng test --watch=false
```

Angular validates them against its own builder's schema, so it refuses an option your Angular
version does not have. Options you keep go on the Angular target in `angular.json`, as they do
without Thoth. An Angular option set on the Thoth target ends the command with an error that names
the target it belongs on.

`ng run my-app:angular-build` runs Angular alone and does not generate.

## Generate for other steps

A step that reads the generated modules outside those three commands, such as a standalone
typecheck, runs `thoth generate` first:

```text
"typecheck": "thoth generate && tsc -p tsconfig.app.json --noEmit"
```

`thoth watch` regenerates in a foreground process of its own, for work that does not run
`ng serve`. A save that leaves every input as it was starts no generation and prints nothing.

## Fail on stale output

`thoth check --require-fresh` fails when the generated modules no longer match their sources. A
stale `#i18n` module still compiles and renders the messages it was generated from, so this belongs
in a pipeline that checks the generated modules without building.

## Read the exit code

`thoth` exits with `0` success, `1` diagnostics, `2` invocation or configuration, `3` environment,
`130` interruption. A build can tell a problem in your catalogs from a wrong invocation. `--json`
makes any command emit a deterministic machine-readable result, and `--dry-run` previews the ones
that write.

## Compose the runtime without the generated wrapper

`#i18n` exports `provideLocalization`, which calls `provideLocalizationSetup(localizationSetup,
...features)` with your project's setup already bound. Call `provideLocalizationSetup` yourself and
pass `localizationSetup` by hand when you want to: it takes the same features and behaves
identically. Going through the generated wrapper means one less import and no chance of handing it a
setup from another project.

## Remove it

Point `build`, `serve` and `test` back at the Angular builders and run `thoth generate` yourself.
`thoth clean` removes what Thoth wrote and nothing else. `thoth uninstall` removes Thoth and keeps
the catalogs, which are yours.

## Related

- [About compilation and generated contracts](../explanation/about-compilation.md)
- [How to translate catalogs](translate-catalogs.md)
- [Command line](../reference/cli.md)
