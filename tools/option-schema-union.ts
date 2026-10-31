/**
 * The union of several releases' option schemas for one builder, as `generate-builder-options.ts`
 * writes it. A module of its own so the merge can be run on schemas made up to exercise it.
 */

/** A JSON Schema object. */
export type Schema = { readonly [key: string]: unknown };

export const isSchema = (value: unknown): value is Schema =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Keywords whose value is a map from names to schemas, not a schema. */
const SCHEMA_MAPS = new Set([
  'properties',
  'patternProperties',
  'definitions',
  '$defs',
]);
/** Keywords whose value is a schema or a list of schemas. */
const SCHEMA_VALUES = new Set([
  'items',
  'additionalItems',
  'additionalProperties',
  'contains',
  'not',
  'if',
  'then',
  'else',
  'oneOf',
  'anyOf',
  'allOf',
  'prefixItems',
]);

/**
 * A schema with every `default` keyword taken out, and with `description` too when `prose` is false.
 *
 * Only keywords are removed: a property that happens to be called `default` is a name in a
 * `properties` map and stays.
 */
function stripped(schema: unknown, prose: boolean): unknown {
  if (Array.isArray(schema)) return schema.map((item) => stripped(item, prose));
  if (!isSchema(schema)) return schema;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'default') continue;
    if (!prose && key === 'description') continue;
    if (SCHEMA_MAPS.has(key) && isSchema(value)) {
      result[key] = Object.fromEntries(
        Object.entries(value).map(([name, inner]) => [
          name,
          stripped(inner, prose),
        ]),
      );
    } else if (SCHEMA_VALUES.has(key)) {
      result[key] = stripped(value, prose);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * One option, or one definition, from the rows that have it, oldest first.
 *
 * The newest row's text is kept. Rows that define it in different shapes each keep theirs, as the
 * branches of an `anyOf`, so a value any row accepts is accepted.
 */
function united(variants: readonly Schema[]): unknown {
  const shapes = new Map<string, Schema>();
  for (const variant of variants) {
    shapes.set(JSON.stringify(stripped(variant, false)), variant);
  }
  const newest = variants.at(-1) as Schema;
  if (shapes.size === 1) return stripped(newest, true);
  return {
    ...(typeof newest['description'] === 'string'
      ? { description: newest['description'] }
      : {}),
    anyOf: [...shapes.values()].map((variant) => stripped(variant, true)),
  };
}

/** Every name the rows define under `keyword`, the newest row's order first, each united. */
export function unitedMap(
  schemas: readonly Schema[],
  keyword: 'properties' | 'definitions',
): Record<string, unknown> {
  const names: string[] = [];
  for (const schema of [...schemas].reverse()) {
    const map = schema[keyword];
    if (!isSchema(map)) continue;
    for (const name of Object.keys(map)) {
      if (!names.includes(name)) names.push(name);
    }
  }
  return Object.fromEntries(
    names.map((name) => [
      name,
      united(
        schemas
          .map((schema) => schema[keyword])
          .filter(isSchema)
          .map((map) => map[name])
          .filter(isSchema),
      ),
    ]),
  );
}
