/**
 * The options each Thoth Angular builder takes, as the JSON Schema the Angular CLI reads.
 *
 * Kept apart from the builders, which load `@angular-devkit/architect`, so the toolkit's staging
 * can write these schemas into the package without loading an Angular package.
 */

import { WRAPPED_BUILDER_OPTIONS } from './angular-builder-options.generated.js';

/** The JSON Schema draft the Angular CLI validates builder options with. */
const OPTION_SCHEMA_DRAFT = 'http://json-schema.org/draft-07/schema';

/**
 * The target string grammar Angular's own builders accept for `buildTarget`, so a value that
 * works there works here.
 */
const TARGET_PATTERN = '^[^:\\s]*:[^:\\s]*(:[^\\s]+)?$';

/** One of the three commands, and what its builder is called in a workspace file. */
export type AngularCommand = 'build' | 'serve' | 'test';

/**
 * What every Thoth builder is given: the Angular target to run, for two of them `watch`, whether to
 * generate the pseudo-locales, and the options of the Angular builder it was given, which it passes
 * on.
 */
export interface AngularBuilderOptions {
  readonly target: string;
  readonly watch?: boolean;
  readonly pseudoLocales?: boolean;
  /** Every option of the Angular builder the builder was given, `watch` included. */
  readonly angular: Readonly<Record<string, unknown>>;
}

/** The option each builder names its Angular target in. */
export const ANGULAR_TARGET_OPTION: Readonly<Record<AngularCommand, string>> =
  Object.freeze({
    build: 'buildTarget',
    serve: 'serveTarget',
    test: 'testTarget',
  });

const TARGET_DESCRIPTION: Readonly<Record<AngularCommand, string>> =
  Object.freeze({
    build:
      'The Angular build target to run once generation succeeds, as project:target[:configuration]. Its builder is usually @angular/build:application.',
    serve:
      'The Angular serve target to run once generation succeeds, as project:target[:configuration]. Its builder is usually @angular/build:dev-server.',
    test: 'The Angular test target to run once generation succeeds, as project:target[:configuration]. Its builder is usually @angular/build:unit-test.',
  });

/**
 * The option schema of each builder, which the toolkit's staging writes beside `builders.json`.
 *
 * It holds the builder's own options and every option of the Angular builder its target runs, so
 * the Angular CLI, which parses a command's options from the schema of the builder the target
 * names, accepts every option it accepts without Thoth. Those options have no default and none is
 * required, so one the command does not give is absent and the Angular target's own value stands.
 * Closed, so a mistyped option is refused by the Angular CLI before anything runs. `watch` is
 * Thoth's own on the two commands it changes the session of, so `ng build --watch` and
 * `ng test --watch=false` mean what they mean without Thoth.
 */
export function angularBuilderSchema(
  command: AngularCommand,
): Readonly<Record<string, unknown>> {
  const wrapped = WRAPPED_BUILDER_OPTIONS[command];
  return Object.freeze({
    $schema: OPTION_SCHEMA_DRAFT,
    title: `Thoth ${command}`,
    description: `Generates the Thoth modules, then runs an Angular ${command} target.`,
    type: 'object',
    properties: { ...wrapped.properties, ...ownOptions(command) },
    required: [ANGULAR_TARGET_OPTION[command]],
    additionalProperties: false,
    ...(wrapped.definitions === undefined
      ? {}
      : { definitions: wrapped.definitions }),
  });
}

/** The options the builder itself reads, which `angular.json` sets on the Thoth target. */
function ownOptions(command: AngularCommand): Record<string, unknown> {
  const own: Record<string, unknown> = {
    [ANGULAR_TARGET_OPTION[command]]: {
      type: 'string',
      description: TARGET_DESCRIPTION[command],
      pattern: TARGET_PATTERN,
    },
    // Thoth's own, and on every command, because a development run of each wants the pseudo-locales
    // and a production build must not have them. `ng add` sets it where a development run reads it.
    pseudoLocales: {
      type: 'boolean',
      description:
        'Also generate the pseudo-locales thoth.config.json declares. For development runs only: a production build must not set it.',
    },
  };
  if (command !== 'serve') {
    own['watch'] = {
      type: 'boolean',
      description:
        command === 'build'
          ? 'Rebuild when files change, and regenerate when the catalogs or the application change. Passed on to the Angular target.'
          : 'Run the tests again when files change, and regenerate when the catalogs or the application change. Passed on to the Angular target.',
    };
  }
  return own;
}

/** The options of the Angular builder a Thoth builder runs, which it passes on rather than reads. */
function angularOptionNames(command: AngularCommand): readonly string[] {
  const own = ANGULAR_TARGET_OPTION[command];
  return Object.keys(WRAPPED_BUILDER_OPTIONS[command].properties).filter(
    (name) => name !== own,
  );
}

/**
 * The Angular builder's options `angular.json` sets on the Thoth target, given that target's options
 * as the workspace file holds them.
 *
 * They belong on the Angular target, where Angular reads them for every command that runs it. The
 * Thoth builder passes on only what the command line gives, so one set on its own target would
 * otherwise be read by nothing.
 */
export function misplacedAngularOptions(
  command: AngularCommand,
  workspaceOptions: Readonly<Record<string, unknown>>,
): readonly string[] {
  const own = ownOptions(command);
  return angularOptionNames(command).filter(
    (name) => !(name in own) && workspaceOptions[name] !== undefined,
  );
}

/** The builder's options as the schema admitted them, read back into one shape. */
export function angularBuilderOptions(
  command: AngularCommand,
  options: Readonly<Record<string, unknown>>,
): AngularBuilderOptions {
  const target = options[ANGULAR_TARGET_OPTION[command]];
  const watch = options['watch'];
  const pseudoLocales = options['pseudoLocales'];
  const angular: Record<string, unknown> = {};
  for (const name of angularOptionNames(command)) {
    if (options[name] !== undefined) angular[name] = options[name];
  }
  return Object.freeze({
    target: typeof target === 'string' ? target : '',
    ...(typeof watch === 'boolean' ? { watch } : {}),
    ...(pseudoLocales === true ? { pseudoLocales } : {}),
    angular: Object.freeze(angular),
  });
}
