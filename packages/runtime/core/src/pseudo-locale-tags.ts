/**
 * The tags of the two pseudo-locales, and the regions that identify a pseudo-locale.
 *
 * The toolkit refuses a pseudo-locale tag without one of these regions, and the runtime refuses a
 * generated list that names a locale without one. Neither package can import from the other, so
 * this file is duplicated byte for byte and `packages/runtime/test/message-function-options.test.ts`
 * compares the copies. The toolkit exports the two constants; the runtime's copy stays internal.
 */

/**
 * The expanded pseudo-locale: Latin script, left-to-right, modelling a language longer than English.
 *
 * `XA` is a user-assigned ISO 3166-1 region code, permanently unassigned to any country, so it
 * cannot collide with a real locale now or later. It is also the established pseudo-locale
 * convention, Chrome and Android use `en-XA` for exactly this, so a developer who sees it in a
 * locale switcher recognises what it is.
 *
 * The script subtag is written out rather than left to be inferred, because the script is what
 * carries direction and pseudo-localization rests on direction being a property of the tag.
 * `en-XA` maximizes to `en-Latn-XA` and resolves the same way; stating `Latn` means the reader does
 * not have to know that.
 */
export const PSEUDO_LOCALE_EXPANDED = 'en-Latn-XA';

/**
 * The contracted pseudo-locale: Arabic script, right-to-left, modelling a language shorter than
 * English, which Arabic is, and which is the case that finds containers sized to English copy.
 *
 * **The base language is `en`, deliberately, and this is the part worth not changing.** A developer
 * reading their own screens must still be able to read them; the point is to see *their* layout
 * mirrored and their own physical CSS become visible. `ar-XB` would be an Arabic-language
 * pseudo-locale, which tests translation coverage instead and leaves the developer unable to
 * evaluate what they are looking at.
 *
 * `Arab` is in the generated `RTL_SCRIPTS` table, so this tag resolves `direction: 'rtl'` through
 * the lookup every locale uses. The runtime renders it as it renders any locale, and there is
 * nothing to exclude from a production build beyond not generating the catalog.
 *
 * **Why not `en-x-psexpand` and `en-Arab-x-pscontr`, which say what they are?** Because
 * `canonicalizeLocale` refuses any single-character subtag, and `x` is one, so a private-use
 * tag is rejected as a catalog identity. This is recorded here because the private-use form looks
 * correct from outside: it passes `Intl.getCanonicalLocales`, it survives `Intl.Locale.maximize()`,
 * and the runtime's direction lookup returns `rtl` for it. Three external authorities accept it and
 * the one validator that belongs to Equator does not.
 * `specs/03-locale-identity-and-resolution.spec.md` section 3 is the reason the validator is right:
 * a private-use subtag carries no application semantics, so admitting one into a catalog identity
 * would let two catalogs differ only in a part that no lookup reads.
 */
export const PSEUDO_LOCALE_CONTRACTED = 'en-Arab-XB';

/** The regions a pseudo-locale is identified by: the two the constants above carry. */
export const PSEUDO_LOCALE_REGIONS: readonly string[] = Object.freeze(
  [PSEUDO_LOCALE_EXPANDED, PSEUDO_LOCALE_CONTRACTED].map(
    (tag) => new Intl.Locale(tag).region ?? tag,
  ),
);
