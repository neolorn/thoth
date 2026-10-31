/**
 * The Architect a Thoth builder runs its Angular target through, made as the Angular CLI makes its
 * own for that target.
 *
 * The Angular CLI validates a builder's options through a schema registry it chooses by the
 * builder's name (`ArchitectBaseCommandModule.getArchitect` in `@angular/cli`): for one of
 * `@angular/build`'s it fills in every object option the command does not give, and for any other
 * builder every array option too. A Thoth builder is never one of `@angular/build`'s, so its own
 * Architect fills arrays, and a target it ran through that Architect would have them filled as well:
 * an empty `conditions`, for one, which Angular's application builder takes as a list of custom
 * conditions and so drops its default ones. Run through an Architect of its own, made for the
 * target's builder, the target runs as `ng run` runs it.
 *
 * Only what is published is used: `Architect` and `WorkspaceNodeModulesArchitectHost`, the host
 * class the Angular CLI uses, from `@angular-devkit/architect`, and the schema registry, its
 * transforms and `workspaces.readWorkspace` from `@angular-devkit/core`.
 */

import {
  Architect,
  targetStringFromTarget,
  type BuilderContext,
  type BuilderRun,
  type Target,
} from '@angular-devkit/architect';
import { WorkspaceNodeModulesArchitectHost } from '@angular-devkit/architect/node/index.js';
import { json, workspaces } from '@angular-devkit/core';
import { readFile, stat } from 'node:fs/promises';

/** The builders the Angular CLI validates without filling in array options. */
const ANGULAR_BUILD_BUILDERS = '@angular/build:';

/**
 * The schema registry the Angular CLI validates a builder's options through, chosen by the
 * builder's name as `@angular/cli` 22.2.1 chooses it. `warn` takes the deprecation notices the
 * Angular CLI writes as warnings.
 */
export function angularCliRegistry(
  builderName: string,
  warn: (message: string) => void,
): json.schema.CoreSchemaRegistry {
  const registry = new json.schema.CoreSchemaRegistry();
  registry.addPostTransform(
    builderName.startsWith(ANGULAR_BUILD_BUILDERS)
      ? json.schema.transforms.addUndefinedObjectDefaults
      : json.schema.transforms.addUndefinedDefaults,
  );
  registry.useXDeprecatedProvider(warn);
  return registry;
}

/** Runs an Angular target with overrides, as `BuilderContext.scheduleTarget` does. */
export type AngularTargetScheduler = (
  context: BuilderContext,
  target: Target,
  overrides: json.JsonObject,
) => Promise<BuilderRun>;

/** The file system the workspace file is read through, as the Angular CLI reads it. */
const workspaceFiles: workspaces.WorkspaceHost = {
  readFile: (path) => readFile(path, 'utf-8'),
  writeFile: () =>
    Promise.reject(new Error('A Thoth builder never writes angular.json.')),
  isDirectory: (path) =>
    stat(path).then(
      (stats) => stats.isDirectory(),
      () => false,
    ),
  isFile: (path) =>
    stat(path).then(
      (stats) => stats.isFile(),
      () => false,
    ),
};

/** What an Architect reads the workspace and its builders through. */
export type ArchitectHost = ConstructorParameters<typeof Architect>[0];

/**
 * A scheduler that runs the target through an Architect over the host `hostFor` gives, with the
 * registry the Angular CLI would choose for the target's builder. Its log goes to the builder's
 * own, as a target scheduled through the builder's context logs.
 */
export function angularTargetScheduler(
  hostFor: (context: BuilderContext) => Promise<ArchitectHost>,
): AngularTargetScheduler {
  return async (context, target, overrides) => {
    const host = await hostFor(context);
    const builderName = await host.getBuilderNameForTarget(target);
    if (builderName === null) {
      throw new Error(
        `No builder is set for ${targetStringFromTarget(target)}.`,
      );
    }
    const architect = new Architect(
      host,
      angularCliRegistry(builderName, (message) =>
        context.logger.warn(message),
      ),
    );
    return architect.scheduleTarget(target, overrides, {
      logger: context.logger.createChild(''),
    });
  };
}

/**
 * The host the Angular CLI makes for a command: its host class, over the workspace file it reads
 * from the workspace root.
 */
async function workspaceArchitectHost(
  context: BuilderContext,
): Promise<ArchitectHost> {
  const { workspace } = await workspaces.readWorkspace(
    context.workspaceRoot,
    workspaceFiles,
    workspaces.WorkspaceFormat.JSON,
  );
  return new WorkspaceNodeModulesArchitectHost(
    workspace,
    context.workspaceRoot,
  );
}

/** Runs the target as `ng run` runs it, over the workspace the command runs in. */
export const scheduleAngularTarget: AngularTargetScheduler =
  angularTargetScheduler(workspaceArchitectHost);
