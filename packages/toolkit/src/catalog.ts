/**
 * Reading an authored catalog, and refusing everything YAML can do that a catalog must not.
 *
 * `specs/04-message-authoring-and-catalogs.spec.md` section 2 is the profile: one document, one
 * mapping, no directive, tag, constructor, anchor, alias or merge key, duplicate keys caught before
 * the mapping is built, and nothing resolved over the network. Why this file is the only door is
 * `specs/04-message-authoring-and-catalogs.spec.md` section 1: a message that could also arrive
 * from template text or a code literal would have two authorities and no way to say which one is
 * current.
 *
 * The restricted features are the ones that change what a key means from elsewhere in the
 * document. An alias graph or a merge key makes a later key's value depend on how a reader
 * resolved an earlier one, so what a reviewer reads is not necessarily what compiles.
 */
import {
  CST,
  Parser,
  Scalar,
  isAlias,
  isMap,
  isScalar,
  isSeq,
  parseAllDocuments,
  parseDocument,
  stringify,
  type Document,
  type Node,
  type ParsedNode,
  type Pair,
} from 'yaml';

import {
  toolkitDiagnostic,
  toolkitFailure,
  spanAt,
  toolkitSuccess,
  type ToolkitDiagnostic,
  type ToolkitDiagnosticCode,
  type ToolkitResult,
  type SourceSpan,
} from './diagnostics.js';
import {
  messageKeyInCatalog,
  messageKeyInCode,
  parseMessageId,
  parseProviderId,
  parseScopeId,
  type ProviderId,
  type ScopeId,
} from './identities.js';
import { canonicalizeLocale, type CanonicalLocale } from './locales.js';
import {
  EXTENSION_REGISTRY_ARGUMENT,
  requireArgument,
} from './call-arguments.js';
import {
  parseMessageSemanticModel,
  type MessageCustomFunction,
  type MessageSemanticModel,
} from './message-format.js';
import {
  schemaErrorParameter,
  schemaErrorPath,
  schemaErrorSummary,
  compileSchema,
  sortedSchemaErrors,
} from './schema-validation.js';
import { SOURCE_CATALOG_SCHEMA, TARGET_CATALOG_SCHEMA } from './schemas.js';
import { RESOURCE_LIMITS } from './resource-limits.js';
import type { ErrorObject } from 'ajv';

import { untrustedText } from './untrusted-text.js';
import {
  BIDI_VIOLATION_SUMMARY,
  inspectAuthoredBidi,
  isSafeAuthoredText,
  isSafeStructuralText,
} from './unicode-safety.js';
import {
  messageCustomFunctions,
  type ExtensionRegistry,
} from './extensions.js';
import { compareCodeUnit, frozenRecord } from './sorted-records.js';

/**
 * Whether a catalog is the one authored in the original language or a translation of it.
 *
 * The two are checked differently. A source catalog is where a message's shape is declared; a
 * target is measured against the source it translates, which is where a missing plural category or
 * a dropped slot is caught.
 */
export type CatalogRole = 'source' | 'target';
/** What an enumerated input value may be: a string, a number, or a boolean. */
export type InputLiteral = string | number | boolean;

/**
 * What a message says about one of the values it takes, beyond the fact that it takes it.
 *
 * Every field is the author's declaration in the source catalog. It becomes the type of that input
 * in the generated code, so a message that says it takes a date is a message a caller cannot hand a
 * string to.
 */
export interface InputRefinement {
  /** The kind of value expected, as a name the generator maps to a type. */
  readonly type?: string;
  /** The exact values allowed, when the input is one of a closed set. */
  readonly enum?: readonly InputLiteral[];
  /** Whether a caller may leave it out entirely. */
  readonly optional: boolean;
  /** Whether it may be present and null, which is not the same as being left out. */
  readonly nullable: boolean;
  /** What it means, for a translator and for whoever calls the message. */
  readonly description?: string;
}

/**
 * Whether a slot wraps words or stands alone.
 *
 * A paired slot opens and closes around text, the way a link does. A standalone one marks a single
 * point, the way an icon does.
 */
export type SlotShape = 'paired' | 'standalone';

/**
 * What a message says about one of the named regions inside it.
 *
 * These become the slot contract the application binds against, so a message declaring a link slot
 * is one whose bindings must include a link.
 */
export interface SlotRefinement {
  /** What the slot renders as: a link, an emphasis, a projected template. */
  readonly kind?: string;
  /** Whether it wraps text or marks a point. */
  readonly shape?: SlotShape;
  /** Whether a translation may leave it out. */
  readonly optional: boolean;
  /** Whether a translation may use it more than once. */
  readonly repeatable: boolean;
  /** The slots this one may appear inside, when nesting is constrained. */
  readonly within?: readonly string[];
  /** What it is for, which is what tells a translator where the words around it belong. */
  readonly description?: string;
}

interface CatalogMessageMetadata {
  readonly description?: string;
  readonly context?: string;
  readonly inputs: Readonly<Record<string, InputRefinement>>;
  readonly slots: Readonly<Record<string, SlotRefinement>>;
}

/** A message with text in it, parsed and kept beside its source. */
export interface TextCatalogMessage extends CatalogMessageMetadata {
  readonly kind: 'message';
  /** What the author wrote, exactly as written. */
  readonly message: string;
  /** The parsed form: what it needs, what it produces, and how it branches. */
  readonly semantics: MessageSemanticModel;
}

/**
 * A message declared with no text yet, which is how a target catalog records an untranslated entry.
 *
 * It keeps its description, its context and its declared inputs and slots, so a translator is
 * handed the whole brief rather than an empty key.
 */
export interface EmptyCatalogMessage extends CatalogMessageMetadata {
  readonly kind: 'empty';
}

/**
 * One entry in a catalog: text that was written, or a declaration still waiting for it.
 *
 * Check `kind` to tell them apart. Both carry the author's description, context, inputs and slots.
 */
export type CatalogMessage = TextCatalogMessage | EmptyCatalogMessage;

/**
 * One catalog file, parsed: which package and scope and locale it belongs to, and what is in it.
 *
 * The unit everything downstream works in. A message is identified by the provider, the scope and
 * its own key, and those three together are what makes two packages able to ship a `title` each.
 */
export interface Catalog {
  /** Whether this is an authored catalog or a translation. */
  readonly role: CatalogRole;
  /** Which package owns it, which is what keeps two packages' scopes from colliding. */
  readonly providerId: ProviderId;
  /** Which scope within that package, which is the unit catalogs are loaded in. */
  readonly scopeId: ScopeId;
  /** The locale it holds, canonically spelled. */
  readonly locale: CanonicalLocale;
  /** Where it was read from, when it came from a file. Carried into diagnostics. */
  readonly sourcePath?: string;
  /** The messages, by key. */
  readonly messages: Readonly<Record<string, CatalogMessage>>;
  /** The message families, by name, for messages that vary over a set of segments. */
  readonly families: Readonly<Record<string, CatalogFamily>>;
}

/**
 * A group of messages generated from one template, one per segment.
 *
 * What a set of related keys is declared as when they differ only in one part: a status per state,
 * a label per field. The template is authored once, so adding a segment adds a message rather than
 * a copy of one.
 */
export interface CatalogFamily {
  /** The message key the segments are substituted into. */
  readonly template: string;
  /** The segments, by name, each with the value substituted for it. */
  readonly segments: Readonly<Record<string, string>>;
}

/**
 * Everything about a catalog that its own text does not say.
 *
 * A catalog file holds messages and nothing about where it belongs, so the identity comes from
 * where the file was found rather than from something inside it that could disagree with that.
 */
export interface CatalogParseOptions {
  /** Whether to check it as an authored catalog or as a translation. */
  readonly role: CatalogRole;
  /** Which package it belongs to. Must be a valid provider identity. */
  readonly providerId: string;
  /** Which scope within that package. Must be a valid scope identity. */
  readonly scopeId: string;
  /** Which locale it holds. Must be canonical. */
  readonly locale: string;
  /** Where it came from, carried into every diagnostic this parse produces. */
  readonly sourcePath?: string;
  /**
   * The extensions whose functions and slot kinds the messages may use.
   *
   * Leaving it out is stricter rather than looser: a message calling an unregistered function is
   * refused, so a caller that has a registry and does not pass it rejects its own catalogs.
   */
  readonly extensions?: ExtensionRegistry;
}

type JsonObject = Readonly<Record<string, unknown>>;

const validateSourceCatalog = compileSchema(SOURCE_CATALOG_SCHEMA);
const validateTargetCatalog = compileSchema(TARGET_CATALOG_SCHEMA);

function yamlRangeSpan(
  source: string,
  range: readonly number[] | null | undefined,
  sourcePath: string | undefined,
): SourceSpan | undefined {
  if (range == null || range[0] === undefined) {
    return undefined;
  }
  const end = range[2] ?? range[1] ?? range[0];
  return spanAt(source, range[0], Math.max(0, end - range[0]), sourcePath);
}

function yamlNodeSpan(
  source: string,
  node: Node | null | undefined,
  sourcePath: string | undefined,
): SourceSpan | undefined {
  if (node === null || node === undefined) {
    return undefined;
  }
  if ('range' in node) {
    return yamlRangeSpan(source, node.range ?? undefined, sourcePath);
  }
  return undefined;
}

const catalogSourceText = new WeakMap<Catalog, string>();

/**
 * Resolve an authored path such as `['messages', 'nav.products']` to the span it occupies in the
 * catalog source, so a semantic diagnostic can report a real line and column instead of 1:1.
 *
 * The source is held in a side table rather than on `Catalog` itself. Putting it on the type
 * was tried and reverted: the catalog feeds deep equality, canonical JSON and output-freshness
 * digests, so an extra field silently changed identity and broke unchanged-output detection.
 *
 * Returns undefined for a catalog that was not produced by `parseCatalog`, or for a path
 * with no authored node behind it.
 */
export function catalogPathSpan(
  catalog: Catalog,
  path: readonly (string | number)[],
): SourceSpan | undefined {
  return catalogPathAnchor(catalog, path)?.span;
}

/**
 * Where in the file to point, and how much of the pointer got there.
 *
 * A JSON pointer into a catalog does not always resolve, and the interesting case is the one where
 * it *cannot*: a diagnostic reporting that a message is absent is pointing at the thing that is not
 * there. The answer is the nearest ancestor that does resolve, `messages` for a missing
 * `messages/greeting`, with `resolved` saying how many segments got there, so a caller can tell a
 * reader why the caret is where it is instead of on the thing they were told about.
 *
 * `resolved === path.length` is an exact hit and needs no explaining. `undefined` means there is no
 * honest answer at all (no retained source, an empty pointer, a file that does not parse) and a
 * caller must then report no location rather than inventing one. Every location this returns is a
 * position a reader can put a cursor on.
 */
export function catalogPathAnchor(
  catalog: Catalog,
  path: readonly (string | number)[],
): { readonly span: SourceSpan; readonly resolved: number } | undefined {
  const source = catalogSourceText.get(catalog);
  if (source === undefined || path.length === 0) return undefined;
  let documents: Document.Parsed<ParsedNode>[];
  try {
    documents = parseAllDocuments<ParsedNode>(source, {
      customTags: [],
      merge: false,
      resolveKnownTags: false,
    });
  } catch {
    return undefined;
  }
  const root = documents[0]?.contents;
  if (root === null || root === undefined) return undefined;
  const located = yamlPathNode(root, path);
  const span = yamlNodeSpan(
    source,
    located.node ?? undefined,
    catalog.sourcePath,
  );
  return span === undefined
    ? undefined
    : Object.freeze({ span, resolved: located.resolved });
}

/**
 * Walk as far down the pointer as the document goes, and say where you stopped.
 *
 * Stopping is the ordinary outcome rather than the failure. It stops when the next step needs a
 * different kind of collection, and when a key is simply **absent**: walking on past an absent key
 * would return nothing at all for a pointer into a missing message, and the caller would have no
 * position to report. Absence is exactly the case the diagnostics that use this are reporting.
 */
function yamlPathNode(
  root: ParsedNode,
  path: readonly (string | number)[],
): {
  readonly node: ParsedNode | null | undefined;
  readonly resolved: number;
} {
  let current: ParsedNode | null | undefined = root;
  let resolved = 0;
  for (const part of path) {
    if (typeof part === 'number') {
      if (!isSeq<ParsedNode>(current)) return { node: current, resolved };
      const element: ParsedNode | undefined = current.items[part];
      if (element === undefined) return { node: current, resolved };
      current = element;
      resolved += 1;
      continue;
    }

    if (!isMap<ParsedNode, ParsedNode | null>(current)) {
      return { node: current, resolved };
    }
    const pair: Pair<ParsedNode, ParsedNode | null> | undefined =
      current.items.find(
        (item) => isScalar<string>(item.key) && item.key.value === part,
      );
    // The key is not in this map. The map is where the reader has to look, and the key is what is
    // not in it, so this node is the answer and `resolved` says the rest of the pointer is
    // what is missing beneath it.
    if (pair === undefined) return { node: current, resolved };
    current = pair.value;
    resolved += 1;
  }
  return { node: current, resolved };
}

function yamlDiagnostic(
  source: string,
  sourcePath: string | undefined,
  code: ToolkitDiagnosticCode,
  summary: string,
  options: {
    readonly node?: ParsedNode | null;
    readonly path?: readonly (string | number)[];
    readonly span?: SourceSpan;
  } = {},
): ToolkitDiagnostic {
  const span = options.span ?? yamlNodeSpan(source, options.node, sourcePath);
  return toolkitDiagnostic(code, summary, {
    ...(options.path === undefined ? {} : { path: options.path }),
    ...(span === undefined ? {} : { span }),
  });
}

/**
 * One cause, one diagnostic.
 *
 * Ajv reports a rejected property name twice: the keyword that actually rejected it, and
 * the `propertyNames` wrapper around that keyword. The two carry complementary halves and neither
 * is usable alone (the inner one has the rule and no property, the wrapper has the property and
 * no rule) so a reader got
 *
 *     en-US.yaml:2:3:  Thoth catalog must match pattern "^[a-z][a-z0-9]*(?:-[a-z]...".
 *     en-US.yaml:2:17: Thoth catalog property name must be valid.
 *
 * two lines about one key, at two positions, saying between them less than either would alone. The
 * wrapper is kept because it resolves to the offending entry rather than to the map containing it,
 * and `rejectedKeySummary` below puts the rule back into it in words.
 *
 * The inner error is dropped **only when its wrapper is present**. Ajv emitting one without the
 * other would otherwise silently drop the whole report, so the filter is shown keeping what it is
 * not there to remove. An empty report says nothing until the filter is known to pass something.
 */
function reportableSchemaErrors(
  errors: readonly ErrorObject[],
): readonly ErrorObject[] {
  const wrapped = new Set(
    errors
      .filter((error) => error.keyword === 'propertyNames')
      .map((error) => error.instancePath),
  );
  return errors.filter(
    (error) =>
      error.keyword === 'propertyNames' ||
      !error.schemaPath.includes('/propertyNames/') ||
      !wrapped.has(error.instancePath),
  );
}

/**
 * A rejected catalog key, said the way a person would say it.
 *
 * *"Thoth catalog property name must be valid"* names no property and no rule, and the line above
 * it printed the raw regex, which states the rule in a language the reader is not writing in,
 * and never mentions that the file spells keys one way and code spells them another.
 * `sign-in-button` in the file is `messages.signInButton` in code, and that mapping was written
 * down nowhere at all.
 *
 * So this says the rule in words, offers the key's catalog spelling when the obvious repair is one
 * the schema would accept, and names what code will reach it by: taken from the projection the
 * generator itself uses, so the sentence cannot promise a name the generator does not emit.
 */
function rejectedKeySummary(
  error: ErrorObject,
  errors: readonly ErrorObject[],
): string | undefined {
  if (error.keyword !== 'propertyNames') return undefined;
  const key = schemaErrorParameter(error, 'propertyName');
  if (key === undefined) return undefined;
  const inner = errors.find(
    (candidate) =>
      candidate.instancePath === error.instancePath &&
      candidate.schemaPath.includes('/propertyNames/') &&
      candidate.keyword === 'pattern',
  );
  const pattern =
    inner === undefined ? undefined : schemaErrorParameter(inner, 'pattern');
  if (pattern === undefined) return undefined;

  // Only the two maps whose rule this function knows how to state. A third keyed map added to the
  // catalog schema later would otherwise inherit the message-key sentence and be described by a
  // rule that is not its own; falling through to Ajv's wording is worse prose and true, which is
  // the right way round.
  const collection = error.instancePath.split('/').at(-1) ?? '';
  if (collection !== 'messages' && collection !== 'families') return undefined;
  const [subject, rule] =
    collection === 'families'
      ? ['Family name', 'Family names are lower-case words joined by hyphens.']
      : [
          'Message key',
          'Message keys are lower-case words joined by hyphens, and a dot separates groups.',
        ];

  const repaired = messageKeyInCatalog(key);
  let advice = '';
  try {
    if (repaired !== key && new RegExp(pattern, 'u').test(repaired)) {
      advice =
        collection === 'families'
          ? ` Write it as ${JSON.stringify(repaired)}.`
          : ` Write it as ${JSON.stringify(repaired)}, which code reaches as messages.${messageKeyInCode(repaired)}.`;
    }
  } catch {
    // A pattern this build cannot compile is not a reason to lose the diagnostic; the rule above
    // still holds and the suggestion is the optional half.
  }
  return `${subject} ${JSON.stringify(key)} is not a valid catalog key. ${rule}${advice}`;
}

/**
 * The parser's complaint as one sentence, because a diagnostic is a line.
 *
 * `YAMLParseError.message` is a code frame: a sentence, then a blank line, then the
 * offending source, then a caret. Interpolated into a one-line diagnostic those newlines survive as
 * the raw bytes they are (on a terminal the reader gets
 * `Missing closing "quote at line 3, column 1:<CR><LF>  greeting: "unterminated<CR><LF>^<CR>`) and
 * the frame is a worse copy of the source Thoth is already pointing at by file, line and column.
 *
 * So: the first line only, with the position stripped off the end of it for the same reason. What is
 * left is the part that says what is wrong.
 */
function yamlErrorSentence(message: string): string {
  const [first = ''] = message.split('\n');
  return first
    .replace(/\s+at line \d+, column \d+:?\s*$/u, '')
    .replace(/:\s*$/u, '');
}

/**
 * Whether the walk has already stopped at a limit.
 *
 * The flag is raised inside the recursive call the two readers below follow, and an assignment a
 * call makes is not one the compiler can order against a plain read of the property.
 */
function limitReached(state: { readonly limited: boolean }): boolean {
  return state.limited;
}

function inspectYamlNode(
  source: string,
  node: ParsedNode | null,
  sourcePath: string | undefined,
  path: readonly (string | number)[],
  diagnostics: ToolkitDiagnostic[],
  depth = 0,
  state: { nodes: number; limited: boolean } = { nodes: 0, limited: false },
): void {
  if (node === null) {
    return;
  }
  if (state.limited || diagnostics.length >= RESOURCE_LIMITS.diagnostics) {
    return;
  }
  state.nodes += 1;
  if (state.nodes > RESOURCE_LIMITS.yamlNodes) {
    state.limited = true;
    diagnostics.push(
      yamlDiagnostic(
        source,
        sourcePath,
        'TH1101',
        `Thoth catalog structure exceeds the node ceiling of ${RESOURCE_LIMITS.yamlNodes}.`,
        { node, path },
      ),
    );
    return;
  }

  if (depth > RESOURCE_LIMITS.yamlDepth) {
    diagnostics.push(
      yamlDiagnostic(
        source,
        sourcePath,
        'TH1101',
        `Thoth catalog structure exceeds the depth ceiling of ${RESOURCE_LIMITS.yamlDepth}.`,
        { node, path },
      ),
    );
    return;
  }

  if (isAlias(node)) {
    diagnostics.push(
      yamlDiagnostic(
        source,
        sourcePath,
        'TH1101',
        'Thoth catalogs cannot contain YAML aliases.',
        { node, path },
      ),
    );
    return;
  }

  if ('anchor' in node && typeof node.anchor === 'string') {
    diagnostics.push(
      yamlDiagnostic(
        source,
        sourcePath,
        'TH1101',
        'Thoth catalogs cannot contain YAML anchors.',
        { node, path },
      ),
    );
  }

  if (isMap<ParsedNode, ParsedNode | null>(node)) {
    const seen = new Set<string>();
    for (const pair of node.items) {
      state.nodes += 1;
      if (state.nodes > RESOURCE_LIMITS.yamlNodes) {
        state.limited = true;
        diagnostics.push(
          yamlDiagnostic(
            source,
            sourcePath,
            'TH1101',
            `Thoth catalog structure exceeds the node ceiling of ${RESOURCE_LIMITS.yamlNodes}.`,
            { node: pair.key, path },
          ),
        );
        return;
      }
      if (!isScalar<string>(pair.key) || typeof pair.key.value !== 'string') {
        diagnostics.push(
          yamlDiagnostic(
            source,
            sourcePath,
            'TH1101',
            'Thoth catalog mappings require scalar string keys.',
            { node: pair.key, path },
          ),
        );
        inspectYamlNode(
          source,
          pair.value,
          sourcePath,
          path,
          diagnostics,
          depth + 1,
          state,
        );
        continue;
      }

      const key = pair.key.value;
      const childPath = [...path, key];
      if (!isSafeStructuralText(key)) {
        diagnostics.push(
          yamlDiagnostic(
            source,
            sourcePath,
            'TH1101',
            'Thoth catalog keys contain malformed Unicode or unauthorized invisible or bidi controls.',
            { node: pair.key, path: childPath },
          ),
        );
      }
      if (key === '<<') {
        diagnostics.push(
          yamlDiagnostic(
            source,
            sourcePath,
            'TH1101',
            'Thoth catalogs cannot contain YAML merge keys.',
            { node: pair.key, path: childPath },
          ),
        );
      }
      if (seen.has(key)) {
        diagnostics.push(
          yamlDiagnostic(
            source,
            sourcePath,
            'TH1103',
            `Thoth catalog contains the duplicate key ${JSON.stringify(key)}.`,
            { node: pair.key, path: childPath },
          ),
        );
      } else {
        seen.add(key);
      }

      inspectYamlNode(
        source,
        pair.value,
        sourcePath,
        childPath,
        diagnostics,
        depth + 1,
        state,
      );
      if (
        limitReached(state) ||
        diagnostics.length >= RESOURCE_LIMITS.diagnostics
      ) {
        return;
      }
    }
    return;
  }

  if (isSeq<ParsedNode>(node)) {
    for (const [index, item] of node.items.entries()) {
      inspectYamlNode(
        source,
        item,
        sourcePath,
        [...path, index],
        diagnostics,
        depth + 1,
        state,
      );
      if (
        limitReached(state) ||
        diagnostics.length >= RESOURCE_LIMITS.diagnostics
      ) {
        return;
      }
    }
    return;
  }

  if (isScalar<unknown>(node)) {
    const value = node.value;
    if (
      value !== null &&
      typeof value !== 'string' &&
      typeof value !== 'boolean' &&
      (typeof value !== 'number' || !Number.isFinite(value))
    ) {
      diagnostics.push(
        yamlDiagnostic(
          source,
          sourcePath,
          'TH1101',
          'Thoth catalogs permit only JSON-compatible Core-schema scalar values.',
          { node, path },
        ),
      );
    } else if (typeof value === 'string' && !isSafeAuthoredText(value)) {
      diagnostics.push(
        yamlDiagnostic(
          source,
          sourcePath,
          'TH1101',
          'Thoth catalog text contains malformed Unicode or forbidden control characters.',
          { node, path },
        ),
      );
    } else if (typeof value === 'string') {
      const violation = inspectAuthoredBidi(value);
      if (violation !== undefined) {
        diagnostics.push(
          yamlDiagnostic(
            source,
            sourcePath,
            'TH1103',
            BIDI_VIOLATION_SUMMARY[violation],
            { node, path },
          ),
        );
      }
    }
    return;
  }

  diagnostics.push(
    yamlDiagnostic(
      source,
      sourcePath,
      'TH1101',
      'Thoth catalog contains an unsupported YAML node.',
      { node, path },
    ),
  );
}

function constructYamlValue(node: ParsedNode | null): unknown {
  if (node === null) {
    return null;
  }
  if (isScalar<unknown>(node)) {
    return node.value;
  }
  if (isSeq<ParsedNode>(node)) {
    return Object.freeze(node.items.map(constructYamlValue));
  }
  if (isMap<ParsedNode, ParsedNode | null>(node)) {
    const value = Object.create(null) as Record<string, unknown>;
    for (const pair of node.items) {
      if (isScalar<string>(pair.key) && typeof pair.key.value === 'string') {
        Object.defineProperty(value, pair.key.value, {
          configurable: false,
          enumerable: true,
          value: constructYamlValue(pair.value),
          writable: false,
        });
      }
    }
    return Object.freeze(value);
  }
  throw new TypeError('Cannot construct an unsupported YAML node.');
}

function emptyFrozenRecord<T>(): Readonly<Record<string, T>> {
  return Object.freeze(Object.create(null)) as Readonly<Record<string, T>>;
}

function normalizeInputs(
  value: unknown,
): Readonly<Record<string, InputRefinement>> {
  if (typeof value !== 'object' || value === null) {
    return emptyFrozenRecord();
  }
  const entries = Object.entries(value as JsonObject)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, refinement]) => {
      if (typeof refinement === 'string') {
        return [
          key,
          Object.freeze({ type: refinement, optional: false, nullable: false }),
        ] as const;
      }
      const record = refinement as JsonObject;
      return [
        key,
        Object.freeze({
          ...(typeof record['type'] === 'string'
            ? { type: record['type'] }
            : {}),
          ...(Array.isArray(record['enum'])
            ? {
                enum: Object.freeze([...record['enum']] as InputLiteral[]),
              }
            : {}),
          optional: record['optional'] === true,
          nullable: record['nullable'] === true,
          ...(typeof record['description'] === 'string'
            ? { description: record['description'] }
            : {}),
        }),
      ] as const;
    });
  return frozenRecord<InputRefinement>(
    entries as readonly (readonly [string, InputRefinement])[],
  );
}

function normalizeSlots(
  value: unknown,
): Readonly<Record<string, SlotRefinement>> {
  if (typeof value !== 'object' || value === null) {
    return emptyFrozenRecord();
  }
  const entries = Object.entries(value as JsonObject)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, refinement]) => {
      if (typeof refinement === 'string') {
        return [
          key,
          Object.freeze({
            kind: refinement,
            optional: false,
            repeatable: false,
          }),
        ] as const;
      }
      const record = refinement as JsonObject;
      return [
        key,
        Object.freeze({
          ...(typeof record['kind'] === 'string'
            ? { kind: record['kind'] }
            : {}),
          ...(record['shape'] === 'paired' || record['shape'] === 'standalone'
            ? { shape: record['shape'] }
            : {}),
          optional: record['optional'] === true,
          repeatable: record['repeatable'] === true,
          ...(Array.isArray(record['within'])
            ? { within: Object.freeze([...record['within']] as string[]) }
            : {}),
          ...(typeof record['description'] === 'string'
            ? { description: record['description'] }
            : {}),
        }),
      ] as const;
    });
  return frozenRecord<SlotRefinement>(
    entries as readonly (readonly [string, SlotRefinement])[],
  );
}

function normalizeMessages(
  value: JsonObject,
  semantics: ReadonlyMap<string, MessageSemanticModel>,
): Readonly<Record<string, CatalogMessage>> {
  const messages = value['messages'] as JsonObject;
  return frozenRecord<CatalogMessage>(
    Object.entries(messages)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([messageId, authored]) => {
        if (typeof authored === 'string') {
          return [
            messageId,
            Object.freeze({
              kind: 'message',
              message: authored,
              semantics: semantics.get(messageId) as MessageSemanticModel,
              inputs: emptyFrozenRecord<InputRefinement>(),
              slots: emptyFrozenRecord<SlotRefinement>(),
            }),
          ] as const;
        }

        const record = authored as JsonObject;
        const metadata = {
          ...(typeof record['description'] === 'string'
            ? { description: record['description'] }
            : {}),
          ...(typeof record['context'] === 'string'
            ? { context: record['context'] }
            : {}),
          inputs: normalizeInputs(record['inputs']),
          slots: normalizeSlots(record['slots']),
        };
        if (record['empty'] === true) {
          return [
            messageId,
            Object.freeze({ kind: 'empty', ...metadata }),
          ] as const;
        }
        return [
          messageId,
          Object.freeze({
            kind: 'message',
            message: record['message'] as string,
            semantics: semantics.get(messageId) as MessageSemanticModel,
            ...metadata,
          }),
        ] as const;
      }),
  );
}

function contextDiagnostics(options: CatalogParseOptions): {
  readonly diagnostics: readonly ToolkitDiagnostic[];
  readonly providerId?: ProviderId;
  readonly scopeId?: ScopeId;
  readonly locale?: CanonicalLocale;
} {
  const providerId = parseProviderId(options.providerId);
  const scopeId = parseScopeId(options.scopeId);
  const locale = canonicalizeLocale(options.locale);
  const diagnostics: ToolkitDiagnostic[] = [];
  if (!providerId.ok) {
    diagnostics.push(
      toolkitDiagnostic('TH1104', 'Catalog provider identity is malformed.'),
    );
  }
  if (!scopeId.ok) {
    diagnostics.push(
      toolkitDiagnostic('TH1104', 'Catalog scope identity is malformed.'),
    );
  }
  if (!locale.ok) {
    diagnostics.push(
      toolkitDiagnostic('TH1003', 'Catalog locale is malformed.'),
    );
  }
  return {
    diagnostics,
    ...(providerId.ok ? { providerId: providerId.value } : {}),
    ...(scopeId.ok ? { scopeId: scopeId.value } : {}),
    ...(locale.ok ? { locale: locale.value } : {}),
  };
}

/**
 * Reads one catalog file and returns it parsed, or the reasons it could not be.
 *
 * Takes the file's text and the identity to read it under. Every message in it is parsed, checked
 * against the schema for its role, and measured for the text that cannot be seen while reading the
 * file: a directional override, an unbalanced isolate, a byte-order mark inside a value.
 *
 * Diagnostics carry the line and column in the original text, so a problem points at the place in
 * the file rather than at a path through the parsed object.
 *
 * Refuses a file past the size ceiling before parsing it, and returns a failure rather than
 * throwing for anything wrong with its content.
 */
export function parseCatalog(
  sourceValue: unknown,
  options: CatalogParseOptions,
): ToolkitResult<Catalog> {
  requireArgument('parseCatalog', 'options', options, {
    optional: { extensions: EXTENSION_REGISTRY_ARGUMENT },
  });
  return parseCatalogText(
    sourceValue,
    options,
    messageCustomFunctions(options.extensions),
  );
}

function parseCatalogText(
  sourceValue: unknown,
  options: CatalogParseOptions,
  customFunctions: readonly MessageCustomFunction[],
): ToolkitResult<Catalog> {
  const sourceText = untrustedText(
    sourceValue,
    'TH1101',
    'Catalog source',
    RESOURCE_LIMITS.catalogBytes,
  );
  if (!sourceText.ok) return sourceText;
  const source = sourceText.value;
  if (Buffer.byteLength(source, 'utf8') > RESOURCE_LIMITS.catalogBytes) {
    return toolkitFailure([
      toolkitDiagnostic(
        'TH1101',
        `Thoth catalog exceeds the ${RESOURCE_LIMITS.catalogBytes}-byte implementation ceiling.`,
        {
          span: spanAt(source, 0, source.length, options.sourcePath),
        },
      ),
    ]);
  }
  const context = contextDiagnostics(options);
  if (context.diagnostics.length > 0) {
    return toolkitFailure(context.diagnostics);
  }

  let documents: Document.Parsed<ParsedNode>[];
  try {
    documents = parseAllDocuments<ParsedNode>(source, {
      customTags: [],
      merge: false,
      resolveKnownTags: false,
      schema: 'core',
      strict: true,
      uniqueKeys: false,
    });
  } catch {
    return toolkitFailure([
      toolkitDiagnostic('TH1101', 'Thoth catalog is not valid YAML.', {
        span: spanAt(source, 0, Math.min(1, source.length), options.sourcePath),
      }),
    ]);
  }

  if (documents.length !== 1) {
    return toolkitFailure([
      toolkitDiagnostic(
        'TH1101',
        'Thoth catalogs must contain exactly one YAML document.',
        {
          span: spanAt(source, 0, source.length, options.sourcePath),
        },
      ),
    ]);
  }

  const document = documents[0];
  if (document === undefined) {
    return toolkitFailure([
      toolkitDiagnostic(
        'TH1101',
        'Thoth catalog must contain one YAML document.',
      ),
    ]);
  }

  const parserDiagnostics = [...document.errors, ...document.warnings].map(
    (error) => {
      const span = yamlRangeSpan(source, error.pos, options.sourcePath);
      return toolkitDiagnostic(
        'TH1101',
        `Thoth catalog YAML is invalid: ${yamlErrorSentence(error.message)}`,
        span === undefined ? {} : { span },
      );
    },
  );
  if (parserDiagnostics.length > 0) {
    return toolkitFailure(parserDiagnostics);
  }

  if (
    document.directives.yaml.explicit === true ||
    Object.keys(document.directives.tags).some((tag) => tag !== '!!')
  ) {
    const span = yamlRangeSpan(source, document.range, options.sourcePath);
    return toolkitFailure([
      toolkitDiagnostic(
        'TH1101',
        'Thoth catalogs cannot contain YAML directives.',
        span === undefined ? {} : { span },
      ),
    ]);
  }

  const root = document.contents;
  if (!isMap<ParsedNode, ParsedNode | null>(root)) {
    const span = yamlNodeSpan(source, root, options.sourcePath);
    return toolkitFailure([
      toolkitDiagnostic(
        'TH1101',
        'Thoth catalog root must be a mapping.',
        span === undefined ? {} : { span },
      ),
    ]);
  }

  const structuralDiagnostics: ToolkitDiagnostic[] = [];
  inspectYamlNode(source, root, options.sourcePath, [], structuralDiagnostics);
  if (structuralDiagnostics.length > 0) {
    return toolkitFailure(structuralDiagnostics);
  }

  const value = constructYamlValue(root);
  // Ahead of the schema, which bounds the same count and would report a ceiling as a shape.
  const declared = (value as { readonly messages?: unknown } | null)?.messages;
  if (
    typeof declared === 'object' &&
    declared !== null &&
    Object.keys(declared).length > RESOURCE_LIMITS.messagesPerCatalog
  ) {
    const messagesNode = yamlPathNode(root, ['messages']).node;
    return toolkitFailure([
      yamlDiagnostic(
        source,
        options.sourcePath,
        'TH1101',
        `Thoth catalog exceeds the ${RESOURCE_LIMITS.messagesPerCatalog}-message implementation ceiling.`,
        {
          path: ['messages'],
          ...(messagesNode === undefined ? {} : { node: messagesNode }),
        },
      ),
    ]);
  }
  const validator =
    options.role === 'source' ? validateSourceCatalog : validateTargetCatalog;
  if (!validator(value)) {
    const errors = sortedSchemaErrors(validator.errors);
    return toolkitFailure(
      reportableSchemaErrors(errors).map((error) => {
        const path = schemaErrorPath(error);
        const node = yamlPathNode(root, path).node;
        const targetContract =
          options.role === 'target' &&
          path.some((part) => part === 'inputs' || part === 'slots');
        return yamlDiagnostic(
          source,
          options.sourcePath,
          targetContract ? 'TH1105' : 'TH1102',
          targetContract
            ? 'Target catalog entries inherit inputs and slots from the source catalog.'
            : (rejectedKeySummary(error, errors) ??
                schemaErrorSummary('Thoth catalog', error)),
          {
            path,
            ...(node === undefined ? {} : { node }),
          },
        );
      }),
    );
  }

  const objectValue = value as JsonObject;
  for (const messageId of Object.keys(objectValue['messages'] as JsonObject)) {
    const parsedMessageId = parseMessageId(messageId);
    const node = yamlPathNode(root, ['messages', messageId]).node;
    if (!parsedMessageId.ok) {
      return toolkitFailure([
        yamlDiagnostic(
          source,
          options.sourcePath,
          'TH1104',
          `Message identity ${JSON.stringify(messageId)} is malformed.`,
          {
            path: ['messages', messageId],
            ...(node === undefined ? {} : { node }),
          },
        ),
      ]);
    }
  }

  const messageSemantics = new Map<string, MessageSemanticModel>();
  for (const [messageId, authored] of Object.entries(
    objectValue['messages'] as JsonObject,
  )) {
    const record =
      typeof authored === 'object' && authored !== null
        ? (authored as JsonObject)
        : undefined;
    const body =
      typeof authored === 'string'
        ? authored
        : typeof record?.['message'] === 'string'
          ? record['message']
          : undefined;
    if (body === undefined) {
      continue;
    }

    const semantics = parseMessageSemanticModel(body, {
      path: ['messages', messageId],
      customFunctions,
    });
    if (!semantics.ok) {
      const node = yamlPathNode(root, ['messages', messageId]).node;
      return toolkitFailure(
        semantics.diagnostics.map((diagnostic) =>
          yamlDiagnostic(
            source,
            options.sourcePath,
            diagnostic.code,
            diagnostic.summary,
            {
              path: diagnostic.path,
              ...(node === undefined ? {} : { node }),
            },
          ),
        ),
      );
    }
    messageSemantics.set(messageId, semantics.value);
  }

  const catalog: Catalog = Object.freeze({
    role: options.role,
    providerId: context.providerId as ProviderId,
    scopeId: context.scopeId as ScopeId,
    locale: context.locale as CanonicalLocale,
    ...(options.sourcePath === undefined
      ? {}
      : { sourcePath: options.sourcePath }),
    messages: normalizeMessages(objectValue, messageSemantics),
    families: normalizeFamilies(objectValue),
  });
  // Held alongside the catalog, never on it: see catalogPathSpan.
  catalogSourceText.set(catalog, source);
  return toolkitSuccess(catalog);
}

function normalizeFamilies(
  value: JsonObject,
): Readonly<Record<string, CatalogFamily>> {
  const result = Object.create(null) as Record<string, CatalogFamily>;
  const families = value['families'];
  if (
    typeof families !== 'object' ||
    families === null ||
    Array.isArray(families)
  ) {
    return Object.freeze(result);
  }
  for (const [name, authored] of Object.entries(families as JsonObject).sort(
    ([left], [right]) => (left < right ? -1 : left > right ? 1 : 0),
  )) {
    const record =
      typeof authored === 'object' && authored !== null
        ? (authored as JsonObject)
        : undefined;
    const template =
      typeof authored === 'string'
        ? authored
        : typeof record?.['template'] === 'string'
          ? record['template']
          : '';
    const segments = Object.create(null) as Record<string, string>;
    for (const [segment, type] of Object.entries(
      (record?.['segments'] as JsonObject | undefined) ?? {},
    ).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))) {
      if (typeof type === 'string') segments[segment] = type;
    }
    result[name] = Object.freeze({
      template,
      segments: Object.freeze(segments),
    });
  }
  return Object.freeze(result);
}

function authoredInput(refinement: InputRefinement): unknown {
  const expanded = {
    ...(refinement.type === undefined ? {} : { type: refinement.type }),
    ...(refinement.enum === undefined ? {} : { enum: refinement.enum }),
    ...(refinement.optional ? { optional: true } : {}),
    ...(refinement.nullable ? { nullable: true } : {}),
    ...(refinement.description === undefined
      ? {}
      : { description: refinement.description }),
  };
  return Object.keys(expanded).length === 1 && refinement.type !== undefined
    ? refinement.type
    : expanded;
}

function authoredSlot(refinement: SlotRefinement): unknown {
  const expanded = {
    ...(refinement.kind === undefined ? {} : { kind: refinement.kind }),
    ...(refinement.shape === undefined ? {} : { shape: refinement.shape }),
    ...(refinement.optional ? { optional: true } : {}),
    ...(refinement.repeatable ? { repeatable: true } : {}),
    ...(refinement.within === undefined
      ? {}
      : {
          within: [...refinement.within].sort((left, right) =>
            left < right ? -1 : left > right ? 1 : 0,
          ),
        }),
    ...(refinement.description === undefined
      ? {}
      : { description: refinement.description }),
  };
  return Object.keys(expanded).length === 1 && refinement.kind !== undefined
    ? refinement.kind
    : expanded;
}

function authoredMessage(message: CatalogMessage): unknown {
  const hasMetadata =
    message.description !== undefined ||
    message.context !== undefined ||
    Object.keys(message.inputs).length > 0 ||
    Object.keys(message.slots).length > 0;
  if (message.kind === 'message' && !hasMetadata) {
    return message.message;
  }

  return {
    ...(message.kind === 'message'
      ? { message: message.message }
      : { empty: true }),
    ...(message.description === undefined
      ? {}
      : { description: message.description }),
    ...(message.context === undefined ? {} : { context: message.context }),
    ...(Object.keys(message.inputs).length === 0
      ? {}
      : {
          inputs: Object.fromEntries(
            Object.entries(message.inputs).map(([key, value]) => [
              key,
              authoredInput(value),
            ]),
          ),
        }),
    ...(Object.keys(message.slots).length === 0
      ? {}
      : {
          slots: Object.fromEntries(
            Object.entries(message.slots).map(([key, value]) => [
              key,
              authoredSlot(value),
            ]),
          ),
        }),
  };
}

function authoredFamily(family: CatalogFamily): unknown {
  return Object.keys(family.segments).length === 0
    ? family.template
    : {
        template: family.template,
        segments: family.segments,
      };
}

/**
 * A scalar that means the same thing written without quotes.
 *
 * Deliberately narrow. Everything a message can contain that YAML would read as structure
 * (`{$name}` opening a flow mapping, a leading `-` opening a sequence, `: ` opening a pair, ` #`
 * opening a comment) keeps its quotes, as does anything a reader could mistake for a boolean,
 * a number, or null. The cost of being wrong is a catalog that parses to something else, so the
 * test refuses whatever it is not sure about.
 */
const PLAIN_SAFE =
  /^(?![-?:,[\]{}#&*!|>'"%@`\s])(?!.*(?::\s|\s#))[^\r\n\t]*[^\s:]$/u;

const PLAIN_UNSAFE_WORDS = new Set([
  'true',
  'false',
  'null',
  '~',
  'yes',
  'no',
  'on',
  'off',
  'True',
  'False',
  'Null',
  'TRUE',
  'FALSE',
  'NULL',
]);

function plainSafe(value: string): boolean {
  if (value.length === 0) return false;
  if (PLAIN_UNSAFE_WORDS.has(value)) return false;
  // Anything the core schema would read as a number rather than a string.
  if (/^[-+]?(?:\d[\d_]*(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/u.test(value)) {
    return false;
  }
  if (/^0[xXoO]/u.test(value)) return false;
  return PLAIN_SAFE.test(value);
}

/**
 * The least quoting a one-line scalar needs: none where plain is unambiguous, single quotes where
 * nothing needs escaping, and double quotes for an apostrophe or a control character, which single
 * quotes cannot carry.
 */
function flowScalarStyle(value: string): Scalar.Type {
  return plainSafe(value)
    ? Scalar.PLAIN
    : value.includes("'") || /[\u0000-\u001f\u007f]/u.test(value)
      ? Scalar.QUOTE_DOUBLE
      : Scalar.QUOTE_SINGLE;
}

/**
 * Normalise how a catalog is written without rewriting what it says.
 *
 * A formatter that builds a plain object from the semantic model and stringifies it drops every
 * comment, because comments are not in that model (they go when the YAML becomes the model,
 * several steps before anything writes a file) so a command whose name promises presentation
 * changes only deletes every comment in a consumer's catalog. Forced double quotes and a rewritten
 * key order come from the same place: that is regeneration rather than reformatting.
 *
 * Regenerating from a model is right for `src/generated/i18n/`, where nothing is the consumer's.
 * It is the wrong shape for a file a person wrote. This edits the parsed document instead, which
 * is what every formatter for authored code does, and which makes losing content impossible
 * rather than merely unintended: the content is never converted away.
 *
 * Key order is authorial information and is never touched. Quoting is reduced to the least a
 * scalar needs, and left alone wherever plain would be ambiguous.
 */
export function formatCatalogSource(
  source: string,
  options: CatalogParseOptions,
): ToolkitResult<string> {
  // Presentation is normalised only on a catalog Thoth can read. Reformatting a file whose
  // meaning is unknown is how a formatter turns one problem into two.
  const parsed = parseCatalog(source, options);
  if (!parsed.ok) return parsed;

  let document: Document.Parsed<ParsedNode>;
  try {
    document = parseDocument<ParsedNode>(source, {
      customTags: [],
      merge: false,
      resolveKnownTags: false,
      schema: 'core',
      strict: true,
      uniqueKeys: false,
      keepSourceTokens: false,
    });
  } catch {
    return toolkitFailure([
      toolkitDiagnostic('TH1101', 'Thoth catalog is not valid YAML.', {
        span: spanAt(source, 0, Math.min(1, source.length), options.sourcePath),
      }),
    ]);
  }

  const restyle = (node: unknown): void => {
    if (isScalar(node)) {
      if (typeof node.value !== 'string') return;
      if (
        node.type === Scalar.BLOCK_LITERAL ||
        node.type === Scalar.BLOCK_FOLDED
      ) {
        // A block scalar is a deliberate authorial choice about line structure. Collapsing it to
        // a quoted string would preserve the characters and lose the shape.
        return;
      }
      node.type = flowScalarStyle(node.value);
      return;
    }
    if (isMap(node)) {
      for (const pair of node.items) {
        restyle(pair.key);
        restyle(pair.value);
      }
      return;
    }
    if (isSeq(node)) {
      for (const item of node.items) restyle(item);
    }
  };
  restyle(document.contents);

  return toolkitSuccess(
    document.toString({
      defaultKeyType: 'PLAIN',
      doubleQuotedAsJSON: true,
      indent: 2,
      lineWidth: 0,
      simpleKeys: true,
    }),
  );
}

/** What an accepted translation says one target entry now holds. */
interface MergedEntry {
  readonly kind: CatalogMessage['kind'];
  readonly message?: string;
  readonly description?: string;
  readonly context?: string;
}

/**
 * The entry a target file holds once a translation is accepted into it.
 *
 * Guidance the translation does not carry is kept rather than cleared: an absent note says nothing
 * about the entry, and only what the translation states is what changes.
 */
function mergedEntry(
  existing: CatalogMessage | undefined,
  accepted: CatalogMessage,
): MergedEntry {
  const description = accepted.description ?? existing?.description;
  const context = accepted.context ?? existing?.context;
  return {
    kind: accepted.kind,
    ...(accepted.kind === 'message' ? { message: accepted.message } : {}),
    ...(description === undefined ? {} : { description }),
    ...(context === undefined ? {} : { context }),
  };
}

function entryOf(message: CatalogMessage): MergedEntry {
  return mergedEntry(undefined, message);
}

function sameEntry(left: MergedEntry, right: MergedEntry): boolean {
  return (
    left.kind === right.kind &&
    left.message === right.message &&
    left.description === right.description &&
    left.context === right.context
  );
}

type BlockMapToken = CST.BlockMap;
type BlockMapItem = BlockMapToken['items'][number];

function scalarText(token: CST.Token | null | undefined): string | undefined {
  return CST.isScalar(token)
    ? CST.resolveAsScalar(token, true).value
    : undefined;
}

function mapItem(map: BlockMapToken, key: string): BlockMapItem | undefined {
  return map.items.find((item) => scalarText(item.key) === key);
}

/**
 * The style a replaced value keeps: a block scalar stays the block scalar its author chose, and a
 * flow scalar keeps its quoting unless the new text needs more.
 */
function replaceScalar(token: CST.Token, value: string): void {
  if (token.type === 'block-scalar') {
    CST.setScalarValue(token, value, { afterKey: true });
    return;
  }
  const needed = flowScalarStyle(value);
  CST.setScalarValue(token, value, {
    afterKey: true,
    type:
      needed === Scalar.QUOTE_DOUBLE || token.type === 'double-quoted-scalar'
        ? Scalar.QUOTE_DOUBLE
        : token.type === 'single-quoted-scalar'
          ? Scalar.QUOTE_SINGLE
          : needed,
  });
}

function flowScalar(value: string, indent: number): string {
  return CST.stringify(
    CST.createScalarToken(value, {
      indent,
      type: flowScalarStyle(value),
      end: [],
    }),
  );
}

/** The lines of one new entry, at the indentation of the mapping it joins. */
function entryLines(
  key: string,
  entry: MergedEntry,
  indent: number,
  step: number,
  newline: string,
  trailing = '',
): string {
  const outer = ' '.repeat(indent);
  const inner = ' '.repeat(indent + step);
  if (
    entry.kind === 'message' &&
    entry.description === undefined &&
    entry.context === undefined
  ) {
    return `${outer}${key}: ${flowScalar(entry.message as string, indent)}${trailing}${newline}`;
  }
  return [
    `${outer}${key}:${trailing}`,
    entry.kind === 'message'
      ? `${inner}message: ${flowScalar(entry.message as string, indent + step)}`
      : `${inner}empty: true`,
    ...(entry.description === undefined
      ? []
      : [
          `${inner}description: ${flowScalar(entry.description, indent + step)}`,
        ]),
    ...(entry.context === undefined
      ? []
      : [`${inner}context: ${flowScalar(entry.context, indent + step)}`]),
    '',
  ].join(newline);
}

/** The first mapping item of a snippet written at `indent`, ready to join a mapping there. */
function snippetItem(text: string, indent: number): BlockMapItem {
  const document = [...new Parser().parse(text)].find(
    (token): token is CST.Document => token.type === 'document',
  );
  const map = document?.value;
  if (map?.type !== 'block-map' || map.items[0] === undefined) {
    throw new TypeError('Thoth could not lay out a catalog entry.');
  }
  const item = map.items[0];
  return {
    ...item,
    start:
      indent === 0
        ? []
        : [{ type: 'space', offset: 0, indent: 0, source: ' '.repeat(indent) }],
  };
}

/** Whether the text of a mapping item, as it stands, ends its last line. */
function endsLine(item: BlockMapItem): boolean {
  return /\n$/u.test(CST.stringify(item));
}

function lineEnd(newline: string): CST.SourceToken {
  return { type: 'newline', offset: 0, indent: 0, source: newline };
}

/**
 * Appends an item to a mapping, after its last entry and before any comment that closes it.
 *
 * Appended rather than placed in key order, because key order is the author's and a translation
 * landing in the middle of a file reorders the lines around it in a review.
 */
function appendItem(
  map: BlockMapToken,
  item: BlockMapItem,
  newline: string,
): void {
  let index = map.items.length;
  while (index > 0 && map.items[index - 1]?.key === undefined) index -= 1;
  const previous = map.items[index - 1];
  if (previous !== undefined && !endsLine(previous)) {
    endLastLine(previous.value, newline);
  }
  map.items.splice(index, 0, item);
}

/** Ends the line a value finishes on, for a file whose last line has no line break. */
function endLastLine(value: CST.Token | undefined, newline: string): void {
  if (
    value?.type === 'scalar' ||
    value?.type === 'single-quoted-scalar' ||
    value?.type === 'double-quoted-scalar'
  ) {
    value.end = [...(value.end ?? []), lineEnd(newline)];
  } else if (value?.type === 'block-scalar') {
    value.source = `${value.source}${newline}`;
  } else if (value?.type === 'block-map') {
    endLastLine(value.items.at(-1)?.value, newline);
  } else {
    throw new TypeError('Thoth could not lay out a catalog entry.');
  }
}

/** The comment written after a value on its own line, kept when that value is replaced. */
function trailingComment(token: CST.Token | undefined): string {
  if (token === undefined || !('end' in token) || !Array.isArray(token.end)) {
    return '';
  }
  const comment = token.end.find(
    (part: CST.SourceToken) => part.type === 'comment',
  );
  return comment === undefined ? '' : ` ${comment.source}`;
}

/** The indentation one level of nesting adds in this file, read from an entry that has some. */
function nestingStep(messages: BlockMapToken): number {
  for (const item of messages.items) {
    if (item.value?.type === 'block-map') {
      return item.value.indent - messages.indent;
    }
  }
  return messages.indent > 0 ? messages.indent : 2;
}

function setEntryInMap(
  entryMap: BlockMapToken,
  entry: MergedEntry,
  existing: MergedEntry,
  newline: string,
): void {
  const textItem = mapItem(entryMap, 'message') ?? mapItem(entryMap, 'empty');
  const key = textItem?.key;
  const value = textItem?.value;
  if (key === undefined || key === null || value === undefined) {
    throw new TypeError('Thoth could not lay out a catalog entry.');
  }
  if (entry.kind === 'message') {
    const message = entry.message as string;
    if (scalarText(key) !== 'message') {
      CST.setScalarValue(key, 'message', { implicitKey: true });
    }
    if (existing.kind === 'empty') {
      // `true` is written plain, and a message written plain in its place has to earn that itself.
      CST.setScalarValue(value, message, {
        afterKey: true,
        type: flowScalarStyle(message),
      });
    } else if (existing.message !== message) {
      replaceScalar(value, message);
    }
  } else if (existing.kind !== 'empty') {
    CST.setScalarValue(key, 'empty', { implicitKey: true });
    CST.setScalarValue(value, 'true', { afterKey: true, type: Scalar.PLAIN });
  }
  for (const field of ['description', 'context'] as const) {
    const value = entry[field];
    if (value === undefined || value === existing[field]) continue;
    const item = mapItem(entryMap, field);
    if (item?.value !== undefined) {
      replaceScalar(item.value, value);
      continue;
    }
    appendItem(
      entryMap,
      snippetItem(
        `${' '.repeat(entryMap.indent)}${field}: ${flowScalar(value, entryMap.indent)}${newline}`,
        entryMap.indent,
      ),
      newline,
    );
  }
}

/**
 * Writes accepted translations into a target catalog a person may have edited, and changes nothing
 * else in it.
 *
 * `formatCatalog` writes a whole file from the model, which is right only where no file exists:
 * every comment, the key order and every block scalar of the authored file would go. This edits the
 * file's concrete syntax tree instead, so the text of every entry the translations do not change is
 * the text that was there, and a changed entry keeps its quoting, its block style and the comments
 * around it wherever the new text allows. An entry new to the file is appended to `messages`.
 *
 * The result is parsed back and compared with what was asked for, entry by entry, and refused when
 * it differs: a file that parses to something other than the translations accepted is worse than
 * one left alone.
 */
export function mergeTargetCatalogSource(
  source: string,
  accepted: Readonly<Record<string, CatalogMessage>>,
  options: CatalogParseOptions,
): ToolkitResult<string> {
  const parsed = parseCatalog(source, options);
  if (!parsed.ok) return parsed;
  const refused = (reason: string): ToolkitResult<string> =>
    toolkitFailure([
      toolkitDiagnostic(
        'TH1703',
        `Thoth refused writing translations into ${JSON.stringify(options.sourcePath ?? 'the target catalog')} because ${reason}.`,
      ),
    ]);
  if (parsed.value.role !== 'target') {
    return refused('it is not a target catalog');
  }
  const changes = Object.keys(accepted)
    .sort(compareCodeUnit)
    .flatMap((id) => {
      const existing = parsed.value.messages[id];
      const entry = mergedEntry(existing, accepted[id] as CatalogMessage);
      return existing !== undefined && sameEntry(entryOf(existing), entry)
        ? []
        : [{ id, entry, existing }];
    });
  if (changes.length === 0) return toolkitSuccess(source);

  const newline =
    source.includes('\r\n') && !/(?<!\r)\n/u.test(source) ? '\r\n' : '\n';
  const tokens = [...new Parser().parse(source)];
  const root = tokens.find(
    (token): token is CST.Document => token.type === 'document',
  )?.value;
  const messagesItem =
    root?.type === 'block-map' ? mapItem(root, 'messages') : undefined;
  if (root?.type !== 'block-map' || messagesItem === undefined) {
    return refused('its root is not a block mapping holding messages');
  }
  const messageMap = messagesItem.value;
  if (messageMap?.type !== 'block-map') {
    // A flow mapping is one line or a hand-wrapped set of them, and an entry added to it would have
    // to rewrap lines the author laid out.
    return refused('its messages are a flow mapping');
  }
  try {
    const step = nestingStep(messageMap);
    for (const { id, entry, existing } of changes) {
      const item = mapItem(messageMap, id);
      if (item === undefined) {
        appendItem(
          messageMap,
          snippetItem(
            entryLines(id, entry, messageMap.indent, step, newline),
            messageMap.indent,
          ),
          newline,
        );
        continue;
      }
      const value = item.value;
      const scalarOnly =
        entry.kind === 'message' &&
        entry.description === undefined &&
        entry.context === undefined;
      if (CST.isScalar(value) && scalarOnly) {
        replaceScalar(value, entry.message as string);
        continue;
      }
      if (value?.type === 'block-map' && existing !== undefined) {
        setEntryInMap(value, entry, entryOf(existing), newline);
        continue;
      }
      // A one-line entry that now needs fields of its own becomes a mapping, with the comment that
      // followed the old value moved up beside its key.
      const replacement = snippetItem(
        entryLines(
          id,
          entry,
          messageMap.indent,
          step,
          newline,
          trailingComment(value),
        ),
        messageMap.indent,
      );
      item.sep = replacement.sep ?? [];
      item.value = replacement.value as CST.Token;
    }
  } catch (error) {
    if (error instanceof TypeError) {
      return refused('its layout could not be kept');
    }
    throw error;
  }
  const merged = tokens.map((token) => CST.stringify(token)).join('');
  const reread = parseCatalog(merged, options);
  if (!reread.ok) return refused('the merged file did not parse back');
  const expected = new Map(
    Object.entries(parsed.value.messages).map(([id, message]) => [
      id,
      entryOf(message),
    ]),
  );
  for (const id of Object.keys(accepted)) {
    expected.set(
      id,
      mergedEntry(parsed.value.messages[id], accepted[id] as CatalogMessage),
    );
  }
  const actual = reread.value.messages;
  if (
    Object.keys(actual).length !== expected.size ||
    [...expected].some(
      ([id, entry]) =>
        actual[id] === undefined ||
        !sameEntry(entryOf(actual[id] as CatalogMessage), entry),
    ) ||
    Object.entries(parsed.value.messages).some(
      ([id, message]) =>
        accepted[id] === undefined &&
        JSON.stringify(actual[id]) !== JSON.stringify(message),
    )
  ) {
    return refused('the merged file did not read back as the translations');
  }
  return toolkitSuccess(merged);
}

/** What `formatCatalog` is told beside the catalog. */
export interface CatalogFormatOptions {
  /**
   * The registry the catalog's extension functions and segment types come from.
   *
   * Needed only for a catalog assembled by the caller that names one: what `parseCatalog`
   * returned was judged under its own registry.
   */
  readonly extensions?: ExtensionRegistry;
}

/**
 * Write a catalog that does not exist yet, from the model.
 *
 * Correct only where there is no authored file to preserve: an interchange import creating a
 * target catalog for the first time. Anything editing a file a person wrote goes through
 * `formatCatalogSource`.
 *
 * Returns the text of the file, as `exportXliff22` and `formatCatalogSource` return theirs. A
 * catalog the caller assembled is judged first as `parseCatalog` judges the same content, so one
 * that no file could hold is refused with those diagnostics and nothing is written for it.
 */
export function formatCatalog(
  catalog: Catalog,
  options: CatalogFormatOptions = {},
): ToolkitResult<string> {
  requireArgument('formatCatalog', 'catalog', catalog, 'record');
  requireArgument('formatCatalog', 'options', options, {
    optional: { extensions: EXTENSION_REGISTRY_ARGUMENT },
  });
  const admitted = admitOneCatalog(catalog, { extensions: options.extensions });
  return admitted.ok ? toolkitSuccess(catalogText(admitted.value)) : admitted;
}

/** The canonical text of a catalog already judged, which is what `formatCatalog` returns. */
export function catalogText(catalog: Catalog): string {
  const value = {
    messages: Object.fromEntries(
      Object.entries(catalog.messages).map(([messageId, message]) => [
        messageId,
        authoredMessage(message),
      ]),
    ),
    ...(Object.keys(catalog.families).length === 0
      ? {}
      : {
          families: Object.fromEntries(
            Object.entries(catalog.families).map(([name, family]) => [
              name,
              authoredFamily(family),
            ]),
          ),
        }),
  };
  return stringify(value, {
    defaultKeyType: 'PLAIN',
    defaultStringType: 'QUOTE_DOUBLE',
    doubleQuotedAsJSON: true,
    lineWidth: 0,
    simpleKeys: true,
  });
}

/**
 * The catalogs that need no judging: one `admitCatalog` judged, and one the toolkit built itself
 * out of a catalog that was.
 */
const admittedCatalogs = new WeakSet<object>();

/**
 * Records a catalog the toolkit built from admitted content, a pseudo-locale or an imported
 * translation, so handing it back to an entry point does not write and parse it again.
 */
export function builtCatalog(catalog: Catalog): Catalog {
  admittedCatalogs.add(catalog);
  return catalog;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether a message has the members `authoredMessage` reads, each of the kind it reads them as. */
function writableMessage(value: unknown): value is CatalogMessage {
  if (!isRecord(value)) return false;
  if (value['kind'] !== 'message' && value['kind'] !== 'empty') return false;
  const refinements = [value['inputs'], value['slots']];
  return refinements.every(
    (record) => isRecord(record) && Object.values(record).every(isRecord),
  );
}

/**
 * What a catalog object would be as an authored file, whatever its members hold.
 *
 * A member that has the catalog's own shape is written the way `formatCatalog` writes it. One
 * that does not is written as it stands, so the schema the parser applies is what refuses it and
 * the refusal is the one a file holding the same thing gets.
 */
function authoredDocument(catalog: Readonly<Record<string, unknown>>): unknown {
  const authoredEntries = (
    record: unknown,
    authored: (entry: unknown) => unknown,
  ): unknown =>
    isRecord(record)
      ? Object.fromEntries(
          Object.entries(record).map(([key, entry]) => [key, authored(entry)]),
        )
      : record;
  const families = catalog['families'];
  return {
    messages: authoredEntries(catalog['messages'], (message) =>
      writableMessage(message) ? authoredMessage(message) : message,
    ),
    ...(families === undefined ||
    (isRecord(families) && Object.keys(families).length === 0)
      ? {}
      : {
          families: authoredEntries(families, (family) =>
            isRecord(family) &&
            typeof family['template'] === 'string' &&
            isRecord(family['segments'])
              ? authoredFamily(family as unknown as CatalogFamily)
              : family,
          ),
        }),
  };
}

/**
 * Judges a catalog a caller hands a programmatic entry point, before anything reads it.
 *
 * What `parseCatalog` returned has been judged and is answered as it is. Any other object is a
 * catalog nobody has read: it is written as the file it would be and parsed under its own role,
 * identity and locale, so it is refused for what `parseCatalog` refuses and with the same
 * diagnostics, and what compiles is what its message text says and not a model the caller placed
 * beside the text. The diagnostics carry no position, because the text they would point into is
 * one no file holds.
 */
export function admitCatalog(
  catalog: Catalog,
  known: KnownExtensions = {},
): ToolkitResult<Catalog> {
  return admitOneCatalog(catalog, known);
}

/**
 * The extensions a handed-over catalog may name: a registry, or the message functions alone where
 * an entry point is given those and no registry.
 */
export interface KnownExtensions {
  readonly extensions?: ExtensionRegistry | undefined;
  readonly customFunctions?: readonly MessageCustomFunction[] | undefined;
}

/** Admits each catalog of a set, and refuses the set with every refusal when any is refused. */
export function admitCatalogs(
  catalogs: readonly Catalog[],
  known: KnownExtensions = {},
): ToolkitResult<readonly Catalog[]> {
  const admitted = catalogs.map((catalog) => admitOneCatalog(catalog, known));
  const refused = admitted.flatMap((result) =>
    result.ok ? [] : result.diagnostics,
  );
  return refused.length > 0
    ? toolkitFailure(refused)
    : toolkitSuccess(
        Object.freeze(
          admitted.flatMap((result) => (result.ok ? [result.value] : [])),
        ),
      );
}

function admitOneCatalog(
  catalog: Catalog,
  { extensions, customFunctions }: KnownExtensions,
): ToolkitResult<Catalog> {
  if (catalogSourceText.has(catalog) || admittedCatalogs.has(catalog)) {
    return toolkitSuccess(catalog);
  }
  const handed = catalog as unknown as Readonly<Record<string, unknown>>;
  let parsed: ToolkitResult<Catalog>;
  try {
    const role = handed['role'];
    if (role !== 'source' && role !== 'target') {
      return toolkitFailure([
        toolkitDiagnostic(
          'TH1102',
          'Catalog role must be "source" or "target".',
          { path: ['role'] },
        ),
      ]);
    }
    const sourcePath = handed['sourcePath'];
    parsed = parseCatalogText(
      stringify(authoredDocument(handed), {
        defaultKeyType: 'PLAIN',
        defaultStringType: 'QUOTE_DOUBLE',
        doubleQuotedAsJSON: true,
        lineWidth: 0,
        simpleKeys: true,
      }),
      {
        role,
        providerId: handed['providerId'] as string,
        scopeId: handed['scopeId'] as string,
        locale: handed['locale'] as string,
        ...(typeof sourcePath === 'string' ? { sourcePath } : {}),
        ...(extensions === undefined ? {} : { extensions }),
      },
      customFunctions ?? messageCustomFunctions(extensions),
    );
  } catch {
    // A member that cannot be read or written as data: an accessor that throws, a value YAML has
    // no form for. Nothing narrower can be said about it without reading it again.
    return toolkitFailure([
      toolkitDiagnostic(
        'TH1101',
        'A catalog handed over as an object holds a value that cannot be written as catalog data.',
      ),
    ]);
  }
  if (!parsed.ok) {
    return toolkitFailure(
      parsed.diagnostics.map(({ code, summary, severity, path }) =>
        toolkitDiagnostic(code, summary, { severity, path }),
      ),
    );
  }
  // A copy, so the text this was parsed from is not kept as the place its diagnostics point into.
  const admitted: Catalog = Object.freeze({ ...parsed.value });
  admittedCatalogs.add(admitted);
  return toolkitSuccess(admitted);
}
