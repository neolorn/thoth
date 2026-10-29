/**
 * `ng add @neolorn/thoth-toolkit`: one command from an Angular application to a localized one.
 *
 * `specs/10-compiler-and-tooling.spec.md` section 11 says what it writes: the configuration and the
 * package entries `thoth init` writes, the runtime as a dependency, the Angular builders in place of
 * `build`, `serve` and `test`, and the providers in `app.config.ts` and, where the application
 * renders on the server, in `app.config.server.ts`. It writes no message and no catalog: those are
 * the application's text.
 *
 * Everything is checked before anything is written, and the Angular CLI's tree commits the writes
 * together or not at all, so a setup this refuses is left exactly as it was. Run a second time it
 * finds every part already in place and writes nothing.
 *
 * Only what the Angular CLI documents for schematics is used: the `Tree` and `Rule` of
 * `@angular-devkit/schematics`, and `readWorkspace`, `updateWorkspace`, `addDependency` and
 * `addRootProvider` from `@schematics/angular/utility`. The two edits that utility has no rule for,
 * replacing `provideRouter` and `provideServerRendering`, are made on the TypeScript syntax tree of
 * the file through the tree's update recorder.
 */

import { targetFromTargetString } from '@angular-devkit/architect';
import ts from 'typescript';

import { ANGULAR_TARGET_OPTION } from './angular-builder-schemas.js';
import {
  angularUtility,
  devkitSchematics,
  type ProjectDefinition,
  type Rule,
  type TargetDefinition,
  type Tree,
  type WorkspaceDefinition,
} from './angular-schematics.js';
import { INIT_OPTIONS } from './cli-options.generated.js';
import type { InitConfiguration } from './configuration.js';
import { humanDiagnostic } from './diagnostic-text.js';
import type { ToolkitDiagnostic } from './diagnostics.js';
import { InvocationError, applyInitOption } from './init-options.js';
import { ngAddProperty } from './ng-add-schema.js';

const COMMANDS = ['build', 'serve', 'test'] as const;
type Command = (typeof COMMANDS)[number];

const THOTH_BUILDER = (command: Command) => `@neolorn/thoth-toolkit:${command}`;
const ANGULAR_TARGET = (command: Command) => `angular-${command}`;

/** Angular's builders that read an application target's options through `buildTarget`. */
const BUILD_TARGET_READERS = new Set([
  '@angular/build:dev-server',
  '@angular/build:unit-test',
  '@angular/build:extract-i18n',
]);

/** A refusal: what was found, and what to do about it. Nothing has been written when one is thrown. */
function refuse(message: string): never {
  const { SchematicsException } = devkitSchematics();
  throw new SchematicsException(`Thoth ng add made no change. ${message}`);
}

function diagnosticsText(diagnostics: readonly ToolkitDiagnostic[]): string {
  return diagnostics.map(humanDiagnostic).join('').trimEnd();
}

/** The toolkit's own version, which is the version of the runtime released with it. */
async function toolkitVersion(): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  // Beside this module in the published package, and one directory up in the repository's
  // source, where the tests load it from.
  for (const path of ['./package.json', '../package.json']) {
    try {
      const manifest = JSON.parse(
        await readFile(new URL(path, import.meta.url), 'utf8'),
      ) as { name?: unknown; version?: unknown };
      if (
        manifest.name === '@neolorn/thoth-toolkit' &&
        typeof manifest.version === 'string'
      ) {
        return manifest.version;
      }
    } catch {
      // Not this layout; the other one is tried.
    }
  }
  throw new (devkitSchematics().SchematicsException)(
    'Thoth ng add could not read the toolkit version from its own package.json.',
  );
}

/**
 * The configuration fields the invocation sets, read the way `thoth init` reads its flags.
 *
 * A list flag also takes several values in one, separated by spaces or commas, which is how the
 * terminal question for the locales is answered.
 */
function requestedConfiguration(
  options: Readonly<Record<string, unknown>>,
): InitConfiguration {
  const requested: Record<string, unknown> = {};
  for (const option of INIT_OPTIONS) {
    const value = options[ngAddProperty(option)];
    if (value === undefined) continue;
    const given = Array.isArray(value) ? value : [value];
    const values =
      option.shape === 'list'
        ? given.flatMap((each) =>
            String(each)
              .split(/[\s,]+/u)
              .filter((part) => part.length > 0),
          )
        : given.map(String);
    try {
      for (const each of values) applyInitOption(requested, option, each);
    } catch (error) {
      if (error instanceof InvocationError) {
        refuse(error.message);
      }
      throw error;
    }
  }
  return requested as InitConfiguration;
}

/** The fields `ng add` cannot proceed without on a project that has no configuration yet. */
function missingFields(requested: InitConfiguration): readonly string[] {
  const fields = requested as Readonly<Record<string, unknown>>;
  return INIT_OPTIONS.filter(
    (option) =>
      (option.required || option.key === 'urlPolicy') &&
      fields[option.key] === undefined,
  ).map(
    (option) =>
      `${option.flag} ${option.value}${option.repeatable ? ' (repeat for each)' : ''}`,
  );
}

/** The one application in the workspace, which is the one Thoth's configuration at its root serves. */
function selectedProject(
  workspace: WorkspaceDefinition,
  requested: unknown,
): { readonly name: string; readonly project: ProjectDefinition } {
  const applications = [...workspace.projects.entries()].filter(
    ([, project]) => project.extensions['projectType'] === 'application',
  );
  if (applications.length !== 1) {
    refuse(
      applications.length === 0
        ? 'The workspace has no application project.'
        : `The workspace has ${applications.length} application projects (${applications
            .map(([name]) => name)
            .join(
              ', ',
            )}), and the configuration ng add writes at the workspace root serves one. Run thoth init in the directory of each application instead.`,
    );
  }
  const [name, project] = applications[0] as [string, ProjectDefinition];
  if (typeof requested === 'string' && requested !== name) {
    refuse(
      `--project names ${JSON.stringify(requested)}, and the workspace's application is ${JSON.stringify(name)}.`,
    );
  }
  return { name, project };
}

/** Each of `build`, `serve` and `test`: already Thoth's, Angular's and about to be, or absent. */
type TargetState = 'thoth' | 'angular' | 'absent';

function targetStates(
  project: ProjectDefinition,
): Readonly<Record<Command, TargetState>> {
  const states = {} as Record<Command, TargetState>;
  for (const command of COMMANDS) {
    const target = project.targets.get(command);
    states[command] =
      target === undefined
        ? 'absent'
        : target.builder === THOTH_BUILDER(command)
          ? 'thoth'
          : 'angular';
    if (
      states[command] === 'angular' &&
      project.targets.has(ANGULAR_TARGET(command))
    ) {
      refuse(
        `angular.json already has a target named ${ANGULAR_TARGET(command)}, which is the name ng add gives the Angular ${command} target. Rename it and run ng add again.`,
      );
    }
  }
  if (states.build === 'absent') {
    refuse('The application has no build target in angular.json.');
  }
  return states;
}

/** The Angular target that builds the application, wherever `ng add` has left it. */
function angularBuildTarget(
  name: string,
  project: ProjectDefinition,
  states: Readonly<Record<Command, TargetState>>,
): TargetDefinition {
  const build = project.targets.get('build') as TargetDefinition;
  if (states.build === 'angular') return build;
  const reference = build.options?.[ANGULAR_TARGET_OPTION.build];
  const target =
    typeof reference === 'string'
      ? targetFromTargetString(reference, name, 'build')
      : undefined;
  const found =
    target !== undefined && target.project === name
      ? project.targets.get(target.target)
      : undefined;
  if (found === undefined) {
    refuse(
      `The build target runs ${THOTH_BUILDER('build')}, and its buildTarget names no target of ${name}.`,
    );
  }
  return found;
}

/** A source file of the application, parsed, or a refusal naming it. */
function sourceFile(tree: Tree, path: string): ts.SourceFile {
  const text = tree.readText(path);
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
}

/** The local name a module's export is imported under at the top of a file. */
function importedName(
  file: ts.SourceFile,
  exportName: string,
  moduleName: string,
): string | undefined {
  for (const statement of file.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== moduleName
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if ((element.propertyName ?? element.name).text === exportName) {
        return element.name.text;
      }
    }
  }
  return undefined;
}

/** Every call in a file to the function a module exports. */
function callsTo(
  file: ts.SourceFile,
  exportName: string,
  moduleName: string,
): readonly ts.CallExpression[] {
  const local = importedName(file, exportName, moduleName);
  if (local === undefined) return [];
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === local
    ) {
      calls.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return calls;
}

/** The file a relative import of a local name points at, resolved the way the compiler resolves it. */
function importedFile(
  tree: Tree,
  file: ts.SourceFile,
  localName: string,
): string | undefined {
  for (const statement of file.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !statement.moduleSpecifier.text.startsWith('.')
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    if (!bindings.elements.some((element) => element.name.text === localName)) {
      continue;
    }
    const directory = file.fileName.slice(0, file.fileName.lastIndexOf('/'));
    const base = joinPath(directory, statement.moduleSpecifier.text);
    for (const candidate of [base, `${base}.ts`, `${base}/index.ts`]) {
      if (candidate.endsWith('.ts') && tree.exists(candidate)) return candidate;
    }
  }
  return undefined;
}

function joinPath(directory: string, relative: string): string {
  const parts = directory.split('/');
  for (const segment of relative.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') parts.pop();
    else parts.push(segment);
  }
  return parts.join('/');
}

/**
 * The file holding the configuration a main file bootstraps with, `app.config.ts` in an application
 * `ng new` made.
 */
function bootstrapConfigFile(tree: Tree, mainPath: string): string {
  if (!tree.exists(mainPath)) {
    refuse(`The application's main file ${mainPath} does not exist.`);
  }
  const main = sourceFile(tree, mainPath);
  const [bootstrap] = callsTo(
    main,
    'bootstrapApplication',
    '@angular/platform-browser',
  );
  const config = bootstrap?.arguments[1];
  const path =
    config !== undefined && ts.isIdentifier(config)
      ? importedFile(tree, main, config.text)
      : undefined;
  if (path === undefined) {
    refuse(
      `${mainPath} does not bootstrap a standalone application with a configuration imported from a file of its own, which is how ng new writes it and the file ng add adds the providers to.`,
    );
  }
  return path;
}

/** One replacement in a file, applied through the tree's recorder with the others. */
interface TextEdit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

function applyEdits(tree: Tree, path: string, edits: readonly TextEdit[]) {
  // In the file's own line endings, which on Windows the CLI's templates give it.
  const newline = tree.readText(path).includes('\r\n') ? '\r\n' : '\n';
  const recorder = tree.beginUpdate(path);
  for (const { start, end, text } of edits) {
    const edit = { start, end, text: text.replaceAll(/\r?\n/gu, newline) };
    if (edit.end > edit.start)
      recorder.remove(edit.start, edit.end - edit.start);
    if (edit.text.length > 0) recorder.insertLeft(edit.start, edit.text);
  }
  tree.commitUpdate(recorder);
}

/** The edits that take one export out of a file's import of a module, and the declaration with it. */
function removeImport(
  file: ts.SourceFile,
  exportName: string,
  moduleName: string,
  replacement: string,
): readonly TextEdit[] {
  for (const statement of file.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== moduleName
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    const index = bindings.elements.findIndex(
      (element) => (element.propertyName ?? element.name).text === exportName,
    );
    if (index < 0) continue;
    if (
      bindings.elements.length === 1 &&
      statement.importClause?.name === undefined
    ) {
      return [
        {
          start: statement.getStart(),
          end: statement.getEnd(),
          text: replacement,
        },
      ];
    }
    const element = bindings.elements[index] as ts.ImportSpecifier;
    const next = bindings.elements[index + 1];
    const previous = bindings.elements[index - 1];
    const removal =
      next !== undefined
        ? { start: element.getStart(), end: next.getStart() }
        : {
            start: (previous as ts.ImportSpecifier).getEnd(),
            end: element.getEnd(),
          };
    return [
      { ...removal, text: '' },
      {
        start: statement.getEnd(),
        end: statement.getEnd(),
        text: `\n${replacement}`,
      },
    ];
  }
  return [];
}

/** An import placed after the last one in a file. */
function addImport(file: ts.SourceFile, text: string): TextEdit {
  const imports = file.statements.filter(ts.isImportDeclaration);
  const end = imports.length === 0 ? 0 : (imports.at(-1) as ts.Node).getEnd();
  return { start: end, end, text: end === 0 ? `${text}\n` : `\n${text}` };
}

function quoted(value: string): string {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
}

/** What the browser configuration needs: the router replaced, and whether the localization provider is there. */
interface BrowserConfigPlan {
  readonly path: string;
  readonly replaceRouter: boolean;
  readonly addLocalization: boolean;
}

function browserConfigPlan(tree: Tree, path: string): BrowserConfigPlan {
  const file = sourceFile(tree, path);
  const angularRouters = callsTo(file, 'provideRouter', '@angular/router');
  const localizedRouters = callsTo(
    file,
    'provideLocalizedRouter',
    '@neolorn/thoth/router',
  );
  const localization = callsTo(file, 'provideLocalization', '#i18n');
  if (angularRouters.length + localizedRouters.length === 0) {
    refuse(
      `${path} provides no router. Thoth localizes the addresses the Router serves, so provide one with provideRouter(routes) and run ng add again.`,
    );
  }
  if (angularRouters.length + localizedRouters.length > 1) {
    refuse(
      `${path} provides the router more than once. Keep one provideRouter call and run ng add again.`,
    );
  }
  if (localization.length > 1) {
    refuse(`${path} calls provideLocalization more than once.`);
  }
  return {
    path,
    replaceRouter: angularRouters.length === 1,
    addLocalization: localization.length === 0,
  };
}

/** `provideRouter(routes, ...features)` becomes `provideLocalizedRouter(routes, options, ...features)`. */
function replaceRouter(origin: string | undefined, path: string): Rule {
  return (tree) => {
    const file = sourceFile(tree, path);
    const [call] = callsTo(file, 'provideRouter', '@angular/router');
    if (call === undefined) return;
    const [routes, ...features] = call.arguments;
    const options =
      origin === undefined ? '{}' : `{ origin: ${quoted(origin)} }`;
    const argumentsText = [
      ...(routes === undefined ? ['[]'] : [routes.getText()]),
      ...(origin !== undefined || features.length > 0 ? [options] : []),
      ...features.map((feature) => feature.getText()),
    ].join(', ');
    applyEdits(tree, path, [
      {
        start: call.getStart(),
        end: call.getEnd(),
        text: `provideLocalizedRouter(${argumentsText})`,
      },
      ...removeImport(
        file,
        'provideRouter',
        '@angular/router',
        "import { provideLocalizedRouter } from '@neolorn/thoth/router';",
      ),
    ]);
    if (
      importedName(
        sourceFile(tree, path),
        'provideLocalizedRouter',
        '@neolorn/thoth/router',
      ) === undefined
    ) {
      applyEdits(tree, path, [
        addImport(
          sourceFile(tree, path),
          "import { provideLocalizedRouter } from '@neolorn/thoth/router';",
        ),
      ]);
    }
  };
}

/**
 * What the server configuration needs, where the application renders on the server.
 *
 * `ng new --ssr` writes `provideServerRendering(withRoutes(serverRoutes))` and a `serverRoutes`
 * table of one entry, `**`. Thoth's call takes the place of both, because it derives the localized
 * server routes from the generated route table; a table of routes declared by path cannot be carried
 * over to routes declared by identity, so one that is not the CLI's is refused rather than lost.
 */
interface ServerConfigPlan {
  readonly path: string;
  readonly routesPath?: string;
}

function serverConfigPlan(
  tree: Tree,
  serverMainPath: string,
): ServerConfigPlan | undefined {
  if (!tree.exists(serverMainPath)) {
    refuse(`The application's server entry ${serverMainPath} does not exist.`);
  }
  const main = sourceFile(tree, serverMainPath);
  const [bootstrap] = callsTo(
    main,
    'bootstrapApplication',
    '@angular/platform-browser',
  );
  const config = bootstrap?.arguments[1];
  const path =
    config !== undefined && ts.isIdentifier(config)
      ? importedFile(tree, main, config.text)
      : undefined;
  if (path === undefined) {
    refuse(
      `${serverMainPath} does not bootstrap with a configuration imported from a file of its own, which is how ng new writes app.config.server.ts.`,
    );
  }
  const file = sourceFile(tree, path);
  if (
    callsTo(file, 'provideLocalizedServerRendering', '@neolorn/thoth/ssr')
      .length > 0
  ) {
    return undefined;
  }
  const rendering = callsTo(file, 'provideServerRendering', '@angular/ssr');
  const [only] = rendering;
  const [feature] = only?.arguments ?? [];
  const withRoutes = importedName(file, 'withRoutes', '@angular/ssr');
  const routes =
    rendering.length === 1 &&
    only?.arguments.length === 1 &&
    feature !== undefined &&
    ts.isCallExpression(feature) &&
    ts.isIdentifier(feature.expression) &&
    feature.expression.text === withRoutes &&
    feature.arguments.length === 1
      ? feature.arguments[0]
      : undefined;
  if (routes === undefined || !ts.isIdentifier(routes)) {
    refuse(
      `${path} does not install server rendering as provideServerRendering(withRoutes(serverRoutes)), the form ng new writes and the one provideLocalizedServerRendering takes the place of.`,
    );
  }
  const routesPath = importedFile(tree, file, routes.text);
  if (routesPath === undefined || !cliServerRoutes(tree, routesPath)) {
    refuse(
      `${routesPath ?? path} declares server routes of its own. Thoth declares them by route identity in provideLocalizedServerRendering, so they cannot be carried over by ng add; restore the single ** entry ng new wrote, run ng add again, and declare them as the server rendering guide shows.`,
    );
  }
  return { path, routesPath };
}

/** Whether a server routes file is the one `ng new` writes: one `**` entry and nothing else. */
function cliServerRoutes(tree: Tree, path: string): boolean {
  const file = sourceFile(tree, path);
  const declarations = file.statements.filter(
    (statement) => !ts.isImportDeclaration(statement),
  );
  if (declarations.length !== 1) return false;
  const [statement] = declarations;
  if (statement === undefined || !ts.isVariableStatement(statement))
    return false;
  const [declaration] = statement.declarationList.declarations;
  const value = declaration?.initializer;
  if (
    statement.declarationList.declarations.length !== 1 ||
    value === undefined ||
    !ts.isArrayLiteralExpression(value) ||
    value.elements.length !== 1
  ) {
    return false;
  }
  const [entry] = value.elements;
  if (entry === undefined || !ts.isObjectLiteralExpression(entry)) return false;
  const names = entry.properties.map((property) =>
    property.name !== undefined && ts.isIdentifier(property.name)
      ? property.name.text
      : '',
  );
  const path_ = entry.properties.find(
    (property) =>
      property.name !== undefined &&
      ts.isIdentifier(property.name) &&
      property.name.text === 'path',
  );
  return (
    names.length === 2 &&
    names.includes('renderMode') &&
    path_ !== undefined &&
    ts.isPropertyAssignment(path_) &&
    ts.isStringLiteral(path_.initializer) &&
    path_.initializer.text === '**'
  );
}

/** `provideServerRendering(withRoutes(serverRoutes))` becomes Thoth's call, and the table goes. */
function replaceServerRendering(
  plan: ServerConfigPlan,
  origin: string | undefined,
  urlPolicy: unknown,
): Rule {
  return (tree) => {
    const file = sourceFile(tree, plan.path);
    const [call] = callsTo(file, 'provideServerRendering', '@angular/ssr');
    if (call === undefined) return;
    const renderMode =
      importedName(file, 'RenderMode', '@angular/ssr') ?? 'RenderMode';
    const options = [
      `canonicalRenderMode: ${renderMode}.Server`,
      `fallback: ${renderMode}.Server`,
      ...(urlPolicy === 'locale-host' && origin !== undefined
        ? [`origin: ${quoted(origin)}`]
        : []),
    ];
    const lineStart = file.text.lastIndexOf('\n', call.getStart()) + 1;
    const indent = /^[ \t]*/u.exec(file.text.slice(lineStart))?.[0] ?? '';
    const edits: TextEdit[] = [
      {
        start: call.getStart(),
        end: call.getEnd(),
        text: `provideLocalizedServerRendering(localizationSetup, [], {\n${options
          .map((option) => `${indent}  ${option},`)
          .join('\n')}\n${indent}})`,
      },
    ];
    // The `@angular/ssr` import keeps `RenderMode` and loses the two names Thoth's call replaces.
    for (const statement of file.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(statement.moduleSpecifier)
      ) {
        continue;
      }
      const module = statement.moduleSpecifier.text;
      const bindings = statement.importClause?.namedBindings;
      if (
        module === '@angular/ssr' &&
        bindings !== undefined &&
        ts.isNamedImports(bindings)
      ) {
        const kept = bindings.elements
          .map((element) => element.getText())
          .filter(
            (text) => !/^(?:provideServerRendering|withRoutes)$/u.test(text),
          );
        if (!kept.includes(renderMode)) kept.push(renderMode);
        edits.push({
          start: statement.getStart(),
          end: statement.getEnd(),
          text: `import { ${kept.join(', ')} } from '@angular/ssr';\nimport { provideLocalizedServerRendering } from '@neolorn/thoth/ssr';\nimport { localizationSetup } from '#i18n';`,
        });
      }
      if (
        plan.routesPath !== undefined &&
        module.startsWith('.') &&
        bindings !== undefined &&
        ts.isNamedImports(bindings) &&
        bindings.elements.length === 1 &&
        importedFile(
          tree,
          file,
          (bindings.elements[0] as ts.ImportSpecifier).name.text,
        ) === plan.routesPath
      ) {
        const lineEnd = /^\r?\n/u.exec(file.text.slice(statement.getEnd()));
        edits.push({
          start: statement.getStart(),
          end: statement.getEnd() + (lineEnd?.[0].length ?? 0),
          text: '',
        });
      }
    }
    applyEdits(tree, plan.path, edits);
    if (plan.routesPath !== undefined) tree.delete(plan.routesPath);
  };
}

/**
 * A target string that names the application's `build` target, renamed to the Angular one.
 *
 * Read with Angular's own defaults, so `::development`, which the dev server and the unit-test
 * builder take when they are given nothing, is recognised as `build`.
 */
function renamedBuildReference(name: string, reference: string): string {
  const target = targetFromTargetString(reference, name, 'build');
  if (target.project !== name || target.target !== 'build') return reference;
  return [name, ANGULAR_TARGET('build'), target.configuration]
    .filter((part) => part !== undefined && part !== '')
    .join(':');
}

/**
 * `build`, `serve` and `test` become Thoth's builders, each running the Angular target it was,
 * renamed `angular-build`, `angular-serve` and `angular-test`, with every configuration carried.
 */
function rewriteTargets(
  name: string,
  states: Readonly<Record<Command, TargetState>>,
): Rule {
  return angularUtility().updateWorkspace((workspace) => {
    const project = workspace.projects.get(name) as ProjectDefinition;
    const renamed = new Map<Command, TargetDefinition>();
    for (const command of COMMANDS) {
      if (states[command] !== 'angular') continue;
      renamed.set(command, project.targets.get(command) as TargetDefinition);
    }
    if (renamed.size === 0) return;
    // Every reference to the build target is a reference to the Angular one now, because what
    // reads it, the dev server and the unit-test builder among them, reads an application
    // target's options and the Thoth target has only the reference.
    for (const [, target] of project.targets) {
      if (target.builder.startsWith('@neolorn/thoth-toolkit:')) continue;
      const sections = [
        target.options ?? {},
        ...Object.values(target.configurations ?? {}),
      ];
      for (const section of sections) {
        if (section === undefined) continue;
        const reference = section['buildTarget'];
        if (typeof reference === 'string') {
          section['buildTarget'] = renamedBuildReference(name, reference);
        }
      }
      if (
        BUILD_TARGET_READERS.has(target.builder) &&
        target.options?.['buildTarget'] === undefined
      ) {
        const fallback =
          target.builder === '@angular/build:extract-i18n'
            ? `${name}:${ANGULAR_TARGET('build')}`
            : `${name}:${ANGULAR_TARGET('build')}:development`;
        target.options = { ...(target.options ?? {}), buildTarget: fallback };
      }
    }
    for (const [command, angular] of renamed) {
      const option = ANGULAR_TARGET_OPTION[command];
      const reference = `${name}:${ANGULAR_TARGET(command)}`;
      const configurations = Object.fromEntries(
        Object.keys(angular.configurations ?? {}).map((configuration) => [
          configuration,
          { [option]: `${reference}:${configuration}` },
        ]),
      );
      project.targets.set(command, {
        builder: THOTH_BUILDER(command),
        options: { [option]: reference },
        ...(Object.keys(configurations).length === 0 ? {} : { configurations }),
        ...(angular.defaultConfiguration === undefined
          ? {}
          : { defaultConfiguration: angular.defaultConfiguration }),
      });
      project.targets.add({ name: ANGULAR_TARGET(command), ...angular });
    }
  });
}

/** The configuration and the package entries, written through the tree the way `thoth init` writes them to disk. */
function writeInitialization(
  plan: {
    readonly configurationSource: string;
    readonly packageSource: string;
  },
  newline: string,
): Rule {
  return (tree) => {
    const configurationPath = 'thoth.config.json';
    if (!tree.exists(configurationPath)) {
      tree.create(configurationPath, plan.configurationSource);
    } else if (tree.readText(configurationPath) !== plan.configurationSource) {
      tree.overwrite(configurationPath, plan.configurationSource);
    }
    const current = tree.readText('package.json');
    const { packageSource } = plan;
    const styled = packageSource.replaceAll(/\r?\n/gu, newline);
    if (current !== styled) tree.overwrite('package.json', styled);
  };
}

/** The `ng-add` schematic. */
export default function ngAdd(
  options: Readonly<Record<string, unknown>>,
): Rule {
  return async (tree, context) => {
    const { applicationGeneratedRoot, planInitialization } =
      await import('./project-host.js');
    const utility = angularUtility();
    const workspace = await utility.readWorkspace(tree);
    const { name, project } = selectedProject(workspace, options['project']);
    const states = targetStates(project);
    const angularBuild = angularBuildTarget(name, project, states);
    const buildOptions = angularBuild.options ?? {};
    const sourceRoot = project.sourceRoot ?? joinPath(project.root, 'src');
    const mainPath = normalizedPath(
      typeof buildOptions['browser'] === 'string'
        ? buildOptions['browser']
        : typeof buildOptions['main'] === 'string'
          ? buildOptions['main']
          : joinPath(sourceRoot, 'main.ts'),
    );

    if (!tree.exists('package.json')) {
      refuse('The workspace has no package.json.');
    }
    const originalPackage = tree.readText('package.json');
    const given = requestedConfiguration(options);
    const configurationSource = tree.exists('thoth.config.json')
      ? tree.readText('thoth.config.json')
      : undefined;
    // On a project that has a configuration, the fields given are laid over the ones it declares,
    // because the Angular CLI hands the schematic the schema's defaults even when nothing is typed:
    // a field equal to the declared one changes nothing, and one that differs is a conflict.
    const declared =
      configurationSource === undefined || Object.keys(given).length === 0
        ? undefined
        : planInitialization({
            configurationSource,
            packageSource: originalPackage,
            generatedRootPath: applicationGeneratedRoot(project.root),
          });
    if (declared !== undefined && !declared.ok) {
      refuse(diagnosticsText(declared.diagnostics));
    }
    // The fields as the file writes them, which the check above has just admitted, rather than the
    // parsed configuration, whose defaults a request may not restate.
    const { schemaVersion: _version, ...written } =
      declared === undefined || configurationSource === undefined
        ? {}
        : (JSON.parse(configurationSource) as Record<string, unknown>);
    const requested = { ...written, ...given } as InitConfiguration;
    if (configurationSource === undefined) {
      const missing = missingFields(requested);
      if (missing.length > 0) {
        refuse(
          `ng add @neolorn/thoth-toolkit needs ${missing.join(', ')}. On a terminal it asks for each of them.`,
        );
      }
    }
    const plan = planInitialization({
      ...(Object.keys(requested).length === 0
        ? {}
        : { configuration: requested }),
      ...(configurationSource === undefined ? {} : { configurationSource }),
      packageSource: originalPackage,
      generatedRootPath: applicationGeneratedRoot(project.root),
    });
    if (!plan.ok) refuse(diagnosticsText(plan.diagnostics));
    const urlPolicy = plan.value.configuration.urlPolicy;
    if (urlPolicy === undefined) {
      refuse(
        'thoth.config.json declares no urlPolicy, and the routing ng add sets up reads it. Pass --url-policy.',
      );
    }

    const browser = browserConfigPlan(
      tree,
      bootstrapConfigFile(tree, mainPath),
    );
    const serverMain = buildOptions['server'];
    const server =
      typeof serverMain === 'string'
        ? serverConfigPlan(tree, normalizedPath(serverMain))
        : undefined;
    const origin =
      typeof options['origin'] === 'string' ? options['origin'] : undefined;
    const rendersOnServer = typeof serverMain === 'string';
    if (rendersOnServer && browser.replaceRouter && origin === undefined) {
      refuse(
        'The application renders on the server, where the canonical link and the hreflang alternates of every page are composed from the origin it is published at. Pass it with --origin, such as --origin https://example.com.',
      );
    }

    const newline = /\r\n/u.test(originalPackage) ? '\r\n' : '\n';
    const version = await toolkitVersion();
    if (browser.addLocalization && states.build === 'thoth') {
      refuse(
        `The build target already runs ${THOTH_BUILDER('build')}, and ${browser.path} has no provideLocalization. Add provideLocalization(withRouting()) to its providers, from #i18n and @neolorn/thoth, and run ng add again.`,
      );
    }
    const recovery = [
      plan.value.configuration.recoveryMessage,
      plan.value.configuration.recoveryRetry,
    ].filter((key) => key !== undefined);
    context.logger.info(
      `Thoth is set up. The messages are yours to write, one file per scope and locale at i18n/<scope>/<locale>.yaml${
        recovery.length === 0
          ? '.'
          : `, beginning with the ones thoth.config.json names for the recovery screen: ${recovery.join(' and ')}.`
      }`,
    );
    return devkitSchematics().chain([
      utility.addDependency('@neolorn/thoth', `^${version}`, {
        type: utility.DependencyType.Default,
        existing: utility.ExistingBehavior.Skip,
      }),
      (current) => {
        // `addDependency` writes the manifest in its own style, so the entries `thoth init` owns are
        // merged into what it left, and the file's line endings are put back.
        const merged = planInitialization({
          ...(Object.keys(requested).length === 0
            ? {}
            : { configuration: requested }),
          ...(configurationSource === undefined ? {} : { configurationSource }),
          packageSource: current.readText('package.json'),
          generatedRootPath: applicationGeneratedRoot(project.root),
        });
        if (!merged.ok) refuse(diagnosticsText(merged.diagnostics));
        return writeInitialization(
          {
            configurationSource:
              configurationSource ?? merged.value.configurationSource,
            packageSource: merged.value.packageSource,
          },
          newline,
        );
      },
      browser.replaceRouter
        ? replaceRouter(origin, browser.path)
        : () => undefined,
      browser.addLocalization
        ? utility.addRootProvider(
            name,
            ({ code, external }) =>
              code`${external('provideLocalization', '#i18n')}(${external('withRouting', '@neolorn/thoth')}())`,
          )
        : () => undefined,
      server === undefined
        ? () => undefined
        : replaceServerRendering(server, origin, urlPolicy),
      rewriteTargets(name, states),
    ]);
  };
}

function normalizedPath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//u, '');
}
