# Contributing to Thoth

Thank you for your interest in contributing to Thoth. This document explains how the project is organized, how to set up a development environment, and what a contribution needs to look like to be merged.

## Table of contents

- [Code of conduct](#code-of-conduct)
- [Reporting bugs and requesting features](#reporting-bugs-and-requesting-features)
- [Development setup](#development-setup)
- [Running the checks](#running-the-checks)
- [Making a change](#making-a-change)
- [Commit messages](#commit-messages)
- [Pull requests](#pull-requests)
- [Documentation](#documentation)
- [Dependencies](#dependencies)
- [Releases](#releases)

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating, you agree to uphold it.

## Reporting bugs and requesting features

Use the [issue templates](https://github.com/neolorn/thoth/issues/new/choose). For a bug, include the versions of `@neolorn/thoth` and `@neolorn/thoth-toolkit`, the Angular version, and the smallest reproduction you can provide: the catalog, the configuration, or the route involved.

For a feature, open an issue before writing code. Thoth covers localization in general; a capability that only one application needs belongs in that application, and the issue is where that question is settled.

Do not report security vulnerabilities in public issues. See [SECURITY.md](SECURITY.md).

## Development setup

Thoth is a pnpm workspace with two packages, `packages/runtime` and `packages/toolkit`, and a set of consumer applications under `fixtures/` used for verification.

Requirements:

- Node.js on one of the supported lines listed in [Compatibility](docs/reference/compatibility.md)
- pnpm at the version declared in the `packageManager` field of `package.json`

Install and build:

```sh
pnpm install
pnpm run build
```

The verification suite drives real applications in Chromium, Firefox, and WebKit. Install the browser engines once:

```sh
pnpm exec playwright install chromium firefox webkit
```

## Running the checks

The quick checks take about a minute and a half on a machine with 32 logical processors, and cover formatting, linting, types, the anchors of the verification suite's injections, what a clean keeps, the mutation reading tool, and the unit suites of both packages:

```sh
pnpm run format:check
pnpm run lint
pnpm run typecheck
pnpm run verify:injection-anchors
pnpm run verify:clean:self-test
pnpm run verify:mutation-reading:self-test
pnpm run test:toolkit
pnpm run test:runtime
```

`pnpm run check` runs all eight, one after another, with each one's output in a file under `tmp/quick-checks`, and `pnpm run check --docs` adds the checks of the documents, the normative map and the generated references, none of which builds anything. It hands Prettier and the unit suites every path git ignores as an exclusion, because neither reads `.git/info/exclude`, and while a job of the cap (below) runs it holds the unit suites to two workers. These are the checks meant to run beside other work. Every other stage of the verification suite, and anything that builds the packages or a consumer, is heavy and on a machine with the cap runs through it, one at a time; `pnpm run check` takes no stage name, and refuses one with the command that runs it under the cap.

The full verification suite builds both packages, installs them into consumer applications with pnpm and their packed tarballs into one with npm, runs those applications on three Angular versions and three browser engines, executes every code example in the documentation, and checks the generated reference pages against the packages:

```sh
pnpm run verify
```

It runs on Windows and Linux, and takes about two and a half hours on a machine with 32 logical processors, most of it in `verify:assurance:runtime`, which rebuilds the runtime once for each behavior it removes. Run it on the finished change before opening a pull request. If a stage cannot run in your environment, say so in the pull request.

To run some of its stages the way the suite runs them, name them:

```sh
node tools/verify.ts --only verify:consumer,verify:cost-reference
```

This runs the named stages and the stages they need, on the committed tree, in fresh work trees of its own. `node tools/verify.ts --plan` lists the stages. A stage that passes when its script is run in your checkout can still fail in the suite, which runs it in a fresh work tree without a terminal; this shows that before the full run does. `pnpm run verify:pre-gate` runs this way the stages a change most often breaks: the injection anchors, the matrix, the coverage of the documents, the packages, the builder, `ng add` and consumer rows, the cost page, the mutation reasons' self-test, and the generated tables and references.

To see that a change's new injections are caught before the suite runs them all, name them: `node tools/verify-assurance.ts --only <id>,<id>` measures those alone in the checkout, and `node tools/verify-assurance-runtime.ts --only <id>` does the same after the runtime stage's build. `node tools/verify-assurance.ts --plants <file>` measures defects written down in a file in the same shape, to see whether a test notices them before deciding whether they become declared injections.

On Windows with WSL, `node tools/verify-in-wsl.ts <commit> --home <folder> --gate` runs the suite on Linux as the hosted job does: a fresh clone at that commit in the Linux folder named, `CI=true`, the job's set-up steps, then the suite with every processor of the Linux machine, each step's output in `tmp/wsl/<commit>`. `--pack` builds there, packs and collects the archives with their sums, which `pnpm run release:collect <folder>` does in the checkout, so the archives the two systems make of one commit can be compared.

The suite runs below normal priority, except for the stages that run alone (the browser rows, `verify:browser-specs`, and `verify:cost-budget` with its self-test), which run at normal priority. It schedules at most two thirds of the machine's logical processors: the stages that run at once take shares that fit in that number, and each stage's test runners and builds are handed worker counts from its share. A stage that builds an Angular application cannot be held within fewer than two processors, or three with Angular 22.0: where two thirds of the machine is less than three, the suite schedules three, and a smaller setting is refused. Every Node process also runs helper threads beside its JavaScript that no setting holds, so the suite can use more processor time than it schedules; the summary reports each window where it does, by stage, and on Linux by thread. Set `THOTH_VERIFY_PROCESSORS` to a number of logical processors to give it a different share. Set `THOTH_VERIFY_PRIORITY_FILE` to a file to change the level while the suite runs: while the file holds the word `normal`, every stage runs at normal priority. On Linux, a process without privilege cannot raise a priority it has lowered, so there the word raises only the stages that start while the file holds it: a stage already below normal stays there, and a stage started at normal is lowered when the word is removed. It does not start a stage while less than a quarter of the machine's memory is free. Only one heavy job goes at a time: the suite, a run of named stages, and a mutation run (`pnpm run mutation`, `pnpm run mutation:toolkit`) take the same lock, and the second to start stops with the name of the first.

On a Windows machine that is also someone's workstation, the heavy jobs can run under the cap, which holds a command and everything it starts in one Windows job object, with limits the machine's owner chooses by mode:

```sh
node tools/cap.ts start --log tmp/gate.log --status tmp/gate.status --manages-priority -- pnpm run verify
node tools/cap.ts mode night
```

`start` returns at once and the command goes on in a process of its own; its output goes to the log and how it ended to the status file. One command runs under the cap at a time, and a second is refused with the first one's command line. The modes are computed from the machine: `day` holds the job to two thirds of the processor time and two thirds of the memory Windows reports, at below-normal priority; `night` sets no limit and runs at normal priority; `efficiency` holds it to the efficiency cores and half of the memory, at below-normal priority. `mode` with a mode's name switches a running command as well as the next one, and lowers a memory limit only as far as what the job holds allows, so a switch ends nothing; without a name it prints the mode and the running job. `node tools/cap.ts policy` prints each mode's limits on this machine. The mode is kept in `tmp/cap/mode.txt`, and with no mode file the cap is in `day` mode. A mode file that cannot be read, or holds anything but `day`, `night` or `efficiency`, starts nothing: `start` exits 125 naming the file and `node tools/cap.ts mode`, `mode` and `policy` report it as unreadable or unknown, and a command already running keeps the limits in force and records the change once in its status (`modeNotes`). `mode` writes the file whole, beside it and then renamed over it, so no reader finds a part of one. The status also records the cap's folder. `pnpm run clean` keeps `tmp/cap` whole, so a clean changes neither the mode nor the state of a running command. The command starts from the user's default environment, with the caller's `THOTH_*` variables and `PATH` and nothing else of the caller's; `--manages-priority` hands the suite the cap's level file as `THOTH_VERIFY_PRIORITY_FILE`, so `night` raises its stages to normal. `pnpm run verify:cap:self-test` checks the policy on planted machines without starting a job.

A mutation reading scores a mutant that runs out of time as detected, and on a machine doing other work that can be the load rather than the mutant. `node tools/mutation-reading.ts doubtful <report.json> <base configuration> <folder>` writes a configuration that reads each such mutant of a report again with one runner, `merge` puts the second reading's verdicts back into the first reading's report and baseline, and `survivors` and `skeletons` list what a report did not detect, the second as entries for `tools/mutation-reasons.json`. `changed` says, for every line two commits changed, whether a reading or an injection shows it runs. The file's own description gives every command.

When a browser engine never finishes closing a page in a browser row, the suite closes that page's browser context instead and carries on. When the context does not close either, or the browser refuses to close it with a protocol error, the suite closes that browser, ends its process if the browser's own close does not finish, and runs the rest of the row in a fresh one. The verdict line and the attempt ledger count each time it did either, so a rising rate shows there.

Three commands are maintenance rather than checks:

```sh
pnpm run clean
pnpm run refresh:consumer
pnpm run refresh:consumer-locks
```

`clean` deletes `dist/` and empties `tmp/` of everything a run produces again. Run it when a build output from an earlier state of the tree is being read by something that should be reading a fresh one, or to discard the work trees and consumer installs the verification suite leaves behind. The suite's attempt ledger stays, because nothing can rebuild it, and so does the cap's folder `tmp/cap` (or the folder `THOTH_CAP_DIRECTORY` names), because the mode in it is the machine owner's and a command may be running from it; `pnpm run verify:clean:self-test` checks both on a planted folder. `pnpm run clean dist` removes the build output alone.

`refresh:consumer` hands the consumer fixtures the packages that are in `dist/` right now. A fixture takes Thoth as a `file:` dependency, which pnpm copies into its store, so a fixture that is already installed goes on running the build it was installed with until this runs.

`refresh:consumer-locks` regenerates the committed lockfiles of the consumer fixtures. It reaches the network, so run it when a fixture manifest or a dependency range changes and commit what it writes. It keeps every version a lockfile already records; to move a package the fixtures reach through another one, for a security fix, name it with `--update`, which moves the named packages to the newest version their ranges allow and nothing else:

```sh
pnpm run refresh:consumer-locks --update fast-uri,undici
```

The suite fetches nothing while it runs, so what it installs and the Node releases it runs on have to be on the machine first. Three commands fetch them, and each reaches the network:

```sh
pnpm run stage:node-runtimes
pnpm run stage:consumer-store
pnpm run stage:npm-cache
```

`stage:node-runtimes` downloads, and checks against their published digests, the lowest release of each Node line the packages support and the release the repository develops on, into `.runtimes/node`. `stage:consumer-store` puts the packages of every committed `pnpm-lock.yaml` under `fixtures/` in the pnpm store. `stage:npm-cache` puts the packages of the npm consumer's `package-lock.json` in `.runtimes/npm-cache`, where the suite's npm install reads them, and beside them the `@angular/build` release each Angular row's lockfile pins, which `generate:builder-options` reads the builders' option schemas from. Run all three on a new machine, and the last two again after `refresh:consumer-locks`. `stage:consumer-store` reads the built packages, because the fixtures' lockfiles name them, so run `pnpm run build` before it.

## Making a change

The [specifications](specs/README.md) describe what Thoth accepts, produces, and guarantees. Read the specification that owns the area you are changing before you change its behavior. If the specification is wrong, open an issue; the specification is corrected in the same change as the code.

A change is one coherent unit of work. Keep unrelated changes in separate commits and separate pull requests.

Do not commit:

- secrets, credentials, tokens, or local environment values;
- build output, caches, logs, or dependency directories;
- editor or operating system files.

Generated files are committed only where the repository treats them as source, and they are regenerated by the build; do not edit them by hand.

## Commit messages

Commit messages follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/):

```text
<type>(<scope>): <description>

<body>
```

- `type` is one of `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, or `revert`.
- `scope` is optional and names the area, for example `routing`, `toolkit`, or `specs`.
- The description is imperative, lowercase, and has no trailing period.
- The body explains what changed and why when the subject is not enough. A breaking change is described in the body, with the migration.

Examples:

```text
feat(routing): derive locale-neutral roots from the URL policy
fix(toolkit): report the parent scope when a message pointer does not resolve
docs: add the sitemap how-to
chore(release): 1.0.0
```

## Pull requests

- One purpose per pull request.
- The title is a valid commit subject; it becomes the subject of the squash commit.
- The description says what changed, why, how it was verified, and any migration a user needs.
- Link the related issue when there is one.

Pull requests are squash-merged onto `main`, which is the only long-lived branch and stays linear. Name topic branches `<type>/<short-description>`, for example `feat/parent-locale-fallback`. A maintainer commits to `main` directly under the same checks and the same commit convention, and the pull request path is how a change from outside the maintainers reaches it.

## Documentation

Documentation lives under `docs/` and follows the [Diátaxis](https://diataxis.fr) structure: a tutorial, how-to guides, reference pages, and explanation pages. Reference pages are generated from the packages and are not edited by hand.

Every code block in the documentation and in the READMEs is executed by the verification suite. A block that names a file is written into a real application; a page that writes a file carries a spec that must pass. Label every block with its destination.

For style, follow the [Google developer documentation style guide](https://developers.google.com/style): second person, present tense, active voice, American spelling.

`CHANGELOG.md` follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html): one section per version, newest first, entries grouped under Added, Changed, Deprecated, Removed, Fixed and Security, and each entry stating what a reader of the library meets.

## Dependencies

Thoth's runtime has no dependencies beyond `tslib`, and the toolkit's dependencies are pinned to exact versions. Adding a dependency, a polyfill, or a use of an undocumented platform or compiler API is a project decision. Open an issue before proposing one.

## Releases

Releases are cut by the maintainers following [RELEASING.md](RELEASING.md). Version numbers follow [Semantic Versioning](https://semver.org); what a version promises is described in [Versioning and compatibility](docs/versioning.md).
