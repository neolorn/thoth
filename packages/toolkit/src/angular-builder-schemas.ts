/**
 * The options each Thoth Angular builder takes, as the JSON Schema the Angular CLI reads.
 *
 * Kept apart from the builders, which load `@angular-devkit/architect`, so the toolkit's staging
 * can write these schemas into the package without loading an Angular package.
 */

/** The JSON Schema draft the Angular CLI validates builder options with. */
const OPTION_SCHEMA_DRAFT = 'http://json-schema.org/draft-07/schema';

/**
 * The target string grammar Angular's own builders accept for `buildTarget`, so a value that
 * works there works here.
 */
const TARGET_PATTERN = '^[^:\\s]*:[^:\\s]*(:[^\\s]+)?$';

/** One of the three commands, and what its builder is called in a workspace file. */
export type AngularCommand = 'build' | 'serve' | 'test';

/** What every Thoth builder is given: the Angular target to run, and for two of them, `watch`. */
export interface AngularBuilderOptions {
  readonly target: string;
  readonly watch?: boolean;
}

const TARGET_OPTION: Readonly<Record<AngularCommand, string>> = Object.freeze({
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
 * Closed, so a mistyped option is refused by the Angular CLI before anything runs. `watch` is on
 * the two commands Angular gives a `watch` option, so `ng build --watch` and `ng test --watch=false`
 * mean what they mean without Thoth.
 */
export function angularBuilderSchema(
  command: AngularCommand,
): Readonly<Record<string, unknown>> {
  const targetOption = TARGET_OPTION[command];
  const properties: Record<string, unknown> = {
    [targetOption]: {
      type: 'string',
      description: TARGET_DESCRIPTION[command],
      pattern: TARGET_PATTERN,
    },
  };
  if (command !== 'serve') {
    properties['watch'] = {
      type: 'boolean',
      description:
        command === 'build'
          ? 'Rebuild when files change, and regenerate when the catalogs or the application change. Passed on to the Angular target.'
          : 'Run the tests again when files change, and regenerate when the catalogs or the application change. Passed on to the Angular target.',
    };
  }
  return Object.freeze({
    $schema: OPTION_SCHEMA_DRAFT,
    title: `Thoth ${command}`,
    description: `Generates the Thoth modules, then runs an Angular ${command} target.`,
    type: 'object',
    properties,
    required: [targetOption],
    additionalProperties: false,
  });
}

/** The builder's options as the schema admitted them, read back into one shape. */
export function angularBuilderOptions(
  command: AngularCommand,
  options: Readonly<Record<string, unknown>>,
): AngularBuilderOptions {
  const target = options[TARGET_OPTION[command]];
  const watch = options['watch'];
  return Object.freeze({
    target: typeof target === 'string' ? target : '',
    ...(typeof watch === 'boolean' ? { watch } : {}),
  });
}
