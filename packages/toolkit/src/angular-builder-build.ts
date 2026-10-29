/**
 * The builder `ng build` runs when the workspace points its target at `@neolorn/thoth-toolkit:build`.
 *
 * A module of its own because the Angular CLI loads a builder as a module's default export, one
 * builder to a module.
 */

import { createBuilder, type Builder } from '@angular-devkit/architect';

import { runAngularCommand } from './angular-builders.js';

const builder: Builder = createBuilder((options, context) =>
  runAngularCommand('build', options, context),
);

export default builder;
