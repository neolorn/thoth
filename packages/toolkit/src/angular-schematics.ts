/**
 * The part of the Angular schematics API the `ng-add` schematic uses, behind a toolkit-owned type.
 *
 * `@angular-devkit/schematics` and `@schematics/angular/utility` are loaded as the Angular CLI
 * loads them, with `require`, and typed here by the members the schematic calls rather than by
 * their own declaration files. Those files do not compile under `exactOptionalPropertyTypes`
 * (`CollectionImpl.baseDescriptions` in `@angular-devkit/schematics` 22.2.1 declares an optional
 * member that admits `undefined`, which its interface does not), and the toolkit compiles with that
 * option and checks library declarations under it. Every member named here is one the Angular
 * schematics documentation and the utility's own declarations publish.
 */

import { createRequire } from 'node:module';

/** A change to one file, committed with the others. */
export interface UpdateRecorder {
  insertLeft(index: number, content: string): UpdateRecorder;
  remove(index: number, length: number): UpdateRecorder;
}

/** The files a schematic reads and writes, committed together when it ends. */
export interface Tree {
  exists(path: string): boolean;
  readText(path: string): string;
  create(path: string, content: string): void;
  overwrite(path: string, content: string): void;
  delete(path: string): void;
  beginUpdate(path: string): UpdateRecorder;
  commitUpdate(recorder: UpdateRecorder): void;
}

export interface SchematicContext {
  readonly logger: { info(message: string): void };
}

/** What a schematic step returns: nothing, a tree, or a further step. */
export type Rule = (
  tree: Tree,
  context: SchematicContext,
) => Tree | Rule | void | Promise<Tree | Rule | void>;

/** A target in `angular.json`. */
export interface TargetDefinition {
  builder: string;
  options?: Record<string, unknown>;
  configurations?: Record<string, Record<string, unknown> | undefined>;
  defaultConfiguration?: string;
}

/** The targets of one project, in the order `angular.json` lists them. */
export interface TargetDefinitionCollection extends ReadonlyMap<
  string,
  TargetDefinition
> {
  add(definition: { readonly name: string } & TargetDefinition): unknown;
  set(name: string, value: TargetDefinition): unknown;
}

/** A project in `angular.json`. */
export interface ProjectDefinition {
  readonly extensions: Record<string, unknown>;
  readonly targets: TargetDefinitionCollection;
  root: string;
  sourceRoot?: string;
}

export interface WorkspaceDefinition {
  readonly projects: ReadonlyMap<string, ProjectDefinition>;
}

/** The helpers `addRootProvider` hands its callback, for an expression and the imports it needs. */
export interface CodeBlock {
  code(strings: TemplateStringsArray, ...values: unknown[]): unknown;
  external(name: string, moduleSpecifier: string): unknown;
}

interface DevkitSchematics {
  readonly SchematicsException: new (message: string) => Error;
  chain(rules: readonly Rule[]): Rule;
}

interface AngularUtility {
  readonly DependencyType: { readonly Default: string };
  readonly ExistingBehavior: { readonly Skip: number };
  readWorkspace(tree: Tree): Promise<WorkspaceDefinition>;
  updateWorkspace(
    updater: (workspace: WorkspaceDefinition) => void | Promise<void>,
  ): Rule;
  addDependency(
    name: string,
    specifier: string,
    options: { readonly type: string; readonly existing: number },
  ): Rule;
  addRootProvider(
    project: string,
    callback: (block: CodeBlock) => unknown,
  ): Rule;
}

const load = createRequire(import.meta.url);

/** `@angular-devkit/schematics`, loaded when the schematic runs. */
export function devkitSchematics(): DevkitSchematics {
  return load('@angular-devkit/schematics') as DevkitSchematics;
}

/** `@schematics/angular/utility`, loaded when the schematic runs. */
export function angularUtility(): AngularUtility {
  return load('@schematics/angular/utility') as AngularUtility;
}
