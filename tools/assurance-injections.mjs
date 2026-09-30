/**
 * The injections `verify:assurance` applies, kept apart from the runner so the normative map can
 * name one as the check behind a statement without importing a script that patches source when it
 * loads.
 */

const PATHS_OVERLAY = `    paths: {
      ...(request.compilerOptions?.paths ?? {}),
      ...Object.fromEntries(virtualPathEntries),
    },`;

export const injections = Object.freeze([
  {
    id: 'consumer-paths-discarded',
    invariant:
      "Equator overlays its #i18n specifiers on the consumer's own paths instead of replacing them.",
    source: 'packages/toolkit/src/static-analysis.ts',
    find: PATHS_OVERLAY,
    replace: `    paths: {
      ...Object.fromEntries(virtualPathEntries),
    },`,
    caughtBy: 'packages/toolkit/test/semantic-model.test.ts',
  },
  {
    id: 'consumer-paths-discarded-through-the-cli',
    invariant:
      "A project compiled the way the CLI compiles it still resolves the consumer's own path aliases.",
    source: 'packages/toolkit/src/static-analysis.ts',
    find: PATHS_OVERLAY,
    replace: `    paths: {
      ...Object.fromEntries(virtualPathEntries),
    },`,
    caughtBy: 'packages/toolkit/test/consumer-source-diagnostics.test.ts',
  },
  {
    id: 'strictness-imposed',
    invariant:
      "Equator analyzes under the consumer's compiler options and never adds strictness of its own.",
    source: 'packages/toolkit/src/static-analysis.ts',
    find: PATHS_OVERLAY,
    replace: `${PATHS_OVERLAY}
    noUncheckedIndexedAccess: true,`,
    caughtBy: 'packages/toolkit/test/semantic-model.test.ts',
  },
  {
    id: 'missing-plural-categories-unreported',
    invariant:
      'A target locale that omits a plural category its rules require is reported (EQ1308).',
    source: 'packages/toolkit/src/semantic-model.ts',
    find: '    if (missing.length === 0) continue;',
    replace: '    if (missing.length >= 0) continue;',
    caughtBy: 'packages/toolkit/test/plural-coverage.test.ts',
  },
  {
    id: 'omitted-target-message-unreported',
    invariant:
      'A target catalog that omits a required message is reported (EQ1307).',
    source: 'packages/toolkit/src/semantic-model.ts',
    find: `        'EQ1307',`,
    replace: `        'EQ1306',`,
    caughtBy: 'packages/toolkit/test/target-completeness.test.ts',
  },
  {
    id: 'authored-bidi-admitted',
    invariant:
      'A bidirectional control that can reorder surrounding text is refused when a catalog is parsed.',
    source: 'packages/toolkit/src/catalog.ts',
    find: '      const violation = inspectAuthoredBidi(value);',
    replace: '      const violation = undefined as undefined;',
    caughtBy: 'packages/toolkit/test/bidi-policy.test.ts',
  },
  {
    id: 'stale-translation-restamped',
    invariant:
      'A translation whose source moved underneath it keeps its prior stamp and is reported stale.',
    source: 'packages/toolkit/src/translation-state.ts',
    find: '        if (prior === undefined || prior.target !== digest) {',
    replace: '        if (true) {',
    caughtBy: 'packages/toolkit/test/translation-state.test.ts',
  },
  {
    id: 'untrusted-input-coerced',
    invariant:
      'A validator checks that untrusted input is a string before any grammar reads it.',
    source: 'packages/toolkit/src/untrusted-text.ts',
    find: "  if (typeof value !== 'string') {",
    replace: '  if (false as boolean) {',
    caughtBy: 'packages/toolkit/test/untrusted-input.test.ts',
  },
  {
    id: 'translator-notes-dropped',
    invariant:
      'Authored description and context reach the translator as XLIFF notes.',
    source: 'packages/toolkit/src/xliff.ts',
    find: `  return notes.length === 0
    ? []
    : ['      <notes>', ...notes, '      </notes>'];`,
    replace: '  return [];',
    caughtBy: 'packages/toolkit/test/translator-guidance.test.ts',
  },
  {
    id: 'missing-recovery-root-unreported',
    invariant:
      'An owner that composes the application runtime without a recovery root is an error in generate and check.',
    source: 'packages/toolkit/src/compiler.ts',
    find: '    analysis?.selectsApplicationRuntime === true &&',
    replace: '    false &&',
    caughtBy: 'packages/toolkit/test/reachability-and-recovery.test.ts',
  },
  {
    id: 'unused-source-messages-unreported',
    invariant:
      'Source messages nothing reaches are reported as a grouped advisory.',
    source: 'packages/toolkit/src/compiler.ts',
    find: '    diagnostics.push(...unusedSourceMessages(graph.value, analysis));',
    replace: '    void unusedSourceMessages(graph.value, analysis);',
    caughtBy: 'packages/toolkit/test/reachability-and-recovery.test.ts',
  },
  {
    id: 'build-command-authors-manifest',
    invariant:
      'Only equator init creates an owner manifest; build commands never author files.',
    source: 'packages/toolkit/src/project-host.ts',
    find: '  const packageManifest = await readPackageManifest(location.value);',
    replace:
      '  const packageManifest = await readPackageManifest(location.value, true);',
    caughtBy: 'packages/toolkit/test/multi-owner-workspace.test.ts',
  },
  {
    id: 'unknowable-route-subtree-named-from-the-root',
    invariant:
      'Routes below an address Equator cannot know are left unnamed, never named as if they sat at the top of the application.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: `    parentPath: string | undefined,
    parentLazyEntries: readonly string[],`,
    replace: `    parentPath: string | undefined = '',
    parentLazyEntries: readonly string[] = [],`,
    caughtBy: 'packages/toolkit/test/route-identity.test.ts',
  },
  {
    id: 'pathless-route-subtree-invisible',
    invariant:
      'A pathless layout route is descended through, so the routes and lazy boundaries beneath it are still read.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: `      const ownPath =
        declared.kind === 'literal' ? declared.path.text : undefined;
`,
    replace: `      const ownPath =
        declared.kind === 'literal' ? declared.path.text : undefined;
      if (ownPath === '') continue;
`,
    caughtBy: 'packages/toolkit/test/route-identity.test.ts',
  },
  {
    id: 'route-identity-collision-unreported',
    invariant:
      'Two addresses resolving to one identity are reported, and neither is projected.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: '    if (group.length > 1) {',
    replace: '    if (false && group.length > 1) {',
    caughtBy: 'packages/toolkit/test/route-identity.test.ts',
  },
  {
    id: 'generated-provider-unrecognized',
    invariant:
      'An application that composes the runtime through the generated provideLocalization() is recognized as one.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: `    resolved.name === 'provideLocalization' &&
    declaredIn(resolved, generatedRoot)`,
    replace: `    false &&
    declaredIn(resolved, generatedRoot)`,
    caughtBy: 'packages/toolkit/test/reachability-and-recovery.test.ts',
  },
  {
    id: 'provisional-overlay-omits-the-provider',
    invariant:
      'The overlay that resolves #i18n during analysis carries the provider an application composes through.',
    source: 'packages/toolkit/src/compiler.ts',
    find: "    provider: 'declaration',",
    replace: '    provider: false,',
    caughtBy: 'packages/toolkit/test/reachability-and-recovery.test.ts',
  },
  {
    id: 'consumer-route-field-ignored',
    invariant:
      "Route indexing reads the field the consumer named through withRouting, not one of Equator's invention.",
    source: 'packages/toolkit/src/static-analysis.ts',
    find: '  const field = policy?.field ?? DEFAULT_ROUTE_INDEXING_FIELD;',
    replace: '  const field = DEFAULT_ROUTE_INDEXING_FIELD;',
    caughtBy: 'packages/toolkit/test/route-identity.test.ts',
  },
  {
    id: 'selected-message-group-unreachable',
    invariant:
      'A message group handed to a call counts as a use of every message in it, so messages a running program selects are not reported unused.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: '        } else if (identity === undefined && !isPropertyName && handedOff) {',
    replace: '        } else if (false) {',
    caughtBy: 'packages/toolkit/test/issue-pairing.test.ts',
  },
  {
    id: 'message-group-receiver-counts-as-use',
    invariant:
      'Walking through a group to reach one message is not a use of the rest of it; otherwise the unused-message advisory could never fire.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: '          ts.isShorthandPropertyAssignment(node.parent) ||',
    replace: '          true ||',
    caughtBy: 'packages/toolkit/test/issue-pairing.test.ts',
  },
  {
    id: 'formatting-regenerates-authored-catalogs',
    invariant:
      'Formatting edits the authored document; regenerating it from the semantic model deletes every comment in it.',
    source: 'packages/toolkit/src/project-host.ts',
    find: '    const formatted = formatCatalogSource(file.source, catalogOptions);',
    replace: `    const formatted = formatCatalogSource(
      formatCatalog(file.catalog),
      catalogOptions,
    );`,
    caughtBy: 'packages/toolkit/test/lossless-format.test.ts',
  },
  {
    id: 'success-path-never-inspects-severity',
    invariant:
      'A command that did what it was asked still fails when it found something at error severity.',
    // The success path returned 0 unconditionally, so `equator check --require-complete` reported
    // `"status": "success"` while carrying EQ1310 at `severity: error`, and every later change
    // was verified by a gate that could not fail on the things it depended on.
    //
    // Returning false is the mutation because it is the shape the defect actually had: not a wrong
    // answer, an unasked question.
    source: 'packages/toolkit/src/diagnostics.ts',
    find: "  return diagnostics.some(({ severity }) => severity === 'error');",
    replace: '  return false;',
    caughtBy: 'packages/toolkit/test/gate-exit-code.test.ts',
  },
  {
    id: 'strict-freshness-opt-in-ignored',
    invariant:
      'The strict-freshness opt-in actually escalates the staleness advisory, rather than being parsed and dropped.',
    // The injection is the failure the invariant above names: a flag that is read but never
    // consulted. Pinning the severity to `warning` leaves the option, the flag and the plumbing all
    // present and makes the policy do nothing, which a test asserting only the on-case would pass.
    source: 'packages/toolkit/src/project-host.ts',
    find: "          severity: options.requireFreshOutput === true ? 'error' : 'warning',",
    replace: "          severity: 'warning',",
    caughtBy: 'packages/toolkit/test/strict-freshness.test.ts',
  },
  {
    id: 'numbering-system-dropped-when-formatting',
    invariant:
      'A number is rendered in the numbering system the context asked for, not in the locale default.',
    // `formatting.ts` and `parsing.ts` are the largest correctness surface in the runtime and
    // where every numbering-system finding has lived, and for a long time neither harness carried
    // a single injection naming either: every `source:` was `routing.ts`, `angular.ts`,
    // `localization.ts` or the router's public API.
    //
    // Dropping the numbering system is the regression that would actually happen, and it is
    // invisible to a self-consistent round trip: Equator would render `1234` where `١٢٣٤` was asked
    // for, parse it back to 1234, and be wrong for every reader.
    source: 'packages/runtime/src/formatting.ts',
    //
    // Pointed at a call site rather than at the helper, and worth an injection of its own for
    // that reason. The *helper* is already covered by
    // `numbering-system-passed-as-an-option-again`, but that proves the helper, not that each of the
    // nine call sites in this file actually uses what the helper returns. This drops the tag at one
    // site while leaving the validation above it intact, which is exactly the defect found in
    // `evaluator.ts`: a site that validates the numbering system and then formats without it.
    find: `    const formatter = cache.number(formattingTag, {
      ...options,
    });
    return success(
      semantic,
      formatter.format(number),`,
    replace: `    const formatter = cache.number(context.locale, {
      ...options,
    });
    return success(
      semantic,
      formatter.format(number),`,
    caughtBy: 'packages/runtime/test/numeric-formatting.test.ts',
  },
  {
    id: 'numbering-system-passed-as-an-option-again',
    invariant:
      'A number range and a duration are rendered in the numbering system the context asked for.',
    // `NumberFormat.formatRange`, `formatRangeToParts` and `DurationFormat.format` accept
    // a `numberingSystem` option, ignore it, and then report through `resolvedOptions()` that they
    // honoured it. Equator builds a `-u-nu-` tag instead; this mutation hands back the bare locale,
    // which is what passing the option amounted to.
    //
    // The validation is deliberately left intact, so what this removes is only the delivery. A test
    // that checked for the refusal alone would stay green.
    source: 'packages/runtime/src/evaluator.ts',
    find: `    return new Intl.Locale(locale, { numberingSystem }).toString();`,
    replace: `    return locale;`,
    caughtBy: 'packages/runtime/test/numeric-formatting.test.ts',
  },
  {
    id: 'unsupported-numbering-system-renders-anyway',
    invariant:
      'A numbering system this runtime has no data for is refused, not quietly replaced with the locale default.',
    // Neither the option form nor the extension form reports an unsupported
    // but well-formed value, both fall back and render, so without this check the caller asks
    // for digits that do not exist, is told nothing, and is shown different ones. Removing the
    // check restores exactly that silence.
    source: 'packages/runtime/src/evaluator.ts',
    find: `  if (!supportedNumberingSystems().has(numberingSystem)) return undefined;`,
    replace: `  if (false) return undefined;`,
    caughtBy: 'packages/runtime/test/numeric-formatting.test.ts',
  },
  {
    id: 'sign-marks-not-learned-from-the-locale',
    invariant:
      'A signed number can be read back in the locales whose sign the platform decorates with a formatting control.',
    // The defect this replaces was live, and it was not subtle: `Intl` writes U+061C, U+200E or
    // U+200F next to the sign in 27 of the 162 locales this ICU build has data for, Equator
    // compared the front of the string against a bare minus, and so refused to render a negative
    // decimal in every one of them. Found by the differential on its first run.
    //
    // Emptying the learned set is the mutation because it is the regression that would actually
    // happen: someone deciding the marks are noise, or the derivation moving to a formatter that
    // does not emit them.
    //
    // The first runtime injection in this file rather than the runtime one. Nothing about it needs
    // Angular, so nothing about it needs a package build and a materialized consumer: it patches a
    // pure module and runs one vitest file.
    //
    // What that buys is not total gate time: placing it here rather than in the runtime gate is
    // -3s there and +4s here, a wash within the run-to-run noise. What it buys is that this
    // injection can be run *alone*, in about a second, against a package build plus a consumer
    // materialize plus the consumer suite for one over there. The reason is reachability rather
    // than throughput.
    source: 'packages/runtime/src/localized-input.ts',
    find: '        if (/\\p{Cf}/u.test(scalar)) signMarks.add(scalar);',
    replace: '        if (false) signMarks.add(scalar);',
    caughtBy: 'packages/runtime/test/numeric-differential.test.ts',
  },
  {
    id: 'integer-parameter-codec-reads-any-number',
    invariant:
      'An integer route parameter is a decimal spelling, not whatever `Number` will accept.',
    // The sibling of `identifier-parameter-codec-accepts-anything`, which lives in the slow harness
    // because the consumer's own article route exercises it. This one had no route and no test at
    // all: the first mutation run reported 56 mutants in `createIntegerParameterCodec` that nothing
    // reached, in a function exported from the primary entry point.
    //
    // Taking the pattern out does not make the codec accept everything, which is what makes this
    // the honest injection rather than a strawman. `Number.isSafeInteger` still holds, so what gets
    // through is narrower and worse: `1e3`, ` 1`, `0x10` and `''` become valid spellings of 1000,
    // 1, 16 and 0. Each is a second address for a record that already has one, and Equator's own
    // canonicalizer will not redirect them: the codec it asks says they are correct.
    source: 'packages/runtime/core/src/routing.ts',
    find: [
      '      if (!/^-?[0-9]{1,64}$/u.test(value)) {',
      '        return Object.freeze({ ok: false });',
      '      }',
    ].join('\n'),
    replace: '      // The decimal spelling is not checked.',
    caughtBy: 'packages/runtime/test/route-parameters-and-x-default.test.ts',
  },
  {
    id: 'catalog-locale-accepts-an-extension',
    invariant:
      'A catalog locale identity carries no extension or private-use subtag, so one locale cannot become two catalogs.',
    // `en-US` and `en-US-u-ca-islamic` name the same language to every reader and different
    // catalogs to Equator. The check is one line and nothing had ever watched it fail; the property
    // file that now does generates the tags rather than listing four of them, because the failure
    // is a class, any singleton subtag, and not a spelling.
    source: 'packages/toolkit/src/locales.ts',
    find: '  if (parts.slice(1).some((part) => part.length === 1)) {',
    replace: '  if (false) {',
    caughtBy: 'packages/toolkit/test/round-trip-properties.test.ts',
  },
  {
    id: 'uninstall-reverts-an-edited-entry',
    invariant:
      'Uninstall takes back only what Equator wrote; an edited script or a repointed #i18n specifier is left alone and named.',
    source: 'packages/toolkit/src/project-host.ts',
    find: '      if (entries[specifier] === target) delete entries[specifier];',
    replace: '      if (true) delete entries[specifier];',
    caughtBy: 'packages/toolkit/test/uninstall.test.ts',
  },
  {
    id: 'uninstall-removes-authored-catalogs',
    invariant:
      "Authored catalogs survive an uninstall unless their removal is asked for by name; they are the consumer's content.",
    source: 'packages/toolkit/src/project-host.ts',
    find: '    options.catalogs === true ? await loadProject(options) : undefined;',
    replace: '    true ? await loadProject(options) : undefined;',
    caughtBy: 'packages/toolkit/test/uninstall.test.ts',
  },
  {
    id: 'template-usage-never-deferred',
    invariant:
      "A message used only in a component's template is deferred with the component that owns the template, rather than reading as eager because no module imports a .html file.",
    source: 'packages/toolkit/src/compiler.ts',
    find: `    const path = owningSource.get(usage.sourcePath) ?? usage.sourcePath;
    if (!deferredPaths.has(path)) eager.add(scopeId);`,
    replace: `    const path = usage.sourcePath;
    if (!deferredPaths.has(path)) eager.add(scopeId);`,
    caughtBy: 'packages/toolkit/test/template-reachability.test.ts',
  },
  {
    id: 'lazy-route-carries-no-scopes',
    invariant:
      'A route behind a lazy boundary carries the scopes it must have ready, so deferring a scope does not mean rendering a page whose text never arrives.',
    source: 'packages/toolkit/src/compiler.ts',
    find: '  const deferred = new Set(deferredSourcePaths);',
    replace: '  const deferred = new Set<string>();',
    caughtBy: 'packages/toolkit/test/template-reachability.test.ts',
  },
  {
    id: 'hidden-route-address-unreported',
    invariant:
      'A route whose path or matcher the build cannot read is named in a warning, with the addresses below it that it hides.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: "      if (parentPath !== undefined && declared.kind === 'hidden') {",
    replace: '      if (false) {',
    caughtBy: 'packages/toolkit/test/route-identity.test.ts',
  },
  {
    id: 'hidden-route-address-fails-the-build',
    invariant:
      'A route that hides addresses from the projection is reported as a warning, and the analysis still succeeds.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: "            { path: ['routes', portableSourcePath], severity: 'warning' },\n          ),\n        );\n      }\n      // A route in a named outlet",
    replace:
      "            { path: ['routes', portableSourcePath], severity: 'error' },\n          ),\n        );\n      }\n      // A route in a named outlet",
    caughtBy: 'packages/toolkit/test/route-identity.test.ts',
  },
  {
    id: 'route-parameter-name-in-identity',
    invariant:
      "A route's identity collapses every parameter segment to one mark, so renaming a parameter changes no identity.",
    source: 'packages/toolkit/src/static-analysis.ts',
    find: '      marks.push(ROUTE_PARAMETER_MARK);',
    replace: '      marks.push(segment.slice(1));',
    caughtBy: 'packages/toolkit/test/route-identity.test.ts',
  },
  {
    id: 'unnameable-route-projected-under-its-raw-path',
    invariant:
      'An address that cannot be named within the identity grammar is reported and left out of the projection.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: '    const identity = routeIdentity(draft.path);',
    replace:
      '    const identity = routeIdentity(draft.path) ?? `route:${draft.path}`;',
    caughtBy: 'packages/toolkit/test/route-identity.test.ts',
  },
  {
    id: 'codec-round-trip-unchecked',
    invariant:
      'A URL is built only where the parameter codec reads its own spelling back to the same text in the locale being built.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '    if (\n      !read.ok ||\n      read.value === undefined ||\n      codec.serialize(read.value, context) !== serialized\n    ) {',
    replace: '    if (false) {',
    caughtBy: 'packages/runtime/test/address-translation.test.ts',
  },
  {
    id: 'declined-parameter-matched-anyway',
    invariant:
      'An address whose parameter the codec declines to parse does not match the route.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '      if (!parsed.ok || parsed.value === undefined) {',
    replace:
      '      if (!parsed.ok || parsed.value === undefined) {\n        parameters[name] = actual;\n        canonicalSegments.push(actual);\n        continue;\n      }\n      if (false) {',
    caughtBy: 'packages/runtime/test/address-translation.test.ts',
  },
  {
    id: 'unplaced-address-rewritten',
    invariant:
      'An address the resolver cannot place is handed back to the application unchanged.',
    source: 'packages/runtime/core/src/routing.ts',
    find: "  if (resolution.status !== 'success') return external;",
    replace: "  if (resolution.status !== 'success') return '/';",
    caughtBy: 'packages/runtime/test/address-translation.test.ts',
  },
  {
    id: 'declared-spelling-borrowed-across-locales',
    invariant:
      "A locale a parameter-spelling declaration omits is spelled by the route's codec, never by another locale's declared spelling.",
    source: 'packages/runtime/core/src/routing.ts',
    find: '    const declared = spellings?.[name]?.[locale];',
    replace:
      '    const declared =\n      spellings?.[name]?.[locale] ??\n      Object.values(spellings?.[name] ?? {})[0];',
    caughtBy: 'packages/runtime/test/declared-parameter-spellings.test.ts',
  },
  {
    id: 'declared-spelling-parse-unchecked',
    invariant:
      "A declared parameter spelling is emitted only where the route's own codec parses it.",
    source: 'packages/runtime/core/src/routing.ts',
    find: '      if (!codec.parse(declared, context).ok) {',
    replace: '      if (false) {',
    caughtBy: 'packages/runtime/test/declared-parameter-spellings.test.ts',
  },
  {
    id: 'declared-spelling-safety-unchecked',
    invariant:
      'A declared parameter spelling is emitted only where it is a safe path segment.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '      if (!safeParameterSegment(declared)) {',
    replace: '      if (false) {',
    caughtBy: 'packages/runtime/test/declared-parameter-spellings.test.ts',
  },
  {
    id: 'declared-spelling-held-to-round-trip',
    invariant:
      'A declared parameter spelling is not required to parse back to the value the page was addressed with.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '      if (!codec.parse(declared, context).ok) {',
    replace:
      '      if (codec.parse(declared, context).value !== parameters[name]) {',
    caughtBy: 'packages/runtime/test/declared-parameter-spellings.test.ts',
  },
  {
    id: 'built-policy-keeps-unbuilt-aliases',
    invariant:
      'The narrowed policy drops a locale the build did not generate from every one of its tables, aliases included.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '    aliases: retain(policy.aliases, valued),',
    replace: '    aliases: policy.aliases,',
    caughtBy: 'packages/runtime/test/built-locale-addresses.test.ts',
  },
  {
    id: 'unbuilt-locale-left-in-policy',
    invariant:
      'A locale the build did not generate is removed from the policy, so its prefix is unsupported locale intent and a preference naming it is ignored.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '    locales: retain(policy.locales, keyed),\n    prefixes: retain(policy.prefixes, valued),',
    replace: '    locales: policy.locales,\n    prefixes: policy.prefixes,',
    caughtBy: 'packages/runtime/test/built-locale-addresses.test.ts',
  },
  {
    id: 'configuration-without-default-locale-accepted',
    invariant:
      "A generated configuration that omits the policy's default locale is refused.",
    source: 'packages/runtime/core/src/routing.ts',
    find: '  if (!built.has(defaultLocale)) {',
    replace: '  if (false) {',
    caughtBy: 'packages/runtime/test/built-locale-addresses.test.ts',
  },
  {
    id: 'build-origin-not-required',
    invariant:
      'A build under a locale-host policy is refused unless it is told which origin it answers at.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '  if (origin === undefined) {\n    routeError(\n      `A "locale-host" policy carries the locale in the origin, so localizedServerRoutes()',
    replace:
      '  if (false) {\n    routeError(\n      `A "locale-host" policy carries the locale in the origin, so localizedServerRoutes()',
    caughtBy: 'packages/runtime/test/built-locale-addresses.test.ts',
  },
  {
    id: 'alternate-advertised-without-arrival-check',
    invariant:
      'An alternate names a locale only where arriving at its address with no stated preference yields that locale.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '    if (!addressSelectsLocale(address, locale, policy, projection)) continue;',
    replace: '    void addressSelectsLocale;',
    caughtBy: 'packages/runtime/test/built-locale-addresses.test.ts',
  },
  {
    id: 'raw-target-discarded',
    invariant:
      'The request handler classifies the target as it arrived, before a URL parser has repaired it.',
    source: 'packages/runtime/http/src/handler.ts',
    find: '      rawTargetOf(request) ?? `${url.pathname}${url.search}`,',
    replace: '      `${url.pathname}${url.search}`,',
    caughtBy: 'packages/runtime/test/http-node-adapter.test.ts',
  },
  {
    id: 'declined-address-rendered',
    invariant:
      "An address the locale policy declines goes to the deployment's own handling and is never rendered.",
    source: 'packages/runtime/http/src/handler.ts',
    find: "    if (resolution.status !== 'malformed' && bypasses(url, policy)) {",
    replace:
      "    if (false && resolution.status !== 'malformed' && bypasses(url, policy)) {",
    caughtBy: 'packages/runtime/test/http-handler.test.ts',
  },
  {
    id: 'refused-target-rendered',
    invariant:
      'A structurally unsafe target is answered without a renderer being asked.',
    source: 'packages/runtime/http/src/handler.ts',
    find: "  return resolution.status !== 'redirect' && resolution.status !== 'malformed';",
    replace: "  return resolution.status !== 'redirect';",
    caughtBy: 'packages/runtime/test/http-handler.test.ts',
  },
  {
    id: 'renderer-304-sent-as-address-status',
    invariant:
      "A 304 or a redirect from the renderer keeps the renderer's status.",
    source: 'packages/runtime/http/src/handler.ts',
    find: '      return new Response(null, { status: rendered.status, headers: merged });',
    replace:
      '      return new Response(null, { status: effective.status, headers: merged });',
    caughtBy: 'packages/runtime/test/render-without-content.test.ts',
  },
  {
    id: 'renderer-redirect-body-forwarded',
    invariant: 'A 304 or a redirect from the renderer is sent with no content.',
    source: 'packages/runtime/http/src/handler.ts',
    find: '      void rendered.body?.cancel();\n      return new Response(null, { status: rendered.status, headers: merged });',
    replace:
      '      return new Response(rendered.body, { status: rendered.status, headers: merged });',
    caughtBy: 'packages/runtime/test/render-without-content.test.ts',
  },
  {
    id: 'renderer-redirect-without-release-fields',
    invariant:
      'A 304 or a redirect from the renderer carries the fields the release composes onto a page.',
    source: 'packages/runtime/http/src/handler.ts',
    find: '    for (const [name, value] of own) {',
    replace:
      '    for (const [name, value] of answeredWithoutContent ? [] : own) {',
    caughtBy: 'packages/runtime/test/render-without-content.test.ts',
  },
  {
    id: 'not-modified-given-representation-fields',
    invariant:
      'A 304 carries the cache directives and varying fields of the 200 it stands for, and no other representation metadata.',
    source: 'packages/runtime/http/src/handler.ts',
    find: '        ? cacheHeaders(effective, rendered.headers)',
    replace: '        ? responseHeaders(effective, rendered.headers)',
    caughtBy: 'packages/runtime/test/render-without-content.test.ts',
  },
  {
    id: 'empty-render-answered-200',
    invariant:
      'A render asked for a page that returned no content is not answered 200.',
    source: 'packages/runtime/http/src/handler.ts',
    find: '      rendered.body === null;',
    replace: '      false;',
    caughtBy: 'packages/runtime/test/render-without-content.test.ts',
  },
  {
    id: 'undeclared-error-keeps-address-classification',
    invariant:
      "An error status a renderer sent without declaring it is sent private, not stored and not indexed, whatever the address's own classification.",
    source: 'packages/runtime/http/src/handler.ts',
    find: "    robots: 'noindex',\n    cache: 'private-no-store',\n  });\n}\n\nfunction withoutPreconditions(",
    replace:
      '    ...(resolved.robots === undefined ? {} : { robots: resolved.robots }),\n    cache: resolved.cache,\n  });\n}\n\nfunction withoutPreconditions(',
    caughtBy: 'packages/runtime/test/render-without-content.test.ts',
  },
  {
    id: 'undeclared-error-read-as-declaration',
    invariant:
      'An error status a renderer returned without declaring it is not read as a declared outcome.',
    source: 'packages/runtime/http/src/handler.ts',
    find: '    let declared: PageOutcomeDeclaration | undefined = fromRender;',
    replace:
      "    let declared: PageOutcomeDeclaration | undefined =\n      fromRender ??\n      (!isDeclaration(result) && result.status >= 400\n        ? { outcome: 'operational-failure', status: result.status }\n        : undefined);",
    caughtBy: 'packages/runtime/test/render-without-content.test.ts',
  },
  {
    id: 'preconditions-handed-to-every-render',
    invariant:
      "A renderer is handed the request's preconditions only where the address resolved to a page.",
    source: 'packages/runtime/http/src/handler.ts',
    find: "      resolution.status === 'success' ? request : withoutPreconditions(request);",
    replace: "      resolution.status === 'success' ? request : request;",
    caughtBy: 'packages/runtime/test/render-without-content.test.ts',
  },
  {
    id: 'malformed-target-answered-404',
    invariant: 'A structurally unsafe target is answered 400.',
    source: 'packages/runtime/core/src/routing.ts',
    find: "    case 'malformed':\n      return Object.freeze({\n        status: 400,",
    replace:
      "    case 'malformed':\n      return Object.freeze({\n        status: 404,",
    caughtBy: 'packages/runtime/test/http-handler.test.ts',
  },
  {
    id: 'locale-entry-answered-302',
    invariant: 'Locale entry is answered 307.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '        httpStatus: 307,\n        cache,\n        locale: policy.defaultLocale,',
    replace:
      '        httpStatus: 302,\n        cache,\n        locale: policy.defaultLocale,',
    caughtBy: 'packages/runtime/test/http-handler.test.ts',
  },
  {
    id: 'unsupported-locale-intent-redirected',
    invariant:
      'An address that names a locale the site does not serve is answered as unsupported locale intent, never in another locale.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '        if (first !== undefined && localeIntent(first)) {',
    replace: '        if (false) {',
    caughtBy: 'packages/runtime/test/built-locale-addresses.test.ts',
  },
  {
    id: 'declared-removal-answered-as-absence',
    invariant:
      'A declared absence is answered 404 and a declared permanent removal 410.',
    source: 'packages/runtime/core/src/page-outcome.ts',
    find: "    status: declaration.outcome === 'absent' ? 404 : 410,",
    replace: '    status: 404,',
    caughtBy: 'packages/runtime/test/declared-page-outcome.test.ts',
  },
  {
    id: 'renderer-declaration-ignored',
    invariant:
      "A renderer's own declared outcome is carried, as a page's declaration from inside the render is.",
    source: 'packages/runtime/http/src/handler.ts',
    find: '      declared = result.pageOutcome;',
    replace: '      declared = fromRender;',
    caughtBy: 'packages/runtime/test/declared-page-outcome.test.ts',
  },
  {
    id: 'page-outcome-channel-unread',
    invariant:
      "A page's declared outcome reaches the response over the channel the render shares with the handler.",
    source: 'packages/runtime/http/src/handler.ts',
    find: '    const fromRender = ɵtakePageOutcome(handed);',
    replace: '    const fromRender = void ɵtakePageOutcome(handed);',
    caughtBy: 'packages/runtime/test/declared-page-outcome.test.ts',
  },
  {
    id: 'page-outcome-channel-left-open',
    invariant:
      'A declared page outcome is read once and closed, so no second read at the same address finds it.',
    source: 'packages/runtime/core/src/page-outcome.ts',
    find: '  channels.delete(request);',
    replace: '  void channels;',
    caughtBy: 'packages/runtime/test/declared-page-outcome.test.ts',
  },
  {
    id: 'declaration-carried-at-refused-address',
    invariant:
      'A declared outcome is carried only where the address resolved to a route the release serves.',
    source: 'packages/runtime/http/src/handler.ts',
    find: "      declared !== undefined && resolution.status === 'success';",
    replace: '      declared !== undefined;',
    caughtBy: 'packages/runtime/test/declared-page-outcome.test.ts',
  },
  {
    id: 'overridden-declaration-reported-every-time',
    invariant:
      'A declaration the release did not carry is reported once for each pair of resolution and declaration, not once per address.',
    source: 'packages/runtime/http/src/handler.ts',
    find: '  if (reported.has(identity)) return;',
    replace: '  if (reported.size < 0) return;',
    caughtBy: 'packages/runtime/test/declared-page-outcome.test.ts',
  },
  {
    id: 'operational-failure-cached-as-address',
    invariant:
      "A carried operational failure is sent private and not stored, whatever the address's own classification.",
    source: 'packages/runtime/core/src/page-outcome.ts',
    find: "      ...(resolved.robots === undefined ? {} : { robots: resolved.robots }),\n      cache: 'private-no-store',",
    replace:
      '      ...(resolved.robots === undefined ? {} : { robots: resolved.robots }),\n      cache: resolved.cache,',
    caughtBy: 'packages/runtime/test/declared-page-outcome.test.ts',
  },
  {
    id: 'restored-preference-overrides-stated-locale',
    invariant:
      'A remembered preference never overrides the locale an address states.',
    source: 'packages/runtime/src/locale-resolution.ts',
    find: '        return resolved === stored ? stored : undefined;',
    replace: '        return stored;',
    caughtBy: 'packages/runtime/test/restoring-a-cached-page.test.ts',
  },
  {
    id: 'entry-redirect-public-without-preference',
    invariant:
      'A locale-entry redirect is private and revalidated whether or not a preference was consulted.',
    source: 'packages/runtime/core/src/routing.ts',
    find: "      const cache = 'private-no-cache' as const;",
    replace:
      "      const cache = preferred === undefined ? 'public' : 'private-no-cache';",
    caughtBy: 'packages/runtime/test/route-cache-headers.test.ts',
  },
  {
    id: 'neutral-success-varies-only-when-consulted',
    invariant:
      'Under a locale-neutral policy a success at an address several locales spell varies by locale preference, including one that consulted none.',
    source: 'packages/runtime/core/src/routing.ts',
    find: "    ...(spelling.length > 1 ? { variesBy: 'locale-preference' as const } : {}),",
    replace:
      "    ...(preferred !== undefined && spelling.length > 1 ? { variesBy: 'locale-preference' as const } : {}),",
    caughtBy: 'packages/runtime/test/route-cache-headers.test.ts',
  },
  {
    id: 'varying-answer-without-declared-source-accepted',
    invariant:
      'A response that varied by locale preference is refused cache headers when the declared preference source is none.',
    source: 'packages/runtime/core/src/routing.ts',
    find: "        case 'none':",
    replace: "        case 'none':\n          return 'shared';",
    caughtBy: 'packages/runtime/test/route-cache-headers.test.ts',
  },
  {
    id: 'cookie-preference-answer-shared',
    invariant:
      'A response whose locale a cookie chose is private and revalidated before every reuse.',
    source: 'packages/runtime/core/src/routing.ts',
    find: "        case 'cookie':\n          return 'per-visitor';",
    replace: "        case 'cookie':\n          return 'shared';",
    caughtBy: 'packages/runtime/test/route-cache-headers.test.ts',
  },
  {
    id: 'restored-page-left-in-its-old-locale',
    invariant:
      'A restored page whose address states no locale moves to the remembered locale where the configured sources would choose it.',
    source: 'packages/runtime/src/locale-resolution.ts',
    find: '    if (stored === undefined || stored === committed) return undefined;',
    replace: '    if (stored !== null) return undefined;',
    caughtBy: 'packages/runtime/test/restoring-a-cached-page.test.ts',
  },
  {
    id: 'negotiated-answer-not-named-in-vary',
    invariant:
      'A response whose locale Accept-Language chose names Accept-Language in Vary.',
    source: 'packages/runtime/core/src/routing.ts',
    find: "  const names: string[] = negotiated ? ['Accept-Language'] : [];",
    replace: '  const names: string[] = [];',
    caughtBy: 'packages/runtime/test/route-cache-headers.test.ts',
  },
  {
    id: 'private-negotiated-answer-loses-vary',
    invariant:
      'A private response or entry redirect whose locale Accept-Language chose still names Accept-Language in Vary.',
    source: 'packages/runtime/core/src/routing.ts',
    find: "    (descriptor.variesBy === 'locale-preference' ||",
    replace: '    (false ||',
    caughtBy: 'packages/runtime/test/route-cache-headers.test.ts',
  },
  {
    id: 'cookie-named-in-vary',
    invariant:
      'No response names a cookie in Vary, including one whose page asked for it.',
    source: 'packages/runtime/core/src/routing.ts',
    find: "      lower !== 'cookie' &&",
    replace: '      true &&',
    caughtBy: 'packages/runtime/test/route-cache-headers.test.ts',
  },
  {
    id: 'variant-internal-address-written-as-given',
    invariant:
      'An internal address that is a variant of a canonical one is written as the canonical address, not as the variant.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '  const resolution = followPermanentRedirect(\n    resolveLocalizedRoute(\n      `${prefix}',
    replace:
      '  const resolution = ((value: RouteResolution) => value)(\n    resolveLocalizedRoute(\n      `${prefix}',
    caughtBy: 'packages/runtime/test/address-translation.test.ts',
  },
  {
    id: 'crossed-spellings-corrected-anyway',
    invariant:
      "An address that two locales' spellings read as two different addresses is not found, rather than corrected to either.",
    source: 'packages/runtime/core/src/routing.ts',
    find: '  if (corrections.size !== 1) return undefined;',
    replace: '  if (corrections.size === 0) return undefined;',
    caughtBy: 'packages/runtime/test/another-locale-spelling.test.ts',
  },
  {
    id: 'correction-drops-the-query',
    invariant:
      "A correction from another locale's spelling keeps the request's query.",
    source: 'packages/runtime/core/src/routing.ts',
    find: '    corrections.set(`${path}${parsed.canonicalSuffix}`, match.route.id);',
    replace: '    corrections.set(path, match.route.id);',
    caughtBy: 'packages/runtime/test/another-locale-spelling.test.ts',
  },
  {
    id: 'hardcoded-template-locale-only-warned',
    invariant:
      'A locale spelled out as a literal in a template is reported as an error, not a warning.',
    source: 'packages/toolkit/src/compiler.ts',
    find: "            ...(literal ? {} : { severity: 'warning' as const }),",
    replace: "            severity: 'warning' as const,",
    caughtBy: 'packages/toolkit/test/hardcoded-locale-template.test.ts',
  },
  {
    id: 'route-render-mode-overridden',
    invariant:
      'Each localized server route carries the render mode its declaration gave, unchanged.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '          renderMode: declaration.renderMode,',
    replace:
      '          renderMode: options.canonicalRenderMode ?? declaration.renderMode,',
    caughtBy: 'packages/runtime/test/built-locale-addresses.test.ts',
  },
  {
    id: 'server-routes-expanded-to-unbuilt-locales',
    invariant:
      'Localized server routes are expanded only to the locales the build narrowed the policy to.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '          .filter(([locale]) => built.has(canonicalLocale(locale)))',
    replace: '          .filter(([locale]) => (void locale, true))',
    caughtBy: 'packages/runtime/test/built-locale-addresses.test.ts',
  },
  {
    id: 'unspellable-prerender-value-omitted',
    invariant:
      'A prerender parameter value that some locale cannot spell fails the build.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '      if (text === undefined) {',
    replace: '      if (text === undefined && false) {',
    caughtBy: 'packages/runtime/test/route-parameters-and-x-default.test.ts',
  },
  {
    id: 'prerender-value-function-ignored',
    invariant:
      'Prerender parameter values supplied by a function are rendered like values written in place.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '  return () => (asked ??= Promise.resolve(declared()));',
    replace: '  return () => Promise.resolve([]);',
    caughtBy: 'packages/runtime/test/route-parameters-and-x-default.test.ts',
  },
  {
    id: 'canonical-render-mode-forced-from-a-route',
    invariant:
      'The canonical address takes the render mode the application declared for it, never one borrowed from a route.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '    const canonicalRenderMode = options.canonicalRenderMode;',
    replace: '    const canonicalRenderMode = declarations[0]!.renderMode;',
    caughtBy: 'packages/runtime/test/built-locale-addresses.test.ts',
  },
  {
    id: 'published-url-ignores-the-mount-point',
    invariant:
      'Every published URL is the origin, the mount point and the localized path together.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '  return new URL(withBasePath(location, baseHref), origin).href;',
    replace: '  return new URL(location, origin).href;',
    caughtBy: 'packages/runtime/test/built-locale-addresses.test.ts',
  },
  {
    id: 'alternate-for-an-unbuilt-locale',
    invariant:
      'An alternate is published only for a locale this build produced.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '    if (!built.has(locale)) continue;',
    replace: '    if (!built.has(locale) && false) continue;',
    caughtBy: 'packages/runtime/test/built-locale-addresses.test.ts',
  },
  {
    id: 'alternate-for-an-address-that-selects-no-locale',
    invariant:
      'An alternate is published only where its address selects that locale.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '    if (!addressSelectsLocale(address, locale, policy, projection)) continue;',
    replace:
      '    if (!addressSelectsLocale(address, locale, policy, projection) && false) continue;',
    caughtBy: 'packages/runtime/test/built-locale-addresses.test.ts',
  },
  {
    id: 'sitemap-file-size-not-reported',
    invariant:
      'Each sitemap file reports its size in the bytes it will be served as.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '      bytes: utf8Length(page.contents),',
    replace: '      bytes: 0,',
    caughtBy: 'packages/runtime/test/sitemap-projection.test.ts',
  },
  {
    id: 'sitemap-not-split-by-size',
    invariant:
      "A sitemap set is split before a file would exceed the protocol's byte limit.",
    source: 'packages/runtime/core/src/routing.ts',
    find: '        bytes + size > SITEMAP_BYTE_LIMIT)',
    replace: '        false)',
    caughtBy: 'packages/runtime/test/sitemap-projection.test.ts',
  },
  {
    id: 'sitemap-not-split-by-count',
    invariant:
      "A sitemap set is split before a file would exceed the protocol's URL limit.",
    source: 'packages/runtime/core/src/routing.ts',
    find: '      (current.length + 1 > SITEMAP_URL_LIMIT ||',
    replace: '      (false ||',
    caughtBy: 'packages/runtime/test/sitemap-projection.test.ts',
  },
  {
    id: 'sitemap-lastmod-from-the-build-date',
    invariant:
      'A route that declares no last-modified date has none in its sitemap claim.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: "      dated?.reading.kind === 'string' ? dated.reading.value : undefined;",
    replace:
      "      dated?.reading.kind === 'string' ? dated.reading.value : new Date().toISOString().slice(0, 10);",
    caughtBy: 'packages/toolkit/test/route-identity.test.ts',
  },
  {
    id: 'sitemap-elements-out-of-schema-order',
    invariant: 'Sitemap entries validate against the pinned sitemap schema.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '    lines.push(`    <priority>${sitemapPriority(claim.priority)}</priority>`);',
    replace:
      '    lines.splice(2, 0, `    <priority>${sitemapPriority(claim.priority)}</priority>`);',
    caughtBy: 'packages/runtime/test/sitemap-schema.test.ts',
  },
  {
    id: 'unbound-document-message-accepted',
    invariant:
      'A document declaration naming a message that takes inputs, with none bound, is refused.',
    source: 'packages/runtime/router/src/document-messages.ts',
    find: '  if (missing.length === 0) return;',
    replace: '  if (missing.length >= 0) return;',
    caughtBy: 'packages/runtime/test/document-message-binding.test.ts',
  },
  {
    id: 'social-locale-written-as-a-language-tag',
    invariant: 'The social locale is written in the language_TERRITORY form.',
    source: 'packages/runtime/core/src/locale-profile.ts',
    find: '    : `${profile.language}_${profile.region}`;',
    replace: '    : `${profile.language}-${profile.region}`;',
    caughtBy: 'packages/runtime/test/open-graph-locale.test.ts',
  },
  {
    id: 'social-locale-keeps-the-script',
    invariant: 'The social locale carries no script subtag.',
    source: 'packages/runtime/core/src/locale-profile.ts',
    find: '    : `${profile.language}_${profile.region}`;',
    replace: '    : `${profile.language}_${profile.script}_${profile.region}`;',
    caughtBy: 'packages/runtime/test/open-graph-locale.test.ts',
  },
  {
    id: 'own-locale-listed-as-a-social-alternate',
    invariant: "A page's own locale is not among its social alternates.",
    source: 'packages/runtime/core/src/locale-profile.ts',
    find: '    if (value === undefined || value === own) continue;',
    replace: '    if (value === undefined) continue;',
    caughtBy: 'packages/runtime/test/built-locale-addresses.test.ts',
  },
  {
    id: 'unlisted-indexing-value-read-as-private',
    invariant:
      'A route whose indexing value the declaration does not list is indexable.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: "    return values.get(found.reading.value) ?? 'indexable';",
    replace: "    return values.get(found.reading.value) ?? 'private';",
    caughtBy: 'packages/toolkit/test/route-identity.test.ts',
  },
  {
    id: 'default-indexing-field-renamed',
    invariant:
      'A project that names no indexing field has its routes read under the documented default field.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: "const DEFAULT_ROUTE_INDEXING_FIELD = 'equatorIndexing';",
    replace: "const DEFAULT_ROUTE_INDEXING_FIELD = 'indexing';",
    caughtBy: 'packages/toolkit/test/route-identity.test.ts',
  },
  {
    id: 'const-binding-not-followed',
    invariant:
      'An indexing value written through a const binding is read as the literal it is bound to.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: '    if (declaration === undefined || seen.has(declaration)) return current;',
    replace: '    if (true) return current;',
    caughtBy: 'packages/toolkit/test/route-data-reading.test.ts',
  },
  {
    id: 'earlier-route-data-key-wins',
    invariant: 'In route data, a later key overrides an earlier one.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: '    if (key !== name) continue;',
    replace: "    if (key !== name || found.kind !== 'absent') continue;",
    caughtBy: 'packages/toolkit/test/route-data-reading.test.ts',
  },
  {
    id: 'unreadable-indexing-value-read-as-indexable',
    invariant:
      'A route whose indexing value cannot be read is answered as private.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: "      return 'private';\n    }\n    if (policy !== undefined && !policy.readable) return 'private';",
    replace:
      "      return 'indexable';\n    }\n    if (policy !== undefined && !policy.readable) return 'private';",
    caughtBy: 'packages/toolkit/test/route-data-reading.test.ts',
  },
  {
    id: 'parent-route-class-not-inherited',
    invariant:
      'A class declared on a parent route reaches every child the router gives its data to.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: '          ? node.parent\n          : undefined;',
    replace: '          ? undefined\n          : undefined;',
    caughtBy: 'packages/toolkit/test/route-inheritance.test.ts',
  },
  {
    id: 'empty-path-child-does-not-inherit',
    invariant:
      "Under emptyOnly, a child with an empty path or a componentless parent still inherits its parent's data.",
    source: 'packages/toolkit/src/static-analysis.ts',
    find: "        strategy === 'always' || node.inheritsUnderEitherStrategy",
    replace: "        strategy === 'always'",
    caughtBy: 'packages/toolkit/test/route-inheritance.test.ts',
  },
  {
    id: 'inheritance-default-is-empty-only',
    invariant:
      'Where no inheritance strategy is declared, child routes inherit always.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: "  let strategy: 'always' | 'emptyOnly' = 'always';",
    replace: "  let strategy: 'always' | 'emptyOnly' = 'emptyOnly';",
    caughtBy: 'packages/toolkit/test/route-inheritance.test.ts',
  },
  {
    id: 'declared-inheritance-strategy-ignored',
    invariant:
      'A router configured with emptyOnly has its routes read under emptyOnly.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: "  } else if (firstConfiguration?.strategy === 'emptyOnly') {\n    strategy = 'emptyOnly';\n  }",
    replace:
      "  } else if (firstConfiguration?.strategy === 'emptyOnly') {\n    strategy = 'always';\n  }",
    caughtBy: 'packages/toolkit/test/route-inheritance.test.ts',
  },
  {
    id: 'unreadable-inheritance-strategy-unreported',
    invariant:
      'A router inheritance strategy the build cannot read is reported.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: "  } else if (firstConfiguration?.strategy === 'unreadable') {",
    replace: '  } else if (false) {',
    caughtBy: 'packages/toolkit/test/route-inheritance.test.ts',
  },
  {
    id: 'repeated-router-configuration-unreported',
    invariant:
      'A router configured in more than one place, with a strategy set in one of them, is reported.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: '    if (strategyDeclared) {',
    replace: '    if (false) {',
    caughtBy: 'packages/toolkit/test/route-inheritance.test.ts',
  },
  {
    id: 'runtime-decided-address-keeps-its-class',
    invariant:
      'An address whose route the router decides at run time is answered as private.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: "        indexing: certain ? indexing : 'private',",
    replace: '        indexing,',
    caughtBy: 'packages/toolkit/test/route-inheritance.test.ts',
  },
  {
    id: 'invalid-changefreq-accepted',
    invariant:
      'A sitemap change frequency the protocol does not define is refused when the owner is compiled.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: '        changefreq !== undefined &&\n        SITEMAP_CHANGE_FREQUENCIES.has(changefreq)\n      ) {',
    replace: '        changefreq !== undefined\n      ) {',
    caughtBy: 'packages/toolkit/test/route-identity.test.ts',
  },
  {
    id: 'robots-header-not-sent',
    invariant:
      'A response that is not to be indexed carries the X-Robots-Tag header.',
    source: 'packages/runtime/http/src/handler.ts',
    find: "        headers.set('x-robots-tag', effective.robots);",
    replace: '        void effective.robots;',
    caughtBy: 'packages/runtime/test/declared-page-outcome.test.ts',
  },
  {
    id: 'missing-page-redirected-home',
    invariant:
      'A missing page under a supported locale is a 404 in that locale, not a redirect.',
    source: 'packages/runtime/core/src/routing.ts',
    find: "    return Object.freeze({\n      status: 'not-found',\n      httpStatus: 404,\n      presentationLocale: locale ?? policy.defaultLocale,",
    replace:
      "    return Object.freeze({\n      status: 'redirect',\n      reason: 'replacement',\n      httpStatus: 308,\n      location: '/',\n      locale: locale ?? policy.defaultLocale,\n      presentationLocale: locale ?? policy.defaultLocale,",
    caughtBy: 'packages/runtime/test/locale-of-an-unprojected-address.test.ts',
  },
  {
    id: 'shared-lifetime-chosen-by-the-release',
    invariant:
      'The shared lifetime of a page is the one the deployment supplies.',
    source: 'packages/runtime/core/src/routing.ts',
    find: "    : wholeSeconds(freshness.successMaxAge, 'successMaxAge');",
    replace: '    : 600;',
    caughtBy: 'packages/runtime/test/route-cache-headers.test.ts',
  },
  {
    id: 'vary-left-out-of-the-header-set',
    invariant:
      'The Vary field is returned as its own entry in the set of cache headers.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '    ...(vary === undefined ? {} : { vary }),',
    replace: '    ...(vary === undefined ? {} : {}),',
    caughtBy: 'packages/runtime/test/route-cache-headers.test.ts',
  },
  {
    id: 'cache-declaration-lowers-the-level',
    invariant:
      'A caching declaration can raise who may keep a response and never lower it.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '    CACHE_LEVEL_RANK[floor] > CACHE_LEVEL_RANK[level]',
    replace: '    CACHE_LEVEL_RANK[floor] !== CACHE_LEVEL_RANK[level]',
    caughtBy: 'packages/runtime/test/route-cache-headers.test.ts',
  },
  {
    id: 'unusable-caching-value-read-as-absent',
    invariant:
      'A route caching value the build cannot read or use is answered as not-stored.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: "      return 'not-stored';\n    };\n    if (found.reading.kind === 'unreadable') {",
    replace:
      "      return undefined as unknown as RouteCachingClass;\n    };\n    if (found.reading.kind === 'unreadable') {",
    caughtBy: 'packages/toolkit/test/route-identity.test.ts',
  },
  {
    id: 'unusable-caching-value-unreported',
    invariant:
      'A route caching value the build cannot read or use is reported when the owner is compiled.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: '      if (firstReport(found.node, cachingField)) {',
    replace: '      if (false) {',
    caughtBy: 'packages/toolkit/test/route-identity.test.ts',
  },
  {
    id: 'host-page-floor-raises-a-redirect',
    invariant: "The host's least caching level is not applied to a redirect.",
    source: 'packages/runtime/core/src/routing.ts',
    find: '        redirect ? undefined : freshness.pageCaching,',
    replace: '        freshness.pageCaching,',
    caughtBy: 'packages/runtime/test/route-cache-headers.test.ts',
  },
  {
    id: 'host-page-floor-ignored',
    invariant:
      "The host's least caching level is applied to every response that carries a page.",
    source: 'packages/runtime/core/src/routing.ts',
    find: '        redirect ? undefined : freshness.pageCaching,',
    replace: '        redirect ? undefined : undefined,',
    caughtBy: 'packages/runtime/test/route-cache-headers.test.ts',
  },
  {
    id: 'page-cache-directives-ignored',
    invariant:
      "A page's own no-store, private or no-cache raises the level of its response.",
    source: 'packages/runtime/core/src/routing.ts',
    find: '      stated.level,',
    replace: '      undefined,',
    caughtBy: 'packages/runtime/test/route-cache-headers.test.ts',
  },
  {
    id: 'page-lifetime-lengthens-reuse',
    invariant:
      "A page's max-age can shorten the shared lifetime and never lengthen it.",
    source: 'packages/runtime/core/src/routing.ts',
    find: '    stated.maxAge === undefined ? lifetime : Math.min(lifetime, stated.maxAge);',
    replace: '    stated.maxAge === undefined ? lifetime : stated.maxAge;',
    caughtBy: 'packages/runtime/test/route-cache-headers.test.ts',
  },
  {
    id: 'repeated-lifetime-trusted',
    invariant: 'A lifetime given more than once is read as stale.',
    source: 'packages/runtime/core/src/routing.ts',
    find: "      : values.length === 1 && /^\\d+$/u.test(values[0] ?? '')",
    replace: "      : /^\\d+$/u.test(values[0] ?? '')",
    caughtBy: 'packages/runtime/test/route-cache-headers.test.ts',
  },
  {
    id: 'page-vary-fields-dropped',
    invariant:
      "A page's own Vary fields are added to the ones the release names.",
    source: 'packages/runtime/core/src/routing.ts',
    find: '      names.push(name);',
    replace: '      void name;',
    caughtBy: 'packages/runtime/test/route-cache-headers.test.ts',
  },
  {
    id: 'cookie-vary-leaves-the-page-shared',
    invariant: 'A page that varies by cookie is kept out of shared caches.',
    source: 'packages/runtime/core/src/routing.ts',
    find: "    cookieVaried ? 'per-visitor' : undefined,",
    replace: '    undefined,',
    caughtBy: 'packages/runtime/test/route-cache-headers.test.ts',
  },
  {
    id: 'untrusted-text-length-unbounded',
    invariant:
      'A validator refuses untrusted text longer than any identity is before its grammar reads it.',
    source: 'packages/toolkit/src/untrusted-text.ts',
    find: '  if (value.length > maximumCharacters) {',
    replace: '  if (false as boolean) {',
    caughtBy: 'packages/toolkit/test/untrusted-input.test.ts',
  },
  {
    id: 'provisional-overlay-published-as-output',
    invariant:
      'The contracts a compilation publishes are the ones computed after analysis, never the provisional overlay the analysis ran against.',
    source: 'packages/toolkit/src/compiler.ts',
    find: '    contractFiles: contracts.value,',
    replace: '    contractFiles: provisionalContracts.value,',
    caughtBy: 'packages/toolkit/test/provisional-scope-startup.test.ts',
  },
  {
    id: 'first-generation-overlay-misses-a-module',
    invariant:
      'A generation run with the generated root deleted resolves every generated module the application imports through the analysis overlay.',
    source: 'packages/toolkit/src/compiler.ts',
    find: "      specifier: '#i18n/recovery-payload',",
    replace: "      specifier: '#i18n/recovery-payload-overlay',",
    caughtBy: 'packages/toolkit/test/first-generation-overlay.test.ts',
  },
  {
    id: 'absent-extension-registry-required',
    invariant:
      'An owner with no extension registry file generates as one with an empty registry.',
    source: 'packages/toolkit/src/project-host.ts',
    find: '  if (metadata === undefined) return toolkitSuccess(undefined);',
    replace:
      '  if (metadata === undefined)\n    return toolkitFailure([\n      projectDiagnostic(`${EXTENSION_REGISTRY_NAME} is required.`),\n    ]);',
    caughtBy: 'packages/toolkit/test/project-host.test.ts',
  },
  {
    id: 'several-application-graphs-merged',
    invariant:
      'An owner whose workspace declares several Angular applications is refused with their TypeScript graphs named, rather than analysed as one of them.',
    source: 'packages/toolkit/src/project-host.ts',
    find: '  if (unique.length > 1) {',
    replace: '  if (false) {',
    caughtBy: 'packages/toolkit/test/multi-owner-workspace.test.ts',
  },
  {
    id: 'configuration-above-package-selected',
    invariant:
      'Owner discovery stops at the nearest package manifest, and a configuration above it is named and declined rather than selected.',
    source: 'packages/toolkit/src/project-host.ts',
    find: '      boundary = current;\n      break;',
    replace: '      boundary = current;',
    caughtBy: 'packages/toolkit/test/project-host.test.ts',
  },
  {
    id: 'configuration-schema-open',
    invariant:
      'The project configuration is closed: a property outside the declared set, such as a remote catalog source, is refused.',
    source: 'packages/toolkit/src/schemas.ts',
    find: "  title: 'Equator project configuration',\n  type: 'object',\n  additionalProperties: false,",
    replace:
      "  title: 'Equator project configuration',\n  type: 'object',\n  additionalProperties: true,",
    caughtBy: 'packages/toolkit/test/authoring.test.ts',
  },
  {
    id: 'component-template-url-not-followed',
    invariant:
      "An external component template is found through the component's templateUrl and analysed.",
    source: 'packages/toolkit/src/static-analysis.ts',
    find: "      const templateUrl = metadataString(metadataNode, 'templateUrl');",
    replace:
      '      const templateUrl = undefined as ReturnType<typeof metadataString>;',
    caughtBy: 'packages/toolkit/test/hardcoded-locale-template.test.ts',
  },
  {
    id: 'consumer-withrouting-read-as-equator',
    invariant:
      'A routing declaration is read only from the withRouting the package exports, never from a consumer function spelled the same.',
    source: 'packages/toolkit/src/static-analysis.ts',
    find: "    resolved.name !== 'withRouting' ||\n    !declaredIn(resolved, '/@neolorn/equator/')",
    replace: "    resolved.name !== 'withRouting'",
    caughtBy: 'packages/toolkit/test/route-identity.test.ts',
  },
  {
    id: 'unused-message-advisory-blocks',
    invariant:
      'Source messages nothing reaches are reported at info severity and never fail generate or check.',
    source: 'packages/toolkit/src/compiler.ts',
    find: "        { severity: 'info' },",
    replace: "        { severity: 'error' },",
    caughtBy: 'packages/toolkit/test/reachability-and-recovery.test.ts',
  },
  {
    id: 'generated-root-beside-the-application',
    invariant:
      'An owner at a workspace root generates into the nested Angular application it analysed, not into a source directory of its own.',
    source: 'packages/toolkit/src/project-host.ts',
    find: "  return root === '' ? GENERATED_ROOT : `${root}/${GENERATED_ROOT}`;",
    replace: '  return GENERATED_ROOT;',
    caughtBy: 'packages/toolkit/test/multi-owner-workspace.test.ts',
  },
  {
    id: 'owner-without-typescript-graph-skipped',
    invariant:
      'An owner with no discoverable TypeScript graph fails generation and says so, rather than generating with nothing analysed.',
    source: 'packages/toolkit/src/project-host.ts',
    find: '  if (selected.value === undefined) {',
    replace:
      '  if (selected.value === undefined) {\n    if (selected.ok) return toolkitSuccess(undefined);',
    caughtBy: 'packages/toolkit/test/multi-owner-workspace.test.ts',
  },
  {
    id: 'deleted-message-kept-in-translation-state',
    invariant:
      'Reconciling the translation state drops the entry of a message or locale that no longer exists.',
    source: 'packages/toolkit/src/translation-state.ts',
    find: '  const entries: Record<string, TranslationStateEntry> = {};\n  const stale: StaleTranslation[] = [];',
    replace:
      '  const entries: Record<string, TranslationStateEntry> = { ...previous.entries };\n  const stale: StaleTranslation[] = [];',
    caughtBy: 'packages/toolkit/test/translation-state.test.ts',
  },
  {
    id: 'input-fingerprint-not-revalidated',
    invariant:
      'Output is not published when the inputs changed between compilation and publication.',
    source: 'packages/toolkit/src/output-host.ts',
    find: '      request.expectedInputFingerprint !== undefined &&',
    replace:
      '      false &&\n      request.expectedInputFingerprint !== undefined &&',
    caughtBy: 'packages/toolkit/test/artifact-output.test.ts',
  },
  {
    id: 'interrupted-transaction-not-recovered',
    invariant:
      'An interrupted output transaction is rolled back to the previous generation before the next one starts.',
    source: 'packages/toolkit/src/output-host.ts',
    find: "      lockHandle = await open(lockPath, 'wx');",
    replace: "      lockHandle = await open(lockPath, 'wx');\n      if (false)",
    caughtBy: 'packages/toolkit/test/artifact-output.test.ts',
  },
  {
    id: 'unchanged-output-rewritten',
    invariant:
      'Publishing a plan leaves every generated file whose bytes are unchanged untouched.',
    source: 'packages/toolkit/src/output-host.ts',
    find: '    else if (existing.digest !== file.digest || existing.bytes !== file.bytes) {',
    replace: '    else {',
    caughtBy: 'packages/toolkit/test/artifact-output.test.ts',
  },
  {
    id: 'stale-generated-file-kept',
    invariant:
      'A generated file the new output plan no longer produces is removed when that output plan is published.',
    source: 'packages/toolkit/src/output-host.ts',
    find: '    if (!desired.has(file.path)) stale.push(file.path);',
    replace: '    if (!desired.has(file.path)) void file;',
    caughtBy: 'packages/toolkit/test/artifact-output.test.ts',
  },
  {
    id: 'unowned-file-in-generated-root-admitted',
    invariant:
      'A generated root holding a file its manifest does not list is refused, and the file is left alone.',
    source: 'packages/toolkit/src/output-host.ts',
    find: '    if (!expected.has(path)) {',
    replace: '    if (false) {',
    caughtBy: 'packages/toolkit/test/artifact-output.test.ts',
  },
  {
    id: 'output-path-traversal-admitted',
    invariant:
      'An output path with a parent segment or a trailing dot is refused before anything is planned.',
    source: 'packages/toolkit/src/output-plan.ts',
    find: "      segment === '..' ||\n      segment.endsWith('.') ||",
    replace: "      segment === '.' ||",
    caughtBy: 'packages/toolkit/test/artifact-output.test.ts',
  },
  {
    id: 'case-insensitive-output-collision-admitted',
    invariant:
      'Two output paths that differ only in case are refused as one collision.',
    source: 'packages/toolkit/src/output-plan.ts',
    find: '    if (exact.has(input.path) || existing !== undefined) {',
    replace: '    if (exact.has(input.path)) {',
    caughtBy: 'packages/toolkit/test/artifact-output.test.ts',
  },
  {
    id: 'recovery-payload-not-minimal',
    invariant:
      'The recovery payload carries the selected recovery messages in each locale and nothing else.',
    source: 'packages/toolkit/src/compiled-artifacts.ts',
    find: '      if (!selected.has(identity)) continue;',
    replace: '      if (false) continue;',
    caughtBy: 'packages/toolkit/test/artifact-output.test.ts',
  },
  {
    id: 'missing-init-field-not-named',
    invariant:
      'An initialization missing a required field is refused with the flags that supply it.',
    source: 'packages/toolkit/src/project-host.ts',
    find: '    if (!option.required) return false;',
    replace: '    if (!option.required || true) return false;',
    caughtBy: 'packages/toolkit/test/init-options.test.ts',
  },
  {
    id: 'block-scalar-flattened-by-format',
    invariant: 'Formatting keeps a block scalar written as one.',
    source: 'packages/toolkit/src/catalog.ts',
    find: '        node.type === Scalar.BLOCK_LITERAL ||',
    replace: '        false &&\n        node.type === Scalar.BLOCK_LITERAL ||',
    caughtBy: 'packages/toolkit/test/lossless-format.test.ts',
  },
  {
    id: 'manifest-indentation-not-kept',
    invariant:
      'A package.json Equator rewrites keeps the indentation it was written in.',
    source: 'packages/toolkit/src/project-host.ts',
    find: "    style !== null ? (style[2] ?? '') : source.trim() === '{}' ? '  ' : '';",
    replace: "    '  ';",
    caughtBy: 'packages/toolkit/test/uninstall.test.ts',
  },
  {
    id: 'dry-run-creates-the-work-root',
    invariant:
      'A dry-run publication writes nothing, not even the work root or its lock.',
    source: 'packages/toolkit/src/output-host.ts',
    find: '  if (request.dryRun !== true) {',
    replace: '  if (true) {',
    caughtBy: 'packages/toolkit/test/artifact-output.test.ts',
  },
  {
    id: 'warning-blocks-a-bare-check',
    invariant:
      'Only an error-severity diagnostic fails a run; a warning does not.',
    source: 'packages/toolkit/src/diagnostics.ts',
    find: "  return diagnostics.some(({ severity }) => severity === 'error');",
    replace:
      "  return diagnostics.some(({ severity }) => severity !== 'info');",
    caughtBy: 'packages/toolkit/test/gate-exit-code.test.ts',
  },
  {
    id: 'missing-locale-catalog-escapes-the-completeness-policy',
    invariant:
      'A locale with no catalog for a scope is escalated by the completeness policy exactly as a missing message is.',
    source: 'packages/toolkit/src/semantic-model.ts',
    find: '        const policy = completenessPolicy(\n          request.configuration,\n          request.requireCompleteTargets === true,',
    replace:
      '        const policy = completenessPolicy(\n          request.configuration,\n          false,',
    caughtBy: 'packages/toolkit/test/completeness-family.test.ts',
  },
  {
    id: 'inherited-catalog-counted-missing',
    invariant:
      'A locale that inherits a catalog from its parent chain is not reported as having none.',
    source: 'packages/toolkit/src/semantic-model.ts',
    find: '        (inheritedCatalogs.get(locale) ?? noInheritance).length === 0',
    replace: '        true',
    caughtBy: 'packages/toolkit/test/parent-locale-chain.test.ts',
  },
  {
    id: 'in-progress-declaration-ignored-under-the-gate',
    invariant:
      'A locale declared still in progress keeps its completeness findings at warning under the release gate.',
    source: 'packages/toolkit/src/configuration.ts',
    find: '  const declared = configuration.inProgress[locale];',
    replace:
      '  const declared = configuration.inProgress[locale];\n  if (declared !== undefined) return BLOCKING;',
    caughtBy: 'packages/toolkit/test/completeness-family.test.ts',
  },
  {
    id: 'in-progress-reason-not-carried',
    invariant:
      'A finding downgraded by an in-progress declaration quotes the declared reason.',
    source: 'packages/toolkit/src/configuration.ts',
    find: '    suffix: ` ${locale} is declared still in progress: ${declared.note}`,',
    replace: "    suffix: '',",
    caughtBy: 'packages/toolkit/test/completeness-family.test.ts',
  },
  {
    id: 'parser-code-frame-carried-into-diagnostic',
    invariant:
      "A YAML parser failure reaches the diagnostic as its sentence, without the parser's code frame.",
    source: 'packages/toolkit/src/catalog.ts',
    find: '        `Equator catalog YAML is invalid: ${yamlErrorSentence(error.message)}`,',
    replace: '        `Equator catalog YAML is invalid: ${error.message}`,',
    caughtBy: 'packages/toolkit/test/diagnostic-wording.test.ts',
  },
  {
    id: 'corrupt-compiler-cache-fails-the-run',
    invariant:
      'A corrupt incremental cache is ignored with an info note and recomputed, never a failure.',
    source: 'packages/toolkit/src/project-host.ts',
    find: '    if (error instanceof SyntaxError) {',
    replace: '    if (false) {',
    caughtBy: 'packages/toolkit/test/project-host.test.ts',
  },
  {
    id: 'empty-first-run-reported-as-error',
    invariant:
      'A project with no catalogs yet is told where the first one goes at info severity, and the run does not fail.',
    source: 'packages/toolkit/src/project-host.ts',
    find: "for example i18n/shell/${configuration.sourceLocale}.yaml.`,\n            'info',",
    replace:
      "for example i18n/shell/${configuration.sourceLocale}.yaml.`,\n            'error',",
    caughtBy: 'packages/toolkit/test/diagnostic-wording.test.ts',
  },
  {
    id: 'stale-xliff-unit-imported',
    invariant:
      'A unit translated against an older source is left out of an import with a warning while the current units are accepted.',
    source: 'packages/toolkit/src/xliff.ts',
    find: '      contract.sourceFingerprint !==',
    replace: '      false &&\n      contract.sourceFingerprint !==',
    caughtBy: 'packages/toolkit/test/interchange.test.ts',
  },
  {
    id: 'initial-xliff-target-imported',
    invariant:
      'A target still in its initial state is not imported as a translation.',
    source: 'packages/toolkit/src/xliff.ts',
    find: "    if (state === 'initial') {",
    replace: '    if (false) {',
    caughtBy: 'packages/toolkit/test/translator-guidance.test.ts',
  },
  {
    id: 'pseudo-locale-accents-a-url',
    invariant:
      'A pseudo-locale leaves a URL in message text exactly as written.',
    source: 'packages/toolkit/src/pseudo-localization.ts',
    find: '    result += match[0];',
    replace: '    result += transform(match[0]);',
    caughtBy: 'packages/toolkit/test/interchange.test.ts',
  },
  {
    id: 'negative-length-factor-ignored',
    invariant: 'A negative pseudo-locale length factor contracts the text.',
    source: 'packages/toolkit/src/pseudo-localization.ts',
    find: '  if (lengthFactor < 0) return elide(substituted, -lengthFactor);',
    replace: '  if (lengthFactor < 0) return substituted;',
    caughtBy: 'packages/toolkit/test/interchange.test.ts',
  },
  {
    id: 'boundary-markers-always-on',
    invariant:
      'Boundary markers appear only when a pseudo-locale asks for them.',
    source: 'packages/toolkit/src/pseudo-localization.ts',
    find: '  if (transform.markers === true) {',
    replace: '  if (true) {',
    caughtBy: 'packages/toolkit/test/interchange.test.ts',
  },
  {
    id: 'pseudo-locale-length-factor-defaulted',
    invariant:
      'A pseudo-locale that declares no length factor is treated as unlengthened.',
    source: 'packages/toolkit/src/pseudo-localization.ts',
    find: '    lengthened: (transform.lengthFactor ?? 0) > 0,',
    replace: '    lengthened: (transform.lengthFactor ?? 0.35) > 0,',
    caughtBy: 'packages/toolkit/test/pseudo-locale-generation.test.ts',
  },
  {
    id: 'xb-admitted-left-to-right',
    invariant:
      'XB is refused on a pseudo-locale whose script is written left to right.',
    source: 'packages/toolkit/src/pseudo-locale-tags.ts',
    find: "  if (region === 'XB' && direction !== 'rtl') {",
    replace: '  if (false) {',
    caughtBy: 'packages/toolkit/test/pseudo-locale-generation.test.ts',
  },
  {
    id: 'xa-admitted-outside-english',
    invariant: 'XA and XB are refused on a pseudo-locale that is not English.',
    source: 'packages/toolkit/src/pseudo-locale-tags.ts',
    find: "  if (language !== 'en') {",
    replace: '  if (false) {',
    caughtBy: 'packages/toolkit/test/pseudo-locale-generation.test.ts',
  },
  {
    id: 'pseudo-locale-language-differs-from-source',
    invariant:
      "A pseudo-locale whose language differs from the source locale's is refused.",
    source: 'packages/toolkit/src/pseudo-localization.ts',
    find: '  if (locale.language !== source) {',
    replace: '  if (false) {',
    caughtBy: 'packages/toolkit/test/pseudo-locale-generation.test.ts',
  },
  {
    id: 'pseudo-locales-generated-without-the-flag',
    invariant:
      'A generation run without the pseudo-locale request emits no pseudo-locale, whatever the configuration declares.',
    source: 'packages/toolkit/src/project-host.ts',
    find: '    selection.pseudoLocales === true',
    replace: '    selection.pseudoLocales !== false',
    caughtBy: 'packages/toolkit/test/pseudo-locale-generation.test.ts',
  },
  {
    id: 'generated-pseudo-locale-list-admits-a-repeat',
    invariant:
      'The runtime refuses a generated pseudo-locale list that names one locale twice.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '  if (new Set(entries).size !== entries.length) return false;',
    replace: '  if (false) return false;',
    caughtBy: 'packages/runtime/test/locale-neutral-addresses.test.ts',
  },
  {
    id: 'catalog-noncharacter-admitted',
    invariant:
      'Catalog text carrying a Unicode noncharacter is refused when the catalog is parsed.',
    source: 'packages/toolkit/src/unicode-safety.ts',
    find: '    if (isNoncharacter(codePoint)) return false;',
    replace: '    if (false && isNoncharacter(codePoint)) return false;',
    caughtBy: 'packages/toolkit/test/bounded-inputs-and-parser-safety.test.ts',
  },
  {
    id: 'balanced-isolate-refused',
    invariant:
      'A balanced directional isolate in an authored value is accepted, so a translator can contain a left-to-right name inside right-to-left prose.',
    source: 'packages/toolkit/src/unicode-safety.ts',
    find: 'const DIRECTIONAL_OVERRIDE = /[\\u202a-\\u202e]/u;',
    replace:
      'const DIRECTIONAL_OVERRIDE = /[\\u202a-\\u202e\\u2066-\\u2069]/u;',
    caughtBy: 'packages/toolkit/test/bidi-policy.test.ts',
  },
  {
    id: 'directional-marks-refused',
    invariant:
      'Directional marks, the zero-width space and the word joiner are accepted in authored values.',
    source: 'packages/toolkit/src/unicode-safety.ts',
    find: "  if (value.includes('\\ufeff')) return 'byte-order-mark';",
    replace:
      "  if (/[\\ufeff\\u200b\\u200e\\u200f\\u061c\\u2060]/u.test(value)) return 'byte-order-mark';",
    caughtBy: 'packages/toolkit/test/bidi-policy.test.ts',
  },
  {
    id: 'refused-bidi-control-unexplained',
    invariant:
      'Refusing an invisible control says what the character does to the text around it.',
    source: 'packages/toolkit/src/unicode-safety.ts',
    find: "      'Equator catalog text contains a directional override or embedding (U+202A-U+202E), which reorders the text around it and cannot be seen while reading the file.',",
    replace: "      'Equator catalog text contains a forbidden character.',",
    caughtBy: 'packages/toolkit/test/bidi-policy.test.ts',
  },
  {
    id: 'interpolated-value-projected-bare',
    invariant:
      'The formatter isolates an interpolated value in the projected text, so no call site has to.',
    source: 'packages/runtime/src/evaluator.ts',
    find: '          append(isolatedValueText(part, messageDirection));',
    replace: '          append(part.value);',
    caughtBy: 'packages/runtime/test/bidi-isolation.test.ts',
  },
  {
    id: 'unknown-direction-value-left-bare',
    invariant:
      'A value of unknown direction is wrapped in a first-strong isolate.',
    source: 'packages/runtime/src/evaluator.ts',
    find: "  if (part.contentDirection === 'auto') return `${FSI}${part.value}${PDI}`;",
    replace: "  if (part.contentDirection === 'auto') return part.value;",
    caughtBy: 'packages/runtime/test/bidi-isolation.test.ts',
  },
  {
    id: 'right-to-left-value-isolated-as-left-to-right',
    invariant:
      'A right-to-left value is wrapped in a right-to-left isolate in a message of either direction.',
    source: 'packages/runtime/src/evaluator.ts',
    find: "  if (part.contentDirection === 'rtl') return `${RLI}${part.value}${PDI}`;",
    replace:
      "  if (part.contentDirection === 'rtl') return `${LRI}${part.value}${PDI}`;",
    caughtBy: 'packages/runtime/test/bidi-isolation.test.ts',
  },
  {
    id: 'left-to-right-value-isolated-in-a-left-to-right-message',
    invariant:
      'A left-to-right value in a left-to-right message is left bare unless the author asked for isolation.',
    source: 'packages/runtime/src/evaluator.ts',
    find: "  return messageDirection === 'ltr' && !part.isolate",
    replace: "  return false && messageDirection === 'ltr' && !part.isolate",
    caughtBy: 'packages/runtime/test/bidi-isolation.test.ts',
  },
  {
    id: 'author-direction-declaration-ignored',
    invariant:
      'A direction the author declared with u:dir takes the place of the content check.',
    source: 'packages/runtime/src/evaluator.ts',
    find: '  if (unicode.direction === undefined && unicode.id === undefined) return value;',
    replace: '  if (unicode.id === undefined) return value;',
    caughtBy: 'packages/runtime/test/bidi-isolation.test.ts',
  },
  {
    id: 'slot-part-direction-not-taken-from-its-catalog',
    invariant:
      'A slot part carries the language and direction of the catalog that supplied it, not a fixed direction.',
    source: 'packages/runtime/src/evaluator.ts',
    find: '    language: languageForLocale(environment.supplyingLocale),\n    direction: environment.supplyingDirection,\n    supplyingLocale: environment.supplyingLocale,\n  });\n}\n\nfunction evaluatePattern(',
    replace:
      "    language: languageForLocale(environment.supplyingLocale),\n    direction: 'ltr' as const,\n    supplyingLocale: environment.supplyingLocale,\n  });\n}\n\nfunction evaluatePattern(",
    caughtBy: 'packages/runtime/test/message-local-slot-parts.test.ts',
  },
  {
    id: 'required-extension-binding-not-checked',
    invariant:
      'A catalog that requires an extension is refused where the matching binding is absent or its descriptor differs.',
    source: 'packages/runtime/src/extensions.ts',
    find: '      if (\n        binding === undefined ||\n        descriptorSnapshot(binding.descriptor).canonical !==\n          descriptorSnapshot(admitted).canonical\n      ) {',
    replace: '      if (false) {',
    caughtBy: 'packages/runtime/test/identifier-segment-binding.test.ts',
  },
  {
    id: 'refused-input-echoed-into-its-diagnostic',
    invariant:
      'A validator that refuses untrusted input names its type in the diagnostic and never its value.',
    source: 'packages/toolkit/src/untrusted-text.ts',
    find: '        `${label} must be a string, not ${describeType(value)}.`,',
    replace:
      '        `${label} must be a string, not ${JSON.stringify(value)}.`,',
    caughtBy: 'packages/toolkit/test/untrusted-input.test.ts',
  },
  {
    id: 'person-name-parts-lose-language',
    invariant:
      "Each field of a formatted name carries the name's own language and direction as part metadata.",
    source: 'packages/runtime/src/formatting.ts',
    find: '          language: value.language,\n          direction: nameDirection,',
    replace: '',
    caughtBy: 'packages/runtime/test/person-names.test.ts',
  },
  {
    id: 'formatter-cache-key-omits-locale',
    invariant:
      "A cached number formatter is keyed on its full locale tag, so a request for other digits is never handed another locale's formatter.",
    source: 'packages/runtime/src/evaluator.ts',
    find: '    const key = `number\\u0000${locale}\\u0000${stableOptions(options as Readonly<Record<string, unknown>>)}`;',
    replace:
      '    const key = `number\\u0000${stableOptions(options as Readonly<Record<string, unknown>>)}`;',
    caughtBy: 'packages/runtime/test/shared-formatter-cache.test.ts',
  },
  {
    id: 'formatter-cache-never-evicts',
    invariant:
      'The formatter cache holds at most its ceiling and evicts the least recently used entry past it.',
    source: 'packages/runtime/src/evaluator.ts',
    find: '    while (this.values.size > this.maximumEntries) {',
    replace: '    while (false && this.values.size > this.maximumEntries) {',
    caughtBy: 'packages/runtime/test/shared-formatter-cache.test.ts',
  },
  {
    id: 'locale-formatting-admits-time-zone',
    invariant:
      'A per-locale formatting entry admits a numbering system, a calendar and an hour cycle, and refuses a time zone.',
    source: 'packages/toolkit/src/schemas.ts',
    find: '        additionalProperties: false,\n        // An entry that sets nothing states nothing, and would read as a decision that was made.',
    replace:
      '        additionalProperties: true,\n        // An entry that sets nothing states nothing, and would read as a decision that was made.',
    caughtBy: 'packages/toolkit/test/locale-formatting-declaration.test.ts',
  },
  {
    id: 'person-name-order-from-the-reader-locale',
    invariant:
      'A name is ordered by its own language, not by the locale of the page it appears on.',
    source: 'packages/runtime/src/formatting.ts',
    find: '  const order = personNameOrder(profile, value.language, options.order);',
    replace:
      '  const order = personNameOrder(profile, context.locale, options.order);',
    caughtBy: 'packages/runtime/test/person-names.test.ts',
  },
  {
    id: 'script-difference-matched-as-same-language',
    invariant:
      'A request is answered with a same-language locale only when both are written in the same script, so a script difference is never bridged as a near match.',
    source: 'packages/runtime/src/locale-negotiation.ts',
    find: '      (profile) => profile.language === language && profile.script === script,',
    replace: '      (profile) => profile.language === language,',
    caughtBy: 'packages/runtime/test/locale-negotiation.test.ts',
  },
  {
    id: 'unknown-function-option-accepted',
    invariant:
      'An option a built-in function does not take is refused when the message is compiled, rather than accepted and ignored.',
    source: 'packages/toolkit/src/message-function-options.ts',
    find: '  if (!profile.accepts.includes(optionName)) {',
    replace: '  if (false) {',
    caughtBy: 'packages/toolkit/test/function-option-vocabulary.test.ts',
  },
  {
    id: 'unknown-message-function-accepted',
    invariant:
      'A message that calls a function outside the standard set and the registered extensions is refused when it is compiled (EQ1203).',
    source: 'packages/toolkit/src/message-format.ts',
    find: '  if (unsupportedFunctions.length > 0) {',
    replace: '  if (false) {',
    caughtBy: 'packages/toolkit/test/message-format.test.ts',
  },
  {
    id: 'descriptor-binding-accepts-extra-code',
    invariant:
      'A runtime binding carries exactly its descriptor and the one handler its kind calls, and a binding that carries anything else is refused.',
    source: 'packages/runtime/src/extensions.ts',
    find: "    if (!hasExactKeys(candidate, ['descriptor'])) {",
    replace: '    if (false) {',
    caughtBy: 'packages/runtime/test/identifier-segment-binding.test.ts',
  },
  {
    id: 'missing-extension-binding-admitted',
    invariant:
      'A catalog that requires an extension the application did not bind, or bound under a different descriptor, is refused when the runtime is composed.',
    source: 'packages/runtime/src/extensions.ts',
    find: '        binding === undefined ||\n        descriptorSnapshot(binding.descriptor).canonical !==',
    replace:
      '        false &&\n        descriptorSnapshot(binding.descriptor).canonical !==',
    caughtBy: 'packages/runtime/test/identifier-segment-binding.test.ts',
  },
  {
    id: 'xliff-export-writes-an-earlier-version',
    invariant:
      'An exported interchange document declares XLIFF version 2.2, the pinned edition.',
    source: 'packages/toolkit/src/xliff.ts',
    find: 'xmlns:mda="${XLIFF_METADATA_NAMESPACE}" version="2.2" srcLang=',
    replace: 'xmlns:mda="${XLIFF_METADATA_NAMESPACE}" version="2.1" srcLang=',
    caughtBy: 'packages/toolkit/test/interchange.test.ts',
  },
  {
    id: 'xliff-unit-children-out-of-schema-order',
    invariant:
      'An exported unit puts module metadata before its notes, in the order the pinned XLIFF 2.2 schema requires, so the document validates.',
    source: 'packages/toolkit/src/xliff.ts',
    find: '        unitMetadata(contract),\n        ...unitNotes(sourceMessage, targetMessage),',
    replace:
      '        ...unitNotes(sourceMessage, targetMessage),\n        unitMetadata(contract),',
    caughtBy: 'packages/toolkit/test/xliff-schema.test.ts',
  },
  {
    id: 'xliff-elements-matched-by-local-name',
    invariant:
      "Interchange elements are recognised by namespace as well as name, so content from another module or vendor is never read as Equator's own.",
    source: 'packages/toolkit/src/xliff.ts',
    find: '      child.namespace === namespace &&\n      child.localName === localName,',
    replace: '      child.localName === localName,',
    caughtBy: 'packages/toolkit/test/interchange.test.ts',
  },
  {
    id: 'foreign-note-absorbed-into-catalog',
    invariant:
      "Only notes in Equator's own categories are read back into a catalog; a translator's or tool's note is reported instead.",
    source: 'packages/toolkit/src/xliff.ts',
    find: '    if (category !== NOTE_DESCRIPTION && category !== NOTE_CONTEXT) {',
    replace: '    if (category === undefined) {',
    caughtBy: 'packages/toolkit/test/translator-guidance.test.ts',
  },
  {
    id: 'changed-source-guidance-unreported',
    invariant:
      'Source guidance that comes back edited in an interchange document is reported and not applied.',
    source: 'packages/toolkit/src/xliff.ts',
    find: '    for (const [field, value] of Object.entries(notes.source)) {',
    replace:
      '    for (const [field, value] of Object.entries({} as typeof notes.source)) {',
    caughtBy: 'packages/toolkit/test/translator-guidance.test.ts',
  },
  {
    id: 'foreign-note-dropped-silently',
    invariant:
      'A note Equator does not store is reported by its category, never passed over without a word.',
    source: 'packages/toolkit/src/xliff.ts',
    find: '    if (notes.foreign.length > 0) {',
    replace: '    if (false) {',
    caughtBy: 'packages/toolkit/test/translator-guidance.test.ts',
  },
  {
    id: 'initial-segment-imported-as-translation',
    invariant:
      'A target in the initial state is reported and not imported as translated work.',
    source: 'packages/toolkit/src/xliff.ts',
    find: "    if (state === 'initial') {",
    replace: '    if (false) {',
    caughtBy: 'packages/toolkit/test/translator-guidance.test.ts',
  },
  {
    id: 'undefined-segment-state-imported',
    invariant:
      'A segment state outside the four XLIFF 2.2 defines fails the import and is named in the diagnostic.',
    source: 'packages/toolkit/src/xliff.ts',
    find: '    if (!XLIFF_SEGMENT_STATES.has(state)) {',
    replace: '    if (false) {',
    caughtBy: 'packages/toolkit/test/translator-guidance.test.ts',
  },
  {
    id: 'invented-placeholder-imported',
    invariant:
      'A translation that carries a placeholder its source message does not have is refused and the placeholder is named.',
    source: 'packages/toolkit/src/xliff.ts',
    find: '      const extra = pattern.codes.filter((key) => !expected.includes(key));',
    replace: '      const extra: typeof expected = [];',
    caughtBy: 'packages/toolkit/test/xliff-schema.test.ts',
  },
  {
    id: 'dropped-placeholder-imported',
    invariant:
      'A translation that lost a placeholder its source message has is refused, and the diagnostic names the missing placeholder.',
    source: 'packages/toolkit/src/xliff.ts',
    find: '      const missing = expected.filter((key) => !pattern.codes.includes(key));',
    replace: '      const missing: typeof expected = [];',
    caughtBy: 'packages/toolkit/test/xliff-schema.test.ts',
  },
  {
    id: 'canonical-json-admits-unpaired-surrogate',
    invariant:
      'Canonical JSON refuses an unpaired surrogate rather than serializing a string two readers decode differently.',
    source: 'packages/toolkit/src/canonical-json.ts',
    find: '      if (!(following >= 0xdc00 && following <= 0xdfff)) {',
    replace: '      if (false) {',
    caughtBy: 'packages/toolkit/test/artifact-output.test.ts',
  },
  {
    id: 'diagnostic-summary-unbounded',
    invariant: 'A diagnostic summary is cut to its code-point ceiling.',
    source: 'packages/toolkit/src/diagnostics.ts',
    find: '    if (codePoints >= maximumCodePoints) break;',
    replace: '    if (false) break;',
    caughtBy: 'packages/toolkit/test/bounded-inputs-and-parser-safety.test.ts',
  },
  {
    id: 'diagnostic-path-unbounded',
    invariant: 'A diagnostic path is cut to its segment ceiling.',
    source: 'packages/toolkit/src/diagnostics.ts',
    find: '    ?.slice(0, RESOURCE_LIMITS.diagnosticPathSegments)',
    replace: '    ?.slice(0)',
    caughtBy: 'packages/toolkit/test/bounded-inputs-and-parser-safety.test.ts',
  },
  {
    id: 'diagnostic-count-unbounded',
    invariant: 'One operation reports no more diagnostics than its ceiling.',
    source: 'packages/toolkit/src/diagnostics.ts',
    find: '    diagnostics.slice(0, RESOURCE_LIMITS.diagnostics).map((diagnostic) =>',
    replace: '    diagnostics.map((diagnostic) =>',
    caughtBy: 'packages/toolkit/test/bounded-inputs-and-parser-safety.test.ts',
  },
  {
    id: 'diagnostic-span-discarded',
    invariant:
      'A diagnostic keeps the source span it was raised with, so it names the file and line of what it reports.',
    source: 'packages/toolkit/src/diagnostics.ts',
    find: '    ...(options.span === undefined ? {} : { span: boundedSpan(options.span) }),',
    replace: '    ...{},',
    caughtBy: 'packages/toolkit/test/diagnostic-location.test.ts',
  },
  {
    id: 'unavailable-representation-reported-as-operational-failure',
    invariant:
      'A route parameter with no spelling in a locale is reported as a representation that is unavailable, not as an operational failure.',
    source: 'packages/runtime/core/src/routing.ts',
    find: "            outcome: 'localized-representation-unavailable',",
    replace: "            outcome: 'operational-failure',",
    caughtBy: 'packages/runtime/test/route-parameters-and-x-default.test.ts',
  },
  {
    id: 'route-refusal-drops-its-cause',
    invariant:
      "A route configuration refusal keeps the platform error that decided it as the raised error's cause.",
    source: 'packages/runtime/core/src/routing.ts',
    find: '    cause === undefined ? undefined : { cause },',
    replace: '    undefined,',
    caughtBy: 'packages/runtime/test/refusal-reason-and-cause.test.ts',
  },
  {
    id: 'destination-refusal-drops-its-cause',
    invariant:
      "A rich-message destination refusal keeps the URL parser's error as the raised error's cause.",
    source: 'packages/runtime/src/destinations.ts',
    find: '    cause === undefined ? undefined : { cause },',
    replace: '    undefined,',
    caughtBy: 'packages/runtime/test/refusal-reason-and-cause.test.ts',
  },
  {
    id: 'toolkit-event-carries-an-extra-field',
    invariant:
      'A toolkit event carries only its profile, code, phase, status and the bounded fields its shape declares.',
    source: 'packages/toolkit/src/observability.ts',
    find: '    profile: TOOLKIT_OBSERVABILITY_PROFILE,',
    replace:
      '    profile: TOOLKIT_OBSERVABILITY_PROFILE,\n    timestamp: Date.now(),',
    caughtBy: 'packages/toolkit/test/observability.test.ts',
  },
  {
    id: 'toolkit-sink-exception-escapes',
    invariant:
      'A toolkit sink that throws changes nothing about the operation that raised the event.',
    source: 'packages/toolkit/src/observability.ts',
    find: '  try {\n    sink.emit(event);\n  } catch {\n    // Observability is optional and cannot affect compiler or authoring work.\n  }',
    replace: '  sink.emit(event);',
    caughtBy: 'packages/toolkit/test/observability.test.ts',
  },
  {
    id: 'toolkit-repeated-failure-emitted-again',
    invariant:
      'The toolkit reports an equivalent failure once within its window.',
    source: 'packages/toolkit/src/observability.ts',
    find: '    if (previous !== undefined && now - previous < 1_000) return;',
    replace: '    if (false) return;',
    caughtBy: 'packages/toolkit/test/observability.test.ts',
  },
  {
    id: 'toolkit-canonicalization-skips-the-platform',
    invariant:
      'The toolkit canonicalizes a locale tag through the same ECMA-402 algorithm the runtime uses, so both write one spelling for one locale.',
    source: 'packages/toolkit/src/locales.ts',
    find: '    canonical = locales[0];',
    replace: '    canonical = locale;',
    caughtBy: 'packages/toolkit/test/round-trip-properties.test.ts',
  },
  {
    id: 'negotiation-answers-the-maximized-tag',
    invariant:
      'Negotiation compares maximized scripts but answers with the supported locale exactly as declared.',
    source: 'packages/runtime/src/locale-negotiation.ts',
    find: '    if (related !== undefined) return related.locale;',
    replace:
      '    if (related !== undefined)\n      return new Intl.Locale(related.locale).maximize().toString();',
    caughtBy: 'packages/runtime/test/locale-negotiation.test.ts',
  },
  {
    id: 'cross-language-parent-narrowed',
    invariant:
      'A parent the pinned CLDR data declares in another language is followed, not dropped.',
    source: 'packages/toolkit/src/locales.ts',
    find: '    return declared === ROOT_LOCALE ? undefined : declared;',
    replace:
      "    return declared === ROOT_LOCALE ||\n      declared.split('-')[0] !== locale.split('-')[0]\n      ? undefined\n      : declared;",
    caughtBy: 'packages/toolkit/test/parent-locale-chain.test.ts',
  },
  {
    id: 'shadowing-alias-admitted',
    invariant:
      'An alias spelled as a supported locale is refused (EQ1006) rather than read as one of the two.',
    source: 'packages/toolkit/src/configuration.ts',
    find: '    if (aliasAsLocale.ok && localeSet.has(aliasAsLocale.value)) {',
    replace: '    if (false && aliasAsLocale.ok) {',
    caughtBy: 'packages/toolkit/test/authoring.test.ts',
  },
  {
    id: 'alias-to-unsupported-locale-admitted',
    invariant:
      'An alias that names a locale the configuration does not support is refused (EQ1006).',
    source: 'packages/toolkit/src/configuration.ts',
    find: '    } else if (!localeSet.has(canonicalTarget.value)) {',
    replace: '    } else if (false) {',
    caughtBy: 'packages/toolkit/test/authoring.test.ts',
  },
  {
    id: 'same-language-match-ignores-script',
    invariant:
      'The same-language step matches a supported locale only when its maximized script is the one the request is written in.',
    source: 'packages/runtime/src/locale-negotiation.ts',
    find: '      (profile) => profile.language === language && profile.script === script,',
    replace: '      (profile) => profile.language === language,',
    caughtBy: 'packages/runtime/test/locale-negotiation.test.ts',
  },
  {
    id: 'accept-language-weights-ignored',
    invariant:
      'Language ranges are tried in the order of their quality values, with header order breaking a tie.',
    source: 'packages/runtime/src/locale-negotiation.ts',
    find: '          : right.quality - left.quality,',
    replace: '          : left.index - right.index,',
    caughtBy: 'packages/runtime/test/locale-negotiation.test.ts',
  },
  {
    id: 'partial-removal-reported-complete',
    invariant:
      'A removal that did not reach every configured store is reported as incomplete.',
    source: 'packages/runtime/src/locale-resolution.ts',
    find: '        complete: unreached.length === 0,',
    replace: '        complete: true,',
    caughtBy: 'packages/runtime/test/forgetting-a-remembered-locale.test.ts',
  },
  {
    id: 'store-without-removal-counted-as-reached',
    invariant:
      'A store that offers no removal is named as one the removal did not reach.',
    source: 'packages/runtime/src/locale-resolution.ts',
    find: "          unreached.push(\n            Object.freeze({ storeId: store.id, reason: 'no-removal' as const }),\n          );",
    replace: '          // The store offers no removal and is not counted.',
    caughtBy: 'packages/runtime/test/forgetting-a-remembered-locale.test.ts',
  },
  {
    id: 'seat-hides-the-declared-outcome',
    invariant:
      'The server seat reports the page outcome a render declared and whether the handler carried it.',
    source: 'packages/runtime/testing/src/server-seat.ts',
    find: '      pageOutcome:\n        observed.declared === undefined',
    replace: '      pageOutcome:\n        true',
    caughtBy: 'packages/runtime/test/server-seat.test.ts',
  },
  {
    id: 'executable-yaml-tag-admitted',
    invariant:
      'A catalog that names a YAML tag the restricted profile does not know is refused rather than read as a plain value.',
    source: 'packages/toolkit/src/catalog.ts',
    find: '  const parserDiagnostics = [...document.errors, ...document.warnings].map(',
    replace: '  const parserDiagnostics = [...document.errors].map(',
    caughtBy: 'packages/toolkit/test/authoring.test.ts',
  },
  {
    id: 'catalog-identity-carries-locale',
    invariant:
      "A message identity is its provider, scope and message alone, so every locale's catalog names the same message.",
    source: 'packages/toolkit/src/semantic-model.ts',
    find: '      const identity = `${sourceCatalog.providerId}:${sourceCatalog.scopeId}:${messageId}`;',
    replace:
      '      const identity = `${sourceCatalog.providerId}:${sourceCatalog.scopeId}:${sourceCatalog.locale}:${messageId}`;',
    caughtBy: 'packages/toolkit/test/semantic-model.test.ts',
  },
  {
    id: 'translator-context-written-as-description',
    invariant:
      'Context and description reach the translator as two notes of different categories, never one standing in for the other.',
    source: 'packages/toolkit/src/xliff.ts',
    find: "            'equator-source-context',\n            NOTE_CONTEXT,",
    replace:
      "            'equator-source-context',\n            NOTE_DESCRIPTION,",
    caughtBy: 'packages/toolkit/test/translator-guidance.test.ts',
  },
  {
    id: 'target-guidance-dropped',
    invariant:
      'Guidance a target entry carries for its own locale reaches the translator beside the source guidance.',
    source: 'packages/toolkit/src/xliff.ts',
    find: '    ...(target?.description === undefined',
    replace: '    ...(true',
    caughtBy: 'packages/toolkit/test/translator-guidance.test.ts',
  },
  {
    id: 'target-entry-declares-inputs',
    invariant:
      'A target entry that declares inputs is refused, because a translation inherits its contract from the source.',
    source: 'packages/toolkit/src/schemas.ts',
    find: '              context: nonemptyTextSchema,',
    replace:
      '              context: nonemptyTextSchema,\n              inputs: messageRecordSchema.properties.inputs,',
    caughtBy: 'packages/toolkit/test/authoring.test.ts',
  },
  {
    id: 'unannotated-input-made-optional',
    invariant:
      'An unannotated external variable is inferred as a required, non-nullable string.',
    source: 'packages/toolkit/src/semantic-model.ts',
    find: '        optional: refinement?.optional ?? inheritedContract?.optional ?? false,',
    replace:
      '        optional: refinement?.optional ?? inheritedContract?.optional ?? true,',
    caughtBy: 'packages/toolkit/test/semantic-model.test.ts',
  },
  {
    id: 'function-operand-type-ignored',
    invariant:
      "A variable annotated by a function takes that function's operand type rather than defaulting to a string.",
    source: 'packages/toolkit/src/semantic-model.ts',
    find: "      explicitTypes[0] ?? inheritedContract?.type ?? ('string' as const);",
    replace: "      inheritedContract?.type ?? ('string' as const);",
    caughtBy: 'packages/toolkit/test/semantic-model.test.ts',
  },
  {
    id: 'formatting-selector-deferred-to-render',
    invariant:
      'A .match over a function that formats but does not select is refused when the message is compiled, not left to fall back to the catch-all when it renders.',
    source: 'packages/toolkit/src/message-format.ts',
    find: '      if (name === undefined || selectorNames.has(name)) continue;',
    replace: '      if (name === undefined || name.length >= 0) continue;',
    caughtBy: 'packages/toolkit/test/message-format.test.ts',
  },
  {
    id: 'inherited-options-bypass-descriptor',
    invariant:
      'A registered function is called with only the options its own descriptor declares, whatever its operand carried.',
    source: 'packages/runtime/src/evaluator.ts',
    find: '        options: declaredOptionsOnly(resolvedOptions, binding.descriptor),',
    replace: '        options: resolvedOptions,',
    caughtBy: 'packages/runtime/test/message-function-extensions.test.ts',
  },
  {
    id: 'contradicting-refinement-accepted',
    invariant:
      'A source refinement that contradicts the operand type a function gives its variable is refused.',
    source: 'packages/toolkit/src/semantic-model.ts',
    find: '  if (!compatibleRefinement(inferred, refined)) {',
    replace: '  if (false as boolean) {',
    caughtBy: 'packages/toolkit/test/semantic-model.test.ts',
  },
  {
    id: 'target-entry-declares-slots',
    invariant:
      'A target entry that declares slots is refused, because a translation inherits its rich-slot contract from the source.',
    source: 'packages/toolkit/src/schemas.ts',
    find: '              context: nonemptyTextSchema,',
    replace:
      '              context: nonemptyTextSchema,\n              slots: messageRecordSchema.properties.slots,',
    caughtBy: 'packages/toolkit/test/authoring.test.ts',
  },
  {
    id: 'target-invents-slot',
    invariant:
      'A target message that uses a rich slot its source does not have is reported.',
    source: 'packages/toolkit/src/semantic-model.ts',
    find: '    const source = sourceSlots.find(({ name }) => name === target.name);',
    replace:
      '    const source = sourceSlots.find(({ name }) => name === target.name);\n    if (source === undefined) continue;',
    caughtBy: 'packages/toolkit/test/semantic-model.test.ts',
  },
  {
    id: 'heterogeneous-family-accepted',
    invariant:
      'An open family whose current members do not share one input and rich-slot contract is refused.',
    source: 'packages/toolkit/src/semantic-model.ts',
    find: '      memberMessages.some((message) => commonContractJson(message) !== common)',
    replace: '      false',
    caughtBy: 'packages/toolkit/test/extensions-and-families.test.ts',
  },
  {
    id: 'family-membership-not-derived',
    invariant:
      "Every source message that satisfies a family's template becomes a member without being listed anywhere.",
    source: 'packages/toolkit/src/semantic-model.ts',
    find: '        const segments = familyMatch(message.messageId, parsed, extensions);',
    replace:
      '        const segments =\n          message.messageId.length < 0\n            ? familyMatch(message.messageId, parsed, extensions)\n            : undefined;',
    caughtBy: 'packages/toolkit/test/extensions-and-families.test.ts',
  },
  {
    id: 'stale-translation-blocks-by-default',
    invariant:
      'A translation written against an older source is an advisory unless the run asks for the release gate.',
    source: 'packages/toolkit/src/project-host.ts',
    find: '        requireComplete,\n        entry.locale,',
    replace: '        true,\n        entry.locale,',
    caughtBy: 'packages/toolkit/test/completeness-family.test.ts',
  },
  {
    id: 'stale-translation-gate-ignored',
    invariant:
      'The release gate escalates a translation written against an older source to an error.',
    source: 'packages/toolkit/src/project-host.ts',
    find: '        requireComplete,\n        entry.locale,',
    replace: '        false,\n        entry.locale,',
    caughtBy: 'packages/toolkit/test/completeness-family.test.ts',
  },
  {
    id: 'projection-identity-shape-unchecked',
    invariant:
      'A route projection whose identity is not a sha256 digest in unpadded base64url is refused.',
    source: 'packages/runtime/core/src/routing.ts',
    find: '    !/^sha256-[A-Za-z0-9_-]{43}$/u.test(projection.generated.identity)',
    replace: '    false',
    caughtBy: 'packages/runtime/test/routing-refusals.test.ts',
  },
  {
    id: 'input-change-published-anyway',
    invariant:
      'Generation whose inputs changed after compilation reports a failure and leaves the output as it was.',
    source: 'packages/toolkit/src/output-host.ts',
    find: '      request.expectedInputFingerprint !== undefined &&',
    replace: '      false &&',
    caughtBy: 'packages/toolkit/test/artifact-output.test.ts',
  },
  {
    id: 'required-extension-unbound',
    invariant:
      'A descriptor a catalog requires with no registered implementation is refused before any catalog is used.',
    source: 'packages/runtime/src/extensions.ts',
    find: '        binding === undefined ||\n        descriptorSnapshot(binding.descriptor).canonical !==',
    replace:
      '        binding !== undefined &&\n        descriptorSnapshot(binding.descriptor).canonical !==',
    caughtBy: 'packages/runtime/test/identifier-segment-binding.test.ts',
  },
  {
    id: 'message-ceiling-lifted',
    invariant:
      'A MessageFormat source past the byte ceiling is refused before it is parsed.',
    source: 'packages/toolkit/src/message-format.ts',
    find: "    RESOURCE_LIMITS.messageBytes,\n  );\n  if (!sourceText.ok) return sourceText;\n  const source = sourceText.value;\n  if (Buffer.byteLength(source, 'utf8') > RESOURCE_LIMITS.messageBytes) {",
    replace:
      '    Number.MAX_SAFE_INTEGER,\n  );\n  if (!sourceText.ok) return sourceText;\n  const source = sourceText.value;\n  if (false as boolean) {',
    caughtBy: 'packages/toolkit/test/artifact-output.test.ts',
  },
  {
    id: 'failing-value-echoed',
    invariant:
      'A diagnostic names the type of a value it refused and never repeats the value.',
    source: 'packages/toolkit/src/untrusted-text.ts',
    find: '        `${label} must be a string, not ${describeType(value)}.`,',
    replace:
      '        `${label} must be a string, not ${describeType(value)}: ${JSON.stringify(value)}.`,',
    caughtBy: 'packages/toolkit/test/untrusted-input.test.ts',
  },
  {
    id: 'unsupported-angular-host-admitted',
    invariant:
      'An Angular compiler outside the supported major is refused with EQ1806 rather than admitted.',
    source: 'packages/toolkit/src/host-compatibility.ts',
    find: '  return !version.prerelease && version.major === 22;',
    replace: '  return !version.prerelease;',
    caughtBy: 'packages/toolkit/test/host-compatibility.test.ts',
  },
  {
    id: 'number-formatter-rebuilt-on-every-call',
    invariant:
      'The shared formatter store hands back the number formatter it already built, so a hundred identical calls construct one.',
    source: 'packages/runtime/src/evaluator.ts',
    find: '    if (cached instanceof Intl.NumberFormat) {',
    replace:
      '    if (false as boolean && cached instanceof Intl.NumberFormat) {',
    caughtBy: 'packages/runtime/test/shared-formatter-cache.test.ts',
  },
]);
