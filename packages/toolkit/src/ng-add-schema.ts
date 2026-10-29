/**
 * The options `ng add @neolorn/thoth-toolkit` takes, as the JSON Schema the Angular CLI reads.
 *
 * Derived from the option table `thoth init` is generated from, so the two commands take the same
 * configuration flags under the same names, and a field the configuration gains is an option of
 * both on the day it lands. Kept apart from the schematic, which loads the Angular schematics
 * packages, so the toolkit's staging can write this schema without loading one.
 */

import {
  INIT_OPTIONS,
  type InitOptionDescriptor,
} from './cli-options.generated.js';

/** The JSON Schema draft the Angular CLI validates schematic options with. */
const OPTION_SCHEMA_DRAFT = 'http://json-schema.org/draft-07/schema';

/** The two recovery messages `ng add` names, which the application then writes as content. */
export const NG_ADD_RECOVERY = Object.freeze({
  recoveryMessage: 'shell/recovery-message',
  recoveryRetry: 'shell/recovery-retry',
});

/** The schematic property a configuration flag is, the flag without its dashes in camel case. */
export function ngAddProperty(option: InitOptionDescriptor): string {
  return option.flag
    .slice(2)
    .replace(/-([a-z])/gu, (_, letter: string) => letter.toUpperCase());
}

/**
 * The questions `ng add` asks on a terminal: the four fields an application cannot leave out and
 * has no default for. Every other field is an option with no question.
 */
const PROMPTS: Readonly<Record<string, unknown>> = Object.freeze({
  sourceLocale:
    'Which locale are the messages written in? Give a BCP 47 tag, such as en-US.',
  defaultLocale:
    'Which locale does a visitor get when the request asks for none the application serves?',
  locale:
    'Which locales does the application serve? List every one, the two above included, separated by spaces.',
  urlPolicy: {
    message: 'Where does an address carry the locale?',
    type: 'list',
    items: [
      {
        value: 'path-prefix',
        label: 'path-prefix: in the first path segment, as in /en-us/',
      },
      {
        value: 'locale-host',
        label: 'locale-host: in the origin, one origin per locale',
      },
      {
        value: 'locale-neutral',
        label: 'locale-neutral: nowhere, one address for every locale',
      },
    ],
  },
});

/**
 * The type the Angular CLI admits for one flag.
 *
 * A text form is admitted beside the typed one because the CLI reads the options of a package it
 * has not installed yet without the schema, so `--omit-default-prefix false` arrives as text and a
 * flag given once arrives as one value rather than a list. The schematic reads each value the way
 * `thoth init` reads the flag.
 */
function optionType(option: InitOptionDescriptor): unknown {
  if (option.repeatable) return ['array', 'string'];
  if (option.leaf === 'string') return 'string';
  return [option.leaf, 'string'];
}

/** The option schema of the `ng-add` schematic, which the toolkit's staging writes into the package. */
export function ngAddSchema(): Readonly<Record<string, unknown>> {
  const properties: Record<string, unknown> = {
    project: {
      type: 'string',
      description: 'The application to set up.',
      $default: { $source: 'projectName' },
    },
  };
  for (const option of INIT_OPTIONS) {
    const property = ngAddProperty(option);
    const prompt = PROMPTS[property];
    const preset = (NG_ADD_RECOVERY as Readonly<Record<string, string>>)[
      option.key
    ];
    properties[property] = {
      type: optionType(option),
      ...(option.repeatable ? { items: { type: 'string' } } : {}),
      description: option.repeatable
        ? `${option.description} Each value is ${option.value}.`
        : option.description,
      ...(preset === undefined ? {} : { default: preset }),
      ...(prompt === undefined ? {} : { 'x-prompt': prompt }),
    };
  }
  properties['origin'] = {
    type: 'string',
    description:
      'The origin the pages are published at, such as https://example.com, with no path. Required when the application renders on the server.',
  };
  return Object.freeze({
    $schema: OPTION_SCHEMA_DRAFT,
    $id: 'ThothNgAdd',
    title: 'Thoth ng-add',
    description:
      'Sets an application up for Thoth: the configuration, the package entries, the Angular builders and the providers.',
    type: 'object',
    properties,
    additionalProperties: false,
  });
}
