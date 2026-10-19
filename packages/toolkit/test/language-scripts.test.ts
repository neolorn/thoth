import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

import { LANGUAGE_SCRIPTS } from '../src/language-scripts.generated.js';

/**
 * The toolkit's likely-script table against the pinned likely subtags it is drawn from.
 *
 * `specs/03-locale-identity-and-resolution.spec.md` section 4. The catalog chain sends a language
 * in a script it does not usually take to root, and a project configures locales in any
 * language, so the table holds every language the pinned data lists, each with the script its
 * likely subtags give.
 */

const require = createRequire(import.meta.url);
const likelySubtags = (
  JSON.parse(
    readFileSync(
      require.resolve('cldr-core/supplemental/likelySubtags.json'),
      'utf8',
    ),
  ) as { supplemental: { likelySubtags: Record<string, string> } }
).supplemental.likelySubtags;

describe('the language-script table of the toolkit', () => {
  it('holds every language of the pinned likely subtags with the script they give it', () => {
    const held = new Map(
      Object.entries(LANGUAGE_SCRIPTS).flatMap(([script, languages]) =>
        languages.split(' ').map((language) => [language, script] as const),
      ),
    );
    const pinned = Object.entries(likelySubtags)
      .filter(([key]) => !key.includes('-') && key !== 'und')
      .map(([language, likely]) => [language, likely.split('-')[1]] as const);
    expect(pinned.length).toBeGreaterThan(7_000);
    expect([...held].sort()).toEqual([...pinned].sort());
  });
});
