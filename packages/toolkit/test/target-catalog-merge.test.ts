import { describe, expect, it } from 'vitest';

import {
  mergeTargetCatalogSource,
  parseCatalog,
  type CatalogMessage,
} from '../src/catalog.js';

/**
 * What an import may change in a target catalog a person has edited.
 *
 * The translations it accepted, and nothing else: every comment, the key order, the block scalars
 * and the quoting of every other entry are the file's, and an entry the import did not accept keeps
 * the text it had.
 */

const options = {
  role: 'target' as const,
  providerId: '@example/merge',
  scopeId: 'shell',
  locale: 'fr-FR',
  sourcePath: 'i18n/shell/fr-FR.yaml',
};

function accepted(
  entries: Readonly<Record<string, string | Readonly<Record<string, unknown>>>>,
): Readonly<Record<string, CatalogMessage>> {
  const yaml = Object.entries(entries)
    .map(([id, entry]) =>
      typeof entry === 'string'
        ? `  ${id}: ${JSON.stringify(entry)}`
        : [
            `  ${id}:`,
            ...Object.entries(entry).map(
              ([field, value]) => `    ${field}: ${JSON.stringify(value)}`,
            ),
          ].join('\n'),
    )
    .join('\n');
  const parsed = parseCatalog(`messages:\n${yaml}\n`, options);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return parsed.value.messages;
}

function merge(
  source: string,
  entries: Readonly<Record<string, string | Readonly<Record<string, unknown>>>>,
): string {
  const result = mergeTargetCatalogSource(source, accepted(entries), options);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}

const AUTHORED = `# Reviewed by the French team.
messages:
  # The window title. Keep it short.
  app-title: Ancien titre
  body: |
    Première ligne
    Deuxième ligne
  quoted: 'Bonjour {$name}' # greets the reader
  untouched: "Laissez-moi"
`;

describe('mergeTargetCatalogSource', () => {
  it('changes the accepted entry and keeps every comment, block scalar and quote around it', () => {
    const merged = merge(AUTHORED, { 'app-title': 'Nouveau titre' });
    expect(merged).toBe(AUTHORED.replace('Ancien titre', 'Nouveau titre'));
  });

  it('keeps a block scalar a block scalar when its text is replaced', () => {
    const merged = merge(AUTHORED, { body: 'Ligne une\nLigne deux' });
    expect(merged).toContain('  body: |-\n    Ligne une\n    Ligne deux\n');
    expect(merged).toContain('# The window title. Keep it short.\n');
    expect(merged).toContain(
      "  quoted: 'Bonjour {$name}' # greets the reader\n",
    );
  });

  it('keeps the quoting and the trailing comment of a replaced quoted value', () => {
    const merged = merge(AUTHORED, { quoted: 'Salut {$name}' });
    expect(merged).toContain("  quoted: 'Salut {$name}' # greets the reader\n");
  });

  it('leaves the old text of an entry the import did not accept', () => {
    const merged = merge(AUTHORED, { 'app-title': 'Nouveau titre' });
    const reread = parseCatalog(merged, options);
    expect(reread.ok).toBe(true);
    if (!reread.ok) return;
    expect(reread.value.messages['untouched']).toMatchObject({
      kind: 'message',
      message: 'Laissez-moi',
    });
    expect(merged).toContain('  untouched: "Laissez-moi"\n');
  });

  it('appends an entry the file does not have, after the last one', () => {
    const merged = merge(AUTHORED, { 'new-entry': 'Nouveau' });
    expect(merged).toBe(`${AUTHORED}  new-entry: Nouveau\n`);
  });

  it('ends the last line first when the file does not', () => {
    const merged = merge('messages:\n  a: A', { b: 'B' });
    expect(merged).toBe('messages:\n  a: A\n  b: B\n');
  });

  it('turns a one-line entry into a mapping when the import brings guidance, keeping its comment', () => {
    const merged = merge(AUTHORED, {
      quoted: { message: 'Salut {$name}', context: 'Écran d’accueil' },
    });
    expect(merged).toContain(
      '  quoted: # greets the reader\n    message: Salut {$name}\n    context: Écran d’accueil\n',
    );
  });

  it('writes a deliberately empty translation in place of a message', () => {
    const merged = merge(AUTHORED, { 'app-title': { empty: true } });
    expect(merged).toContain(
      '  # The window title. Keep it short.\n  app-title:\n    empty: true\n',
    );
  });

  it('fills an empty entry and keeps the guidance written beside it', () => {
    const source =
      'messages:\n  pending:\n    empty: true\n    description: Pas encore traduit\n';
    const merged = merge(source, { pending: 'Traduit' });
    expect(merged).toBe(
      'messages:\n  pending:\n    message: Traduit\n    description: Pas encore traduit\n',
    );
  });

  it('keeps CRLF line endings in a file written with them', () => {
    const merged = merge('messages:\r\n  a: A\r\n', { a: 'Z', b: 'B' });
    expect(merged).toBe('messages:\r\n  a: Z\r\n  b: B\r\n');
  });

  it('returns the file unchanged when nothing accepted differs from it', () => {
    expect(merge(AUTHORED, { 'app-title': 'Ancien titre' })).toBe(AUTHORED);
  });
});
