/**
 * The capability matrix: every capability Equator ships as a row, every context the gate verifies
 * in as a column, and in each cell the claims that exercised it or the reason it cannot be.
 *
 * `specs/12-verification.spec.md` section 3 is what this answers to. Rows and columns are derived
 * from what the release publishes and what its gate declares, never listed beside them, so a
 * capability or a context added later is in the matrix on the day it lands. A cell is exercised by
 * a claim (`capability-claims.mjs`) from a check that passed, in a context read while it ran, and by
 * nothing else. Every other cell carries a reason from `capability-matrix-reasons.json` or is red.
 *
 * Everything here is a function of its inputs, so the self-test can hand it planted ones and watch
 * it refuse them, and `verify-matrix.mjs` is only the part that reads the real ones.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as playwright from 'playwright';
import ts from 'typescript';

import { consumerProfiles } from './package-consumer-profiles.mjs';
import {
  composableExports,
  publishedNames,
  returnTypeOf,
  runtimeDeclarations,
  toolkitDeclaration,
} from './published-surface.mjs';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------------------------
// Reading the declarations
// ---------------------------------------------------------------------------------------------

/** The names a declaration file exports as values, which leaves out `export type { ... }`. */
function valueNames(text) {
  const names = new Set();
  for (const [, group] of text.matchAll(/export\s+\{([^}]*)\}/gu)) {
    for (const entry of group.split(',')) {
      const name = entry
        .trim()
        .split(/\s+as\s+/u)
        .at(-1)
        ?.trim();
      if (name && /^[A-Za-z_$][\w$]*$/u.test(name)) names.add(name);
    }
  }
  return names;
}

/** A declared function's parameter list, found by balancing parentheses as `returnTypeOf` does. */
function parametersOf(text, name) {
  const declaration = new RegExp(
    `declare function ${name}\\b(?:<[^(]*>)?\\(`,
    'u',
  ).exec(text);
  if (declaration === null) return undefined;
  const start = declaration.index + declaration[0].length;
  let depth = 1;
  let index = start;
  while (index < text.length && depth > 0) {
    if (text[index] === '(') depth += 1;
    else if (text[index] === ')') depth -= 1;
    index += 1;
  }
  return text.slice(start, index - 1);
}

/** The body of a declared interface, from its brace to the matching one. */
function interfaceBody(text, name) {
  const head = new RegExp(`\\binterface ${name}\\b[^{]*\\{`, 'u').exec(text);
  if (head === null) return undefined;
  let depth = 1;
  let index = head.index + head[0].length;
  const start = index;
  while (index < text.length && depth > 0) {
    if (text[index] === '{') depth += 1;
    else if (text[index] === '}') depth -= 1;
    index += 1;
  }
  return text.slice(start, index - 1);
}

/** The member names of a declared union of type names or of string literals. */
function unionMembers(text, name) {
  const match = new RegExp(`\\btype ${name}\\s*=\\s*([^;]*);`, 'u').exec(text);
  if (match === null) return undefined;
  return match[1]
    .split('|')
    .map((member) => member.trim())
    .filter((member) => member.length > 0);
}

/** A union of literals, as the strings it admits. */
function literalUnion(text, name) {
  const members = unionMembers(text, name);
  assert.ok(
    members !== undefined,
    `No union named ${name} in the built declarations. The rows it gives would silently be none.`,
  );
  return members.map((member) => {
    const literal = /^'([^']*)'$/u.exec(member);
    assert.ok(literal, `${name} has a member that is not a literal: ${member}`);
    return literal[1];
  });
}

/** A union of interfaces, as each member's name and the literal its `kind` carries. */
function kindUnion(text, name) {
  const members = unionMembers(text, name);
  assert.ok(
    members !== undefined,
    `No union named ${name} in the built declarations. The rows it gives would silently be none.`,
  );
  return members.map((member) => {
    const body = interfaceBody(text, member);
    assert.ok(
      body !== undefined,
      `${name} names ${member}, which is not an interface here.`,
    );
    const kind = /\breadonly kind: '([^']+)';/u.exec(body);
    assert.ok(kind, `${member}, a member of ${name}, carries no literal kind.`);
    return { member, kind: kind[1], body };
  });
}

/** Whether a published interface declares a member, the resolution a registry entry is held to. */
function declaresMember(texts, owner, member) {
  return texts.some((text) => {
    const body = interfaceBody(text, owner);
    return (
      body !== undefined &&
      new RegExp(`^\\s*readonly ${member}\\??:`, 'mu').test(body)
    );
  });
}

// ---------------------------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------------------------

/**
 * The four ways a page reaches a reader. They are not a list anything else publishes: a page is
 * rendered on the server or prerendered (`specs/07-routing-rendering-and-seo.spec.md` section 9),
 * then hydrated or reached by a client navigation, which that specification treats as their own
 * cases. Each is read from what a claim observed rather than from what the check says it did.
 */
const RENDER_CONTEXTS = Object.freeze([
  {
    id: 'render:server',
    name: 'server render',
    matches: (claim) =>
      claim.platform === 'server' || (claim.document ?? []).includes('ssr'),
  },
  {
    id: 'render:prerender',
    name: 'prerender',
    matches: (claim) => (claim.document ?? []).includes('ssg'),
  },
  {
    id: 'render:client-navigation',
    name: 'client navigation',
    matches: (claim) => (claim.clientNavigations ?? 0) > 0,
  },
  {
    id: 'render:hydration',
    name: 'hydration',
    matches: (claim) => (claim.adoptedElements ?? 0) > 0,
  },
]);

/**
 * A policy's variants are its booleans, and a boolean is a variant only once it has a name here.
 * The derivation below fails on a boolean it cannot place, so a policy that gains one gains a
 * column the day it lands, or fails the stage until someone names it.
 */
const POLICY_VARIANTS = Object.freeze({
  'path-prefix': Object.freeze({ omitDefaultPrefix: 'default-locale-prefix' }),
});

function policyColumns(core) {
  const members = kindUnion(core, 'LocaleUrlPolicy');
  const columns = [];
  for (const { member, kind, body } of members) {
    columns.push({ kind, variant: undefined, member });
    for (const [, flag] of body.matchAll(/^\s*readonly (\w+): boolean;/gmu)) {
      const variant = POLICY_VARIANTS[kind]?.[flag];
      assert.ok(
        variant !== undefined,
        `${member} carries the boolean ${flag}, which is a policy variant the matrix has no column for. Name it in POLICY_VARIANTS.`,
      );
      columns.push({ kind, variant: { flag, name: variant }, member });
    }
  }
  return columns.map(({ kind, variant, member }) => {
    const name = variant?.name ?? kind;
    const flags = Object.entries(POLICY_VARIANTS[kind] ?? {});
    return {
      id: `policy:${name}`,
      group: 'URL policy',
      name,
      member,
      flag: variant?.flag,
      matches: (claim) =>
        claim.policy?.kind === kind &&
        flags.every(([flag]) =>
          flag === variant?.flag
            ? claim.policy[flag] === true
            : claim.policy[flag] !== true,
        ),
    };
  });
}

/** The supported Node lines, from the ranges the packages declare. */
function nodeColumns(ranges, developmentVersion) {
  const lines = ranges.split('||').map((range) => {
    const caret = /^\s*\^(\d+)\.(\d+)\.(\d+)\s*$/u.exec(range);
    assert.ok(
      caret,
      `The engines range "${range.trim()}" is not a caret range, and the matrix reads a Node line from nothing else.`,
    );
    return caret.slice(1).map(Number);
  });
  const satisfies = (version, [major, minor, patch]) => {
    const parts = /^(\d+)\.(\d+)\.(\d+)/u.exec(version ?? '');
    if (parts === null) return false;
    const [a, b, c] = parts.slice(1).map(Number);
    if (a !== major) return false;
    return b > minor || (b === minor && c >= patch);
  };
  assert.ok(
    lines.some((line) => satisfies(developmentVersion, line)),
    `.node-version is ${developmentVersion}, on no line the packages support, so the gate would run on a Node the matrix has no column for.`,
  );
  return lines.map((line) => ({
    id: `node:${line[0]}`,
    group: 'Node line',
    name: `Node ${line[0]}`,
    matches: (claim) => satisfies(claim.node, line),
  }));
}

/** The engines are the browsers Playwright drives, asked of Playwright rather than listed. */
function engineColumns() {
  const names = Object.values(playwright)
    .filter(
      (value) =>
        typeof value?.name === 'function' &&
        typeof value?.executablePath === 'function' &&
        typeof value?.launch === 'function',
    )
    .map((browserType) => browserType.name())
    .sort();
  for (const anchor of ['chromium', 'webkit']) {
    assert.ok(
      names.includes(anchor),
      `Playwright reports no ${anchor}, so the scan for its browser types has stopped matching.`,
    );
  }
  return names.map((name) => ({
    id: `engine:${name}`,
    group: 'Engine',
    name,
    matches: (claim) => claim.engine?.name === name,
  }));
}

/** The Angular rows are the consumer profiles the gate materializes. */
function angularColumns() {
  return [...consumerProfiles].map(([id, profile]) => ({
    id: `angular:${id}`,
    group: 'Angular row',
    name: profile.label,
    matches: (claim) => claim.angularRow === id,
  }));
}

// ---------------------------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------------------------

const CATEGORIES = Object.freeze({
  entry: 'Entry point',
  feature: 'Provider or feature',
  policy: 'URL policy',
  source: 'Locale source',
  store: 'Persistence store',
  pipe: 'Pipe',
  directive: 'Directive or component',
  control: 'Form control',
  format: 'Formatting kind',
  outcome: 'Page outcome',
  extension: 'Extension contract',
  declaration: 'Declaration',
  testing: 'Testing helper',
  cli: 'CLI command',
  capability: 'Capability',
});

// A binding is what the claiming check's own body must name for the claim to count: a list of
// requirements, all of which must hold, each met by any one of its tokens.
const named = (...names) => names.map((name) => ({ name }));
const literal = (...values) => values.map((value) => ({ literal: value }));
// A field the body declares for `key` in the options `withRouting` takes, and names. An application
// that classifies its routes by a field of its own declares the class through that field, and the
// default name it replaces appears nowhere in what it wrote.
const declaredField = (key) => ({ declaredField: key });

/**
 * The capabilities that are not one published name: a field a route declares, a contract an
 * application implements, a document the server answers. Each resolves to a published export or a
 * member of a published interface, and the stage fails on one that no longer does, so a capability
 * that is removed takes its row with it rather than leaving a row nothing can fill.
 */
const REGISTRY = Object.freeze([
  {
    id: 'extension:locale-participant',
    resolves: { export: 'LocalizationParticipant' },
    binding: [named('LocalizationParticipant')],
  },
  {
    id: 'extension:overlay-adapter',
    resolves: { export: 'LocalizationOverlayAdapter' },
    binding: [named('LocalizationOverlayAdapter')],
  },
  {
    id: 'extension:persistence-store',
    resolves: { export: 'LocalizationPersistenceStore' },
    binding: [named('LocalizationPersistenceStore')],
  },
  {
    id: 'extension:observability-sink',
    resolves: { export: 'LocalizationObservabilitySink' },
    binding: [named('LocalizationObservabilitySink')],
  },
  {
    id: 'declaration:route-indexing-class',
    resolves: { export: 'DEFAULT_ROUTE_INDEXING_FIELD' },
    binding: [
      [
        ...named('equatorIndexing', 'DEFAULT_ROUTE_INDEXING_FIELD'),
        declaredField('indexing'),
      ],
    ],
  },
  {
    id: 'declaration:route-caching-class',
    resolves: { export: 'DEFAULT_ROUTE_CACHING_FIELD' },
    binding: [
      [
        ...named('equatorCaching', 'DEFAULT_ROUTE_CACHING_FIELD'),
        declaredField('caching'),
      ],
    ],
  },
  {
    id: 'declaration:host-page-floor',
    resolves: { member: ['RouteCacheDurations', 'pageCaching'] },
    binding: [named('pageCaching')],
  },
  {
    id: 'declaration:route-sitemap-entry',
    resolves: { member: ['GeneratedRouteProjectionEntry', 'sitemap'] },
    binding: [named('sitemap', 'changefreq', 'priority')],
  },
  {
    id: 'declaration:document-metadata',
    resolves: { export: 'documentMessage' },
    binding: [named('documentMessage')],
  },
  {
    id: 'declaration:outcome-documents',
    resolves: { member: ['RouteLocalizationOptions', 'outcomeDocuments'] },
    binding: [named('outcomeDocuments')],
  },
  {
    id: 'declaration:localized-paths',
    resolves: { member: ['RouteRuntimeProjection', 'localizedPaths'] },
    binding: [named('localizedPaths')],
  },
  {
    id: 'declaration:route-parameter-codec',
    resolves: { member: ['RouteRuntimeProjection', 'parameters'] },
    binding: [
      named(
        'RouteParameterCodec',
        'parameters',
        'createIdentifierParameterCodec',
        'createIntegerParameterCodec',
      ),
    ],
  },
  {
    id: 'declaration:historical-route-outcome',
    resolves: { member: ['RouteRuntimeProjection', 'historical'] },
    binding: [named('historical', 'RouteHistoricalOutcome')],
  },
  {
    id: 'declaration:locale-neutral-roots',
    resolves: {
      member: ['PathPrefixLocalePolicyOptions', 'localeNeutralRoots'],
    },
    binding: [named('localeNeutralRoots')],
  },
  {
    id: 'declaration:locale-aliases',
    resolves: { member: ['PathPrefixLocalePolicyOptions', 'aliases'] },
    binding: [named('aliases')],
  },
  {
    id: 'declaration:x-default',
    resolves: { member: ['PathPrefixLocalePolicyOptions', 'xDefaultPath'] },
    binding: [named('xDefaultPath', 'xDefaultUrl')],
  },
  {
    id: 'declaration:locale-formatting',
    resolves: { member: ['GeneratedConfiguration', 'formatting'] },
    binding: [named('formatting', 'numberingSystem')],
  },
  {
    id: 'capability:sitemap',
    resolves: { member: ['RoutingOptions', 'sitemap'] },
    binding: [named('sitemap', 'projectSitemap', 'SitemapDocument')],
  },
  {
    id: 'capability:xliff',
    resolves: { export: 'exportXliff22' },
    binding: [named('exportXliff22', 'importXliff22')],
  },
  {
    id: 'capability:pseudo-locale',
    resolves: { export: 'createPseudoCatalog' },
    binding: [
      named(
        'createPseudoCatalog',
        'pseudoLocalizeMessage',
        'pseudoLocaleTags',
        'pseudoLocales',
        '--pseudo',
      ),
    ],
  },
  {
    id: 'capability:fallback-chain',
    resolves: { member: ['GeneratedConfiguration', 'localeFallbacks'] },
    binding: [
      named(
        'localeFallbacks',
        'parentLocales',
        'localeFallbackChain',
        'localeParent',
        'shippedFallbackChain',
      ),
    ],
  },
]);

/** The commands the built CLI lists in its own help, run where it acts on nothing. */
function cliCommands() {
  const elsewhere = mkdtempSync(join(tmpdir(), 'equator-matrix-help-'));
  try {
    const help = execFileSync(
      process.execPath,
      [resolve(workspaceRoot, 'dist/toolkit/cli.js'), '--help'],
      { cwd: elsewhere, encoding: 'utf8' },
    ).replaceAll('\r\n', '\n');
    const block = /\nCommands:\n((?: {2}\S+ +\S.*\n)+)/u.exec(help);
    assert.ok(block, 'The built CLI printed no Commands section in its help.');
    const commands = block[1]
      .trimEnd()
      .split('\n')
      .map((line) => line.trim().split(/\s+/u)[0]);
    for (const anchor of ['init', 'uninstall']) {
      assert.ok(
        commands.includes(anchor),
        `The built CLI's help lists no ${anchor}, so reading its commands has stopped matching.`,
      );
    }
    return commands;
  } finally {
    rmSync(elsewhere, { recursive: true, force: true });
  }
}

/** Every row, derived from the built packages, with the one registry above. */
export function deriveRows() {
  const runtime = runtimeDeclarations();
  const toolkit = toolkitDeclaration();
  const text = (entryPoint) =>
    runtime.find((entry) => entry.entryPoint === entryPoint)?.text ?? '';
  const primary = text('neolorn-equator');
  const core = text('neolorn-equator-core');
  const testing = text('neolorn-equator-testing');
  const everything = [...runtime.map((entry) => entry.text), toolkit];
  const allValues = new Set(
    everything.flatMap((each) => [...valueNames(each)]),
  );
  const declaredIn = (name) =>
    everything.find((each) => returnTypeOf(each, name) !== undefined);

  const rows = [];
  const add = (category, name, binding, extra = {}) =>
    rows.push({ id: `${category}:${name}`, category, name, binding, ...extra });

  // Entry points, from the manifests' own export maps.
  const runtimeManifest = JSON.parse(
    readFileSync(resolve(workspaceRoot, 'dist/runtime/package.json'), 'utf8'),
  );
  const toolkitManifest = JSON.parse(
    readFileSync(resolve(workspaceRoot, 'dist/toolkit/package.json'), 'utf8'),
  );
  for (const [manifest, keep] of [
    [runtimeManifest, (key) => key !== './package.json'],
    [toolkitManifest, (key) => key === '.'],
  ]) {
    for (const key of Object.keys(manifest.exports).filter(keep)) {
      const specifier =
        key === '.' ? manifest.name : `${manifest.name}/${key.slice(2)}`;
      add('entry', specifier, [[{ specifier }]]);
    }
  }

  // What a consumer composes, except the testing entry point's, which are testing helpers.
  const testingValues = valueNames(testing);
  for (const name of composableExports().keys()) {
    if (!testingValues.has(name)) add('feature', name, [named(name)]);
  }

  // URL policies, one row per column, each named by the factory that makes it. A factory makes a
  // policy from options; a function that is handed a policy and returns one narrows it instead.
  const policyTypes = [
    'LocaleUrlPolicy',
    ...kindUnion(core, 'LocaleUrlPolicy').map(({ member }) => member),
  ];
  for (const column of policyColumns(core)) {
    const factories = [...valueNames(core)].filter((name) => {
      if (returnTypeOf(core, name) !== column.member) return false;
      const parameters = parametersOf(core, name) ?? '';
      if (policyTypes.some((type) => word(type).test(parameters))) return false;
      const omitted = /Omit<\w+,\s*'(\w+)'>/u.exec(parameters);
      return column.flag === undefined
        ? omitted === null
        : omitted?.[1] === column.flag;
    });
    assert.equal(
      factories.length,
      1,
      `The ${column.name} policy has ${factories.length} factories (${factories.join(', ')}); a row is named by exactly one.`,
    );
    add(
      'policy',
      column.name,
      [[...named(factories[0]), { observes: 'policy' }]],
      {
        policyColumn: column.id,
      },
    );
  }

  for (const source of literalUnion(primary, 'LocalizationLocaleSource')) {
    add('source', source, [literal(source)]);
  }

  for (const name of valueNames(primary)) {
    if (returnTypeOf(primary, name) === 'LocalizationPersistenceStoreFactory') {
      add('store', name, [named(name)]);
    }
  }

  for (const { text: each } of runtime) {
    for (const [, className, pipe] of each.matchAll(
      /ɵɵPipeDeclaration<(\w+), "([^"]+)"/gu,
    )) {
      add('pipe', pipe, [named(pipe, className)]);
    }
    for (const [, className, selector] of each.matchAll(
      /ɵɵ(?:Directive|Component)Declaration<(\w+)(?:<[^>]*>)?, "([^"]+)"/gu,
    )) {
      const tokens = [
        ...new Set(
          [...selector.matchAll(/\[([\w-]+)\]|^([\w-]+)|, ([\w-]+)/gu)].map(
            (match) => match[1] ?? match[2] ?? match[3],
          ),
        ),
      ];
      add('directive', className, [named(className, ...tokens)]);
    }
  }

  const inputFunctions = [...allValues].filter((name) =>
    /localizedinput/iu.test(name),
  );
  for (const { kind } of kindUnion(core, 'LocalizedInputProfile')) {
    add('control', kind, [literal(kind), named(...inputFunctions)]);
  }

  for (const name of valueNames(primary)) {
    if (/:\s*FormattingContext\b/u.test(parametersOf(primary, name) ?? '')) {
      add('format', name, [named(name)]);
    }
  }

  for (const name of allValues) {
    const returned = returnTypeOf(declaredIn(name) ?? '', name) ?? '';
    if (/^(?:PageOutcome|Declared)\w+$/u.test(returned))
      add('outcome', name, [named(name)]);
  }

  for (const { kind } of kindUnion(core, 'RuntimeExtensionDescriptor')) {
    add('extension', kind, [literal(kind)]);
  }

  for (const name of testingValues) add('testing', name, [named(name)]);

  const toolkitValues = [...valueNames(toolkit)];
  for (const command of cliCommands()) {
    add('cli', command, [
      [
        ...literal(command),
        ...named(`equator ${command}`),
        ...named(...toolkitValues.filter((name) => name.startsWith(command))),
      ],
    ]);
  }

  const resolveFailures = [];
  for (const entry of REGISTRY) {
    const [category, name] = entry.id.split(/:(.*)/u);
    const resolved =
      entry.resolves.export !== undefined
        ? allValues.has(entry.resolves.export) ||
          everything.some((each) =>
            publishedNames(each).has(entry.resolves.export),
          )
        : declaresMember(everything, ...entry.resolves.member);
    // A declaration read under a key `withRouting` no longer takes would still match the checks
    // written before it went, and go on crediting a declaration nobody can make.
    const declarable = entry.binding
      .flat()
      .every(
        ({ declaredField: key }) =>
          key === undefined ||
          declaresMember(everything, 'RoutingOptions', key),
      );
    if (!resolved || !declarable) resolveFailures.push(entry.id);
    add(category, name, entry.binding);
  }

  // A capability exported from two entry points is one capability.
  const unique = new Map();
  for (const row of rows) if (!unique.has(row.id)) unique.set(row.id, row);

  for (const anchor of [
    'entry:@neolorn/equator/http',
    'feature:withRouting',
    'pipe:localizedMoney',
    'directive:LocalizedInput',
    'control:money',
    'format:formatMoney',
    'outcome:pageAbsent',
    'store:cookieStore',
    'testing:renderedText',
  ]) {
    assert.ok(
      unique.has(anchor),
      `No row ${anchor}. The derivation that gives it has stopped matching, and the rows it misses would be missing without anyone seeing it.`,
    );
  }
  return { rows: [...unique.values()], resolveFailures };
}

/** Every column, derived from the gate's own declarations. */
export function deriveColumns() {
  const core =
    runtimeDeclarations().find(
      (entry) => entry.entryPoint === 'neolorn-equator-core',
    )?.text ?? '';
  const manifest = JSON.parse(
    readFileSync(resolve(workspaceRoot, 'dist/runtime/package.json'), 'utf8'),
  );
  const developmentVersion = readFileSync(
    resolve(workspaceRoot, '.node-version'),
    'utf8',
  ).trim();
  return [
    ...RENDER_CONTEXTS.map((column) => ({ ...column, group: 'Render' })),
    ...policyColumns(core).map(({ id, group, name, matches }) => ({
      id,
      group,
      name,
      matches,
    })),
    ...engineColumns(),
    ...nodeColumns(manifest.engines.node, developmentVersion),
    ...angularColumns(),
  ];
}

// ---------------------------------------------------------------------------------------------
// Reasons
// ---------------------------------------------------------------------------------------------

/** Rows or columns a selector names: an exact id, or a whole category or group as `name:*`. */
function select(selectors, items, prefixOf) {
  const chosen = new Set();
  const unknown = [];
  for (const selector of selectors) {
    const hits = selector.endsWith(':*')
      ? items.filter((item) => prefixOf(item) === selector.slice(0, -2))
      : items.filter((item) => item.id === selector);
    if (hits.length === 0) unknown.push(selector);
    for (const hit of hits) chosen.add(hit.id);
  }
  return { chosen, unknown };
}

export function loadReasons(
  path = resolve(workspaceRoot, 'tools/capability-matrix-reasons.json'),
) {
  return JSON.parse(readFileSync(path, 'utf8')).reasons;
}

// ---------------------------------------------------------------------------------------------
// Claim sites: where each claim is made, read from the source of the check that makes it
// ---------------------------------------------------------------------------------------------

/** The two functions a check claims through, and the argument each takes the capability in. */
const CLAIMING = Object.freeze([
  {
    module: 'capability-claims-in-tests.mjs',
    name: 'claimCapability',
    argument: 0,
  },
  {
    module: 'capability-evidence.mjs',
    name: 'recordCapabilityClaim',
    argument: 1,
  },
]);

const functionLike = (node) =>
  ts.isArrowFunction(node) ||
  ts.isFunctionExpression(node) ||
  ts.isFunctionDeclaration(node) ||
  ts.isMethodDeclaration(node);

const calleeRoot = (expression) => {
  let current = expression;
  while (
    ts.isPropertyAccessExpression(current) ||
    ts.isCallExpression(current)
  ) {
    current = ts.isCallExpression(current)
      ? current.expression
      : current.expression;
  }
  return ts.isIdentifier(current) ? current.text : undefined;
};

/** The body a claim is judged against: the test it is in, or the function a plain check runs. */
function claimingBody(call) {
  let nearest;
  for (let node = call.parent; node !== undefined; node = node.parent) {
    if (!functionLike(node)) continue;
    nearest ??= node;
    const parent = node.parent;
    if (
      parent !== undefined &&
      ts.isCallExpression(parent) &&
      parent.arguments.includes(node) &&
      ['it', 'test'].includes(calleeRoot(parent.expression))
    ) {
      return node;
    }
  }
  return nearest;
}

// Every key a binding reads a declared field under.
const DECLARED_KEYS = Object.freeze([
  ...new Set(
    REGISTRY.flatMap(({ binding }) => binding.flat())
      .map(({ declaredField: key }) => key)
      .filter((key) => key !== undefined),
  ),
]);

const nameOf = (node) =>
  node !== undefined && (ts.isIdentifier(node) || ts.isStringLiteralLike(node))
    ? node.text
    : undefined;

/**
 * The fields a body declares under each of `DECLARED_KEYS`, as `key: { field: '…' }`, written as
 * its own code or inside the source text it hands an analysis.
 *
 * Source text is read token by token rather than parsed: a check often writes a fragment of a file,
 * or a template whose substitutions leave no whole expression, and the declaration is the same
 * tokens in either. A field held in a binding is not read, so a check declaring one names nothing
 * through it.
 */
function declaredFieldsIn(body, strings) {
  const declared = new Map(DECLARED_KEYS.map((key) => [key, new Set()]));
  const visit = (node) => {
    const key = ts.isPropertyAssignment(node) ? nameOf(node.name) : undefined;
    if (declared.has(key) && ts.isObjectLiteralExpression(node.initializer)) {
      for (const property of node.initializer.properties) {
        if (
          ts.isPropertyAssignment(property) &&
          nameOf(property.name) === 'field' &&
          ts.isStringLiteralLike(property.initializer)
        ) {
          declared.get(key).add(property.initializer.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(body, visit);

  const name = (token) =>
    token !== undefined &&
    [
      ts.SyntaxKind.Identifier,
      ts.SyntaxKind.StringLiteral,
      ts.SyntaxKind.NoSubstitutionTemplateLiteral,
    ].includes(token.kind)
      ? token.value
      : undefined;
  for (const text of strings) {
    const scanner = ts.createScanner(
      ts.ScriptTarget.Latest,
      true,
      ts.LanguageVariant.Standard,
      text,
    );
    const tokens = [];
    for (
      let kind = scanner.scan();
      kind !== ts.SyntaxKind.EndOfFileToken;
      kind = scanner.scan()
    ) {
      tokens.push({ kind, value: scanner.getTokenValue() });
    }
    const is = (index, kind) => tokens[index]?.kind === kind;
    for (let start = 0; start < tokens.length; start += 1) {
      const key = name(tokens[start]);
      if (
        !declared.has(key) ||
        !is(start + 1, ts.SyntaxKind.ColonToken) ||
        !is(start + 2, ts.SyntaxKind.OpenBraceToken)
      ) {
        continue;
      }
      // Only `field` in the declaration's own object: a value table may hold a key of that name.
      let depth = 1;
      for (let at = start + 3; at < tokens.length && depth > 0; at += 1) {
        if (is(at, ts.SyntaxKind.OpenBraceToken)) depth += 1;
        else if (is(at, ts.SyntaxKind.CloseBraceToken)) depth -= 1;
        else if (
          depth === 1 &&
          name(tokens[at]) === 'field' &&
          is(at + 1, ts.SyntaxKind.ColonToken) &&
          (is(at + 2, ts.SyntaxKind.StringLiteral) ||
            is(at + 2, ts.SyntaxKind.NoSubstitutionTemplateLiteral))
        ) {
          declared.get(key).add(tokens[at + 2].value);
        }
      }
    }
  }
  return declared;
}

/**
 * Every claim a source file makes, with what the body around it names.
 *
 * The body's own words are its identifiers and the text of its strings and templates, the claim
 * calls' own arguments left out: a claim for `pipe:localizedMoney` names the pipe in its own
 * argument, and counting that would let every claim bind itself.
 */
export function claimSitesIn(path, text) {
  const claimers = CLAIMING.filter(({ module }) => text.includes(module));
  if (claimers.length === 0) return { sites: [], problems: [] };
  const source = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.ts') || path.endsWith('.mts')
      ? ts.ScriptKind.TS
      : ts.ScriptKind.JS,
  );
  const problems = [];
  const where = (node) =>
    `${path}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;

  const locals = new Map();
  // Only names that exist at run time. A type is erased before the check runs, so a body that names
  // one has loaded nothing from its module, and an entry point claimed on that is claimed on nothing.
  const imported = new Map();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const specifier = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    const typeOnly = clause?.isTypeOnly === true;
    const claimer = claimers.find(({ module }) =>
      specifier.endsWith(`/${module}`),
    );
    if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      if (!typeOnly) imported.set(clause.namedBindings.name.text, specifier);
      if (claimer !== undefined) {
        problems.push(
          `${where(statement)} imports the claim module whole; import ${claimer.name} by name so every claim can be found.`,
        );
      }
      continue;
    }
    if (clause?.name && !typeOnly) imported.set(clause.name.text, specifier);
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        if (!typeOnly && !element.isTypeOnly)
          imported.set(element.name.text, specifier);
        const original = (element.propertyName ?? element.name).text;
        if (claimer !== undefined && original === claimer.name) {
          locals.set(element.name.text, claimer);
        }
      }
    }
  }

  const sites = [];
  const visit = (node) => {
    if (ts.isIdentifier(node) && locals.has(node.text)) {
      const parent = node.parent;
      const isImport = ts.isImportSpecifier(parent);
      const isCall = ts.isCallExpression(parent) && parent.expression === node;
      if (!isImport && !isCall) {
        problems.push(
          `${where(node)} uses ${node.text} other than by calling it, so a claim made through it cannot be read.`,
        );
      }
      if (isCall) {
        const claimer = locals.get(node.text);
        const argument = parent.arguments[claimer.argument];
        if (
          argument === undefined ||
          !(
            ts.isStringLiteral(argument) ||
            ts.isNoSubstitutionTemplateLiteral(argument)
          )
        ) {
          problems.push(
            `${where(parent)} claims a capability that is not written as a literal, so the claim cannot be read without running the check.`,
          );
        } else {
          const body = claimingBody(parent);
          // What the claim observes, read from the object it is handed, so a claim that observes
          // the policy it runs is held to that rather than to naming a factory.
          const observation = parent.arguments[claimer.argument + 1];
          const observes = new Set(
            observation !== undefined &&
              ts.isObjectLiteralExpression(observation)
              ? observation.properties
                  .map((property) => property.name)
                  .filter((name) => name !== undefined && ts.isIdentifier(name))
                  .map((name) => name.text)
              : [],
          );
          if (body === undefined) {
            problems.push(
              `${where(parent)} claims ${argument.text} outside any test or function, so there is no body to hold it to.`,
            );
          } else {
            sites.push({
              path,
              line: where(parent),
              capability: argument.text,
              body,
              observes,
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  for (const site of sites) {
    const identifiers = new Set();
    const strings = [];
    const specifiers = new Set();
    const collect = (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        locals.has(node.expression.text)
      ) {
        return;
      }
      if (ts.isIdentifier(node)) {
        identifiers.add(node.text);
        if (imported.has(node.text)) specifiers.add(imported.get(node.text));
      } else if (
        ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)
      ) {
        strings.push(node.text);
      }
      ts.forEachChild(node, collect);
    };
    ts.forEachChild(site.body, collect);
    site.names = {
      identifiers,
      strings,
      specifiers,
      observes: site.observes,
      declared: declaredFieldsIn(site.body, strings),
    };
    delete site.body;
    delete site.observes;
  }
  return { sites, problems };
}

/** Every file a claim could be made in: the workspace suites, the fixtures, and the gate's tools. */
export function claimSites(root = workspaceRoot) {
  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (['node_modules', 'dist', 'tmp', '.git'].includes(entry.name))
        continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (
        /\.(?:ts|mts|mjs|cjs|js)$/u.test(entry.name) &&
        !entry.name.endsWith('.d.ts') &&
        !entry.name.endsWith('.d.mts')
      )
        files.push(path);
    }
  };
  for (const top of ['packages', 'fixtures', 'tools']) walk(resolve(root, top));
  const sites = [];
  const problems = [];
  for (const path of files) {
    const found = claimSitesIn(
      relative(root, path).split(sep).join('/'),
      readFileSync(path, 'utf8'),
    );
    sites.push(...found.sites);
    problems.push(...found.problems);
  }
  return { sites, problems };
}

const word = (name) =>
  new RegExp(
    `(?<![\\w$])${name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(?![\\w$])`,
    'u',
  );

/** Whether one token of a binding is named by a body. */
function names(
  token,
  { identifiers, strings, specifiers, observes, declared },
) {
  if (token.observes !== undefined) return observes.has(token.observes);
  const named = (name) =>
    identifiers.has(name) || strings.some((text) => word(name).test(text));
  if (token.name !== undefined) return named(token.name);
  if (token.declaredField !== undefined) {
    return [...declared.get(token.declaredField)].some(named);
  }
  if (token.literal !== undefined) return strings.includes(token.literal);
  if (token.specifier !== undefined) {
    return (
      specifiers.has(token.specifier) ||
      strings.some((text) => text.includes(token.specifier))
    );
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// The verdict
// ---------------------------------------------------------------------------------------------

/**
 * Fills the matrix and says everything wrong with it.
 *
 * `evidence` is one entry per claiming stage: `{ stage, missing, writers, claims, unreadable }`.
 * Every finding fails the stage; the red cells are one of them, and are also returned whole so the
 * report can list them.
 */
export function evaluateMatrix({
  rows,
  columns,
  reasons,
  evidence,
  sites,
  siteProblems = [],
  resolveFailures = [],
}) {
  const findings = [];
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const cellKey = (row, column) => `${row} @ ${column}`;
  const exercised = new Map();

  for (const id of resolveFailures) {
    findings.push({
      kind: 'dead-row',
      message: `${id} names a capability the built packages no longer publish.`,
    });
  }
  for (const problem of siteProblems)
    findings.push({ kind: 'unreadable-claim', message: problem });

  // Claim sites, held to their bodies.
  const sitesByCapability = new Map();
  for (const site of sites) {
    const row = rowById.get(site.capability);
    if (row === undefined) {
      findings.push({
        kind: 'unknown-row',
        message: `${site.line} claims ${site.capability}, which is not a row.`,
      });
      continue;
    }
    const held = row.binding.every((requirement) =>
      requirement.some((token) => names(token, site.names)),
    );
    if (!held) {
      findings.push({
        kind: 'mislabel',
        message: `${site.line} claims ${site.capability}, and its body never names it.`,
      });
      continue;
    }
    if (!sitesByCapability.has(site.capability))
      sitesByCapability.set(site.capability, []);
    sitesByCapability.get(site.capability).push(site);
  }

  // Evidence, stage by stage.
  for (const stage of evidence) {
    if (stage.missing) {
      findings.push({
        kind: 'missing-evidence',
        message: `${stage.stage} records claims and left no evidence. Its writer never ran, so nothing it asserted can be counted.`,
      });
      continue;
    }
    if (stage.writers.length === 0) {
      findings.push({
        kind: 'missing-evidence',
        message: `${stage.stage} left evidence with no writer in it, so it cannot be told from a file something else wrote.`,
      });
    }
    for (const line of stage.unreadable) {
      findings.push({
        kind: 'unreadable-evidence',
        message: `${stage.stage} evidence line ${line} is not a record.`,
      });
    }
    for (const claim of stage.claims) {
      const row = rowById.get(claim.capability);
      if (row === undefined) {
        findings.push({
          kind: 'unknown-row',
          message: `${stage.stage}: ${claim.check} claimed ${claim.capability}, which is not a row.`,
        });
        continue;
      }
      if (!sitesByCapability.has(claim.capability)) {
        findings.push({
          kind: 'unsited-claim',
          message: `${stage.stage}: ${claim.check} claimed ${claim.capability}, and no check's source makes that claim. The scan for claims is not seeing it.`,
        });
        continue;
      }
      // A policy row claimed while the check observed a different policy running is the one
      // mislabel the evidence itself can show, so it is refused here as well as at the source.
      if (row.policyColumn !== undefined && claim.policy !== undefined) {
        const column = columns.find((each) => each.id === row.policyColumn);
        if (!column.matches(claim)) {
          findings.push({
            kind: 'mislabel',
            message: `${stage.stage}: ${claim.check} claimed ${claim.capability} while observing the ${claim.policy.kind} policy.`,
          });
          continue;
        }
      }
      if (
        claim.node !== null &&
        !columns.some(
          (column) => column.group === 'Node line' && column.matches(claim),
        )
      ) {
        findings.push({
          kind: 'unsupported-context',
          message: `${stage.stage}: ${claim.check} ran on Node ${claim.node}, on no line the packages support.`,
        });
      }
      for (const column of columns) {
        if (!column.matches(claim)) continue;
        const key = cellKey(row.id, column.id);
        if (!exercised.has(key)) exercised.set(key, []);
        exercised.get(key).push(`${stage.stage}: ${claim.check}`);
      }
    }
  }

  // Reasons.
  const reasoned = new Map();
  for (const rule of reasons) {
    const selectedRows = select(rule.rows, rows, (row) => row.category);
    const selectedColumns = select(
      rule.columns,
      columns,
      (column) => column.id.split(':')[0],
    );
    for (const unknown of [
      ...selectedRows.unknown,
      ...selectedColumns.unknown,
    ]) {
      findings.push({
        kind: 'unknown-selector',
        message: `Reason ${rule.id} names ${unknown}, which selects nothing.`,
      });
    }
    let covered = 0;
    for (const row of selectedRows.chosen) {
      for (const column of selectedColumns.chosen) {
        if (rule.exceptOwnColumn === true && row === column) continue;
        covered += 1;
        const key = cellKey(row, column);
        if (exercised.has(key)) {
          findings.push({
            kind: 'stale-reason',
            message: `Reason ${rule.id} covers ${key}, which ${exercised.get(key)[0]} exercised. The reason has outlived its cause.`,
          });
          continue;
        }
        if (reasoned.has(key)) {
          findings.push({
            kind: 'duplicate-reason',
            message: `Reasons ${reasoned.get(key)} and ${rule.id} both cover ${key}.`,
          });
          continue;
        }
        reasoned.set(key, rule.id);
      }
    }
    if (covered === 0)
      findings.push({
        kind: 'idle-reason',
        message: `Reason ${rule.id} covers no cell.`,
      });
  }

  const red = [];
  for (const row of rows) {
    for (const column of columns) {
      const key = cellKey(row.id, column.id);
      if (!exercised.has(key) && !reasoned.has(key))
        red.push({ row: row.id, column: column.id });
    }
  }
  if (red.length > 0) {
    findings.push({
      kind: 'unreasoned',
      message: `${red.length} cells are neither exercised by a claim nor reasoned.`,
    });
  }
  return {
    cells: rows.length * columns.length,
    exercised,
    reasoned,
    red,
    findings,
  };
}
