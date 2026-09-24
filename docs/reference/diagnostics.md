# Diagnostics

Every code `@neolorn/equator-toolkit` reports, and what it means. A diagnostic carries its own
summary describing what happened where it happened; this table describes the code.

This page is generated from the code union and is not edited by hand. The same table ships inside
the package as `DIAGNOSTICS.md`, readable from an install with no network.

Severity is not listed. Several codes carry the severity the run decides: the completeness family
and `EQ1704` are advisory or blocking depending on the command's switches and the project's own
declarations. A finding states the severity it carries, and a run acts on that.

What a diagnostic contains, and what it never contains, is
[About diagnostics and runtime outcomes](../explanation/about-diagnostics.md).

## The project configuration

### EQ1001

`equator.config.json` is not one readable JSON value: a syntax error, a repeated key, more than one value, or the configuration byte ceiling.

### EQ1002

`equator.config.json` is readable JSON, and one of its values is not what the configuration schema allows.

### EQ1003

A locale identifier is malformed. Every place a locale is written is canonicalized first (`locales`, `personNameLocales`, a pseudo-locale tag, a `formatting` or `inProgress` key, an alias target, a catalog's own locale) and a tag the platform would accept can still be refused, including one carrying extensions or private-use subtags.

### EQ1004

A locale identifier is well formed and declared where it cannot be used: it duplicates another after canonicalization, or it names a locale this project does not serve.

### EQ1005

A locale alias is malformed. An alias is a lowercase ASCII identifier of letters, digits and hyphens: a name for a URL rather than a locale tag.

### EQ1006

A locale alias points somewhere it must not: it shadows a supported locale, or it targets a locale the project does not serve.

### EQ1007

A declared parent locale cannot be inherited from: it is the locale itself, or the chain it starts comes back to a locale already in that chain.

## The catalog file

### EQ1101

A catalog file is not the YAML Equator accepts: invalid, oversized, or more than one document; anchors, aliases, merge keys, directives, non-string keys or non-Core scalars; a root that is not a mapping; malformed Unicode or unauthorized invisible and bidi controls; or the node, depth and message ceilings.

### EQ1102

A catalog is well-formed YAML, and one of its entries is not what the catalog schema allows.

### EQ1103

A catalog repeats a key, or its text carries a bidi construction Equator refuses.

### EQ1104

A provider, scope or message identity written in a catalog is malformed.

### EQ1105

A target catalog declares `inputs` or `slots`. Those belong to the source catalog, and a target inherits them.

## The message

### EQ1201

A message is not valid MessageFormat 2 syntax, or exceeds the message byte ceiling.

### EQ1202

A message parses and its data model is invalid: a duplicate declaration, variant or option name, a variant key mismatch, a missing fallback variant, or a selector that reaches no annotation. Which of the two stages found it does not decide the code: the specification's division does.

### EQ1203

A message calls a function outside the Equator 1 profile, which is the UTS #35 default registry.

### EQ1204

A message writes a function option outside the profile, or gives an option a value the profile does not allow.

### EQ1205

A message gives a function an operand it cannot take. Its own code rather than `EQ1204`'s, because a wrong option and a wrong operand have different fixes.

### EQ1206

A `.match` selects on a function that formats but does not select.

## The catalog set

### EQ1301

The catalogs of one scope do not form a set: a locale the project does not declare, a duplicate catalog, no source catalog, an empty scope, or a catalog whose role does not match its locale.

### EQ1302

A message's inputs are not usable: an unknown or unrefinable portable type, incompatible operand uses, an enum value the type cannot hold, a refinement matching no inferred input, an explicitly empty message declaring inputs, or the per-message input ceiling.

### EQ1303

A message's rich slots do not form a valid structure: unclosed or mismatched, nested where nesting is refused, used both paired and standalone, of an unregistered or undeterminable kind, refined past what the source supports, or the per-message slot ceiling.

### EQ1304

A translation does not honour the source message's contract: it invents a message, changes or invents an input, or omits a required rich slot. Also a recovery identity that does not select an existing plain message with no inputs.

### EQ1305

Generated names collide, or an open family is not well formed: two identities projecting to one generated path, a repeated placeholder, a template with no fixed part, members whose contracts differ, or a message two families both match.

### EQ1306

A scope has no catalog at all for a locale the project serves; the source locale is used in its place. One of the four completeness findings: advisory unless the run requires complete targets and the project has not declared that locale still in progress.

### EQ1307

A target catalog omits a message the source has; the source locale is used in its place. Escalates with the rest of the completeness family.

### EQ1308

A translation omits a plural or ordinal category its locale's grammar has, so those counts fall through to the catch-all. Escalates with the rest of the completeness family.

### EQ1309

A translation was written against an older source message and may no longer match it. Raised against the translation record rather than the catalogs, and escalates with the rest of the completeness family.

### EQ1310

This owner composes the Equator application runtime and selects no recovery message, so a failed bootstrap has nothing to say.

### EQ1311

A scope defines source messages that nothing in the application reaches.

## The application

### EQ1401

TypeScript refused the application or its configuration while Equator was analyzing it.

### EQ1402

An Angular component template could not be read or was refused: a symbolic link, a path resolving outside the selected owner, or a template Angular's own parser rejected.

### EQ1403

The analysis exceeded its source-file or byte ceiling, or was asked to resolve something outside the generated `#i18n` namespace.

### EQ1404

A route's identity cannot be used: declared in a form the localization runtime refuses, declared in a way the build cannot read, not derivable from what the route declares, colliding with another route's, or the owner declaring two route-indexing fields.

### EQ1405

A route renders nothing: it carries none of `component`, `loadComponent`, `redirectTo`, `children` or `loadChildren`.

### EQ1406

A route hides addresses from the projection: its address comes from a computed `path`, a `matcher`, or a spread or computed key that may set either, or its children load from a file it only references, or a route table takes routes from a binding, a spread or an expression Equator does not follow. Those addresses stay outside the localized route table and are served at their canonical form in every locale.

### EQ1407

A route loads a file through a lazy boundary that something in the initial bundle also imports statically, so the split does not happen.

### EQ1408

The configuration and the locale URL policy disagree: a configured locale with no address, an address with no catalogs, two different default locales, or more than one policy for Equator to read.

### EQ1409

A route's leading segment is one this owner has already claimed for a locale, so the route and the locale compete for the same address.

### EQ1410

A component template spells out something about a locale that Equator already knows and can hand it: the language subtag, the direction, or the locale's name in its own language.

### EQ1411

A component template writes a `routerLink` whose leading segment is one this owner claims for a locale.

### EQ1412

A sitemap declaration cannot be used as written: a changefreq outside the seven the protocol lists, a priority that is not a number literal between 0 and 1, a lastmod that is not a W3C date, a field, table or route value the build cannot read, or the owner declaring two route sitemap fields.

### EQ1413

A caching declaration cannot be used as written: a value that names neither `per-visitor` nor `not-stored`, a table or a route value the build cannot read as a string literal or a `const` bound to one, or the owner declaring two route caching fields. A route whose value cannot be used is answered as not stored until it is corrected.

### EQ1414

An indexing declaration cannot be used as written: a route value the build cannot read, because it is computed, a parameter, supplied by a resolver or behind a binding it cannot follow, or a field or table it cannot read. A route whose value cannot be read is answered as private until it is corrected.

### EQ1415

A route names its addresses in a way Angular refuses: neither a `path` nor a `matcher`, or a `matcher` beside a non-empty `path`.

### EQ1416

The router's inheritance strategy cannot be read: a `paramsInheritanceStrategy` the build cannot read as a string literal or a `const` bound to one, or more than one router configuration where one sets it. Every child route is read as inheriting its parent's data, which is Angular's default.

## The compiled artifacts

### EQ1501

A compiled artifact cannot be produced from the accepted graph: a recovery identity that resolves to no single plain message, or a catalog absent from the graph.

### EQ1502

A compiled catalog exceeds the IR node or depth ceiling.

### EQ1503

The output plan or the completion manifest is invalid: a malformed or colliding output path, an attempt to replace the reserved completion marker, or a manifest whose header, entries or plan digest do not hold.

## The generated output

### EQ1601

The generated root is not Equator's to write: no completion and ownership manifest, an unowned file inside it, or an owner identity that is not this one.

### EQ1602

An output or authoring transaction did not complete. The message says whether the prior state was restored, because a failure that rolled back and one that could not are different situations.

### EQ1603

Generated output does not match its completion manifest: a file missing, a file changed, or the manifest itself moving while the output was being inspected.

## The command

### EQ1701

The command cannot act on how it was invoked: an unknown or malformed argument, or a noninteractive `equator init` with a required option missing.

### EQ1702

The project could not be selected or read: no Equator configuration inside the package boundary, a selection that is a symbolic link or not a directory, or an owner `package.json` that is missing, unreadable or not an object.

### EQ1703

An environment operation failed, or a disposable one was skipped: a corrupt or incompatible incremental cache, a cache that could not be persisted, a formatting refused because semantic equality was not proven, or a watcher that could not start or reconcile.

### EQ1704

Generated output is stale against the compilation that would produce it. Advisory unless the run requires fresh output.

### EQ1705

`package.json` does not carry what Equator needs, or carries something that conflicts with it: the `#i18n` import mappings, the scripts `equator init` writes, or init arguments that contradict the existing `equator.config.json`.

### EQ1706

`equator init` finished, and is naming the two things that are now the owner's to write: the first catalog, and a recovery message.

## Interchange, authoring, and the host

### EQ1801

An XLIFF document is not readable XML, or exceeds the Equator byte ceiling.

### EQ1802

An XLIFF export or import cannot be performed at all: catalogs that are not the source and target of one scope, a file or unit id that is not an `xs:NMTOKEN`, a document that is not the Equator 2.2 profile, or a source message whose markup has no XLIFF inline representation.

### EQ1803

An XLIFF unit cannot be imported as a translation: placeholders the source does not have or that the translation never renders, a segment state Equator does not accept, notes it does not store, a unit outside the authoritative source catalog or stale against it, or an attempt to change what the authoring catalog owns.

### EQ1804

A pseudo-localization request is invalid: a length factor outside its range, a message that does not parse, or a catalog that is not a source catalog.

### EQ1805

An authored change plan, an application-local extension registry, or a semantic refactor was refused: invalid or oversized input, an invalid or duplicate operation, an undeclared or nonportable option, or a refactor whose source is unavailable and whose destination already exists.

### EQ1806

The host is outside Equator's supported range: Node.js, TypeScript, or the Angular compiler.
