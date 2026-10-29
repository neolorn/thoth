import { readFileSync, readdirSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateXML } from 'xmllint-wasm';
import { afterEach, describe, expect, it } from 'vitest';

import {
  exchangeProject,
  type ExchangeDocument,
  type ExchangeProjectResult,
} from '../src/index.js';
import { runCli } from './cli-run.js';

/**
 * `thoth exchange`: a document per target locale holding every scope, and the way back.
 *
 * The project has two scopes and two target locales, and the French shell catalog was written by a
 * person, with comments and a block scalar, so an import that rebuilt it from the model would show.
 */

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function write(root: string, path: string, text: string): Promise<void> {
  const absolute = resolve(root, ...path.split('/'));
  await mkdir(resolve(absolute, '..'), { recursive: true });
  await writeFile(absolute, text, 'utf8');
}

function read(root: string, path: string): Promise<string> {
  return readFile(resolve(root, ...path.split('/')), 'utf8');
}

async function exists(root: string, path: string): Promise<boolean> {
  try {
    await stat(resolve(root, ...path.split('/')));
    return true;
  } catch {
    return false;
  }
}

const FRENCH_SHELL = `# Reviewed by the French team.
messages:
  # Window title. Keep it short.
  app-title: Échange
  greeting: |-
    Bonjour {$name}
`;

async function project(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'exchange-'));
  roots.push(root);
  await write(
    root,
    'package.json',
    `${JSON.stringify(
      {
        name: '@example/exchange',
        version: '0.0.0',
        private: true,
        type: 'module',
        imports: {
          '#i18n': './src/generated/i18n/index.ts',
          '#i18n/*': './src/generated/i18n/*.ts',
        },
      },
      null,
      2,
    )}\n`,
  );
  await write(
    root,
    'thoth.config.json',
    `${JSON.stringify(
      {
        schemaVersion: 1,
        sourceLocale: 'en-US',
        defaultLocale: 'en-US',
        locales: ['en-US', 'fr-FR', 'de-DE'],
      },
      null,
      2,
    )}\n`,
  );
  await write(
    root,
    'tsconfig.app.json',
    `${JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          target: 'ES2022',
          module: 'preserve',
          moduleResolution: 'bundler',
          resolvePackageJsonImports: true,
          skipLibCheck: true,
        },
        include: ['src/**/*.ts'],
      },
      null,
      2,
    )}\n`,
  );
  await write(root, 'src/app.ts', 'export const marker = 1;\n');
  await write(
    root,
    'i18n/shell/en-US.yaml',
    "messages:\n  app-title: Exchange\n  greeting: 'Hello {$name}'\n  farewell: Goodbye\n",
  );
  await write(
    root,
    'i18n/account/en-US.yaml',
    'messages:\n  sign-in: Sign in\n',
  );
  await write(root, 'i18n/shell/fr-FR.yaml', FRENCH_SHELL);
  return root;
}

/** What a translator does to one unit: give it a target and mark it translated. */
function translate(
  document: string,
  scope: string,
  unitId: string,
  targetXml: string,
): string {
  const fileStart = document.indexOf(`<file id="example:exchange:${scope}"`);
  const fileEnd = document.indexOf('</file>', fileStart);
  const unitStart = document.indexOf(`<unit id="${unitId}"`, fileStart);
  if (fileStart < 0 || unitStart < 0 || unitStart > fileEnd) {
    throw new Error(`No unit ${unitId} in ${scope}.`);
  }
  const unitEnd = document.indexOf('</unit>', unitStart);
  const unit = document
    .slice(unitStart, unitEnd)
    .replace(/<segment[^>]*>/u, '<segment state="translated">')
    .replace(/\s*<target xml:space="preserve">[\s\S]*?<\/target>/u, '')
    .replace(
      /(<source xml:space="preserve">[\s\S]*?<\/source>)/u,
      `$1\n        <target xml:space="preserve">${targetXml}</target>`,
    );
  return `${document.slice(0, unitStart)}${unit}${document.slice(unitEnd)}`;
}

const schemaDirectory = fileURLToPath(
  new URL('../../../standards/data/xliff-2.2-cs01-schemas/', import.meta.url),
);
const preload = readdirSync(schemaDirectory)
  .filter((name) => name.endsWith('.xsd'))
  .map((name) => ({
    fileName: name,
    contents: readFileSync(`${schemaDirectory}${name}`, 'utf8'),
  }));

async function schemaErrors(document: string): Promise<readonly string[]> {
  const result = await validateXML({
    xml: [{ fileName: 'export.xlf', contents: document }],
    schema: [
      {
        fileName: 'xliff_core_2.2.xsd',
        contents: readFileSync(`${schemaDirectory}xliff_core_2.2.xsd`, 'utf8'),
      },
    ],
    preload,
    // The core schema imports `xml.xsd` by absolute URL, and `--path .` lets libxml2 find the
    // preloaded copy instead.
    modifyArguments: (args) => ['--path', '.', ...args],
  });
  return result.errors.map((error) => error.message);
}

describe('thoth exchange export', () => {
  it('writes one schema-valid document per target locale, with a file per scope', async () => {
    const root = await project();
    const run = await runCli([
      'exchange',
      'export',
      '--locale',
      'fr-FR',
      '--locale',
      'de-DE',
      '--project',
      root,
      '--json',
    ]);
    expect(run.stderr).toBe('');
    expect(run.exitCode).toBe(0);
    const result = JSON.parse(run.stdout) as {
      status: string;
      result: { files: string[]; documents: unknown[] };
    };
    expect(result.status).toBe('success');
    expect(result.result.files).toEqual(['xliff/de-DE.xlf', 'xliff/fr-FR.xlf']);
    expect(result.result.documents).toEqual([
      { locale: 'de-DE', path: 'xliff/de-DE.xlf', scopes: 2, units: 4 },
      { locale: 'fr-FR', path: 'xliff/fr-FR.xlf', scopes: 2, units: 4 },
    ]);

    const french = await read(root, 'xliff/fr-FR.xlf');
    const german = await read(root, 'xliff/de-DE.xlf');
    expect(french).toContain('srcLang="en-US" trgLang="fr-FR"');
    expect(german).toContain('srcLang="en-US" trgLang="de-DE"');
    for (const document of [french, german]) {
      expect(
        [...document.matchAll(/<file id="([^"]+)"/gu)].map((match) => match[1]),
      ).toEqual(['example:exchange:account', 'example:exchange:shell']);
      expect(await schemaErrors(document)).toEqual([]);
    }
    expect(french).toContain('<target xml:space="preserve">Échange</target>');
    expect(german).not.toContain('<target');
  });

  it('covers every target locale where the invocation names none', async () => {
    const root = await project();

    const run = await runCli(['exchange', 'export', '--project', root]);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('xliff/de-DE.xlf, xliff/fr-FR.xlf');
  });

  it('writes nothing under --dry-run, and leaves an unchanged document alone', async () => {
    const root = await project();
    const preview = await runCli([
      'exchange',
      'export',
      '--locale',
      'fr-FR',
      '--project',
      root,
      '--dry-run',
    ]);
    expect(preview.exitCode).toBe(0);
    expect(preview.stdout).toBe(
      'Thoth exchange export would write: xliff/fr-FR.xlf.\n',
    );
    expect(await exists(root, 'xliff')).toBe(false);

    await runCli([
      'exchange',
      'export',
      '--locale',
      'fr-FR',
      '--project',
      root,
    ]);
    const again = await runCli([
      'exchange',
      'export',
      '--locale',
      'fr-FR',
      '--project',
      root,
    ]);
    expect(again.exitCode).toBe(0);
    expect(again.stdout).toBe(
      'Thoth exchange documents are already current.\n',
    );
  });

  it('refuses to replace a document holding a translation the catalogs do not have', async () => {
    const root = await project();
    await runCli([
      'exchange',
      'export',
      '--locale',
      'fr-FR',
      '--project',
      root,
    ]);
    const returned = translate(
      await read(root, 'xliff/fr-FR.xlf'),
      'account',
      'sign-in',
      'Se connecter',
    );
    await write(root, 'xliff/fr-FR.xlf', returned);

    for (const extra of [[], ['--dry-run']]) {
      const run = await runCli([
        'exchange',
        'export',
        '--locale',
        'fr-FR',
        '--project',
        root,
        ...extra,
      ]);
      expect(run.exitCode).toBe(1);
      expect(run.stdout).toBe('');
      expect(run.stderr).toMatch(/^xliff\/fr-FR\.xlf:1:1: error TH1807: /mu);
      expect(run.stderr).toContain(
        'account sign-in: the document holds "Se connecter" and the catalog holds no translation',
      );
      expect(run.stderr).toContain(
        'Run thoth exchange import --locale fr-FR when the document holds returned translations, or delete it when the catalogs hold the newer text.',
      );
      expect(await read(root, 'xliff/fr-FR.xlf')).toBe(returned);
    }
  });

  it('refuses to replace a document whose translation was edited in the catalog after the export', async () => {
    const root = await project();
    await runCli([
      'exchange',
      'export',
      '--locale',
      'fr-FR',
      '--project',
      root,
    ]);
    const exported = await read(root, 'xliff/fr-FR.xlf');
    await write(
      root,
      'i18n/shell/fr-FR.yaml',
      FRENCH_SHELL.replace('app-title: Échange', 'app-title: Échange rapide'),
    );

    const run = await runCli([
      'exchange',
      'export',
      '--locale',
      'fr-FR',
      '--project',
      root,
    ]);
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('error TH1807');
    expect(run.stderr).toContain(
      'shell app-title: the document holds "Échange" and the catalog holds "Échange rapide"',
    );
    expect(await read(root, 'xliff/fr-FR.xlf')).toBe(exported);
  });

  it('replaces a document a tool wrote out again without changing a translation', async () => {
    const root = await project();
    await runCli([
      'exchange',
      'export',
      '--locale',
      'fr-FR',
      '--project',
      root,
    ]);
    const exported = await read(root, 'xliff/fr-FR.xlf');
    // Attributes in another order and a code written open and closed: the same target to XML.
    const rewritten = exported.replace(
      /<target xml:space="preserve">Bonjour <ph ([^ =]+="[^"]*") ([^ =]+="[^"]*")\/>/u,
      '<target xml:space="preserve">Bonjour <ph $2 $1></ph>',
    );
    expect(rewritten).not.toBe(exported);
    await write(root, 'xliff/fr-FR.xlf', rewritten);

    const run = await runCli([
      'exchange',
      'export',
      '--locale',
      'fr-FR',
      '--project',
      root,
    ]);
    expect(run.stderr).toBe('');
    expect(run.exitCode).toBe(0);
    expect(await read(root, 'xliff/fr-FR.xlf')).toBe(exported);
  });

  it('refuses to replace a document it cannot read', async () => {
    const root = await project();
    await write(root, 'xliff/fr-FR.xlf', 'Notes from the agency.\n');

    const run = await runCli([
      'exchange',
      'export',
      '--locale',
      'fr-FR',
      '--project',
      root,
    ]);
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('error TH1807');
    expect(run.stderr).toContain(
      'which it cannot read as a document for fr-FR',
    );
    expect(await read(root, 'xliff/fr-FR.xlf')).toBe(
      'Notes from the agency.\n',
    );
  });

  it('replaces a document once its translations are imported', async () => {
    const root = await project();
    await runCli([
      'exchange',
      'export',
      '--locale',
      'fr-FR',
      '--project',
      root,
    ]);
    await write(
      root,
      'xliff/fr-FR.xlf',
      translate(
        await read(root, 'xliff/fr-FR.xlf'),
        'account',
        'sign-in',
        'Se connecter',
      ),
    );
    const imported = await runCli([
      'exchange',
      'import',
      '--locale',
      'fr-FR',
      '--project',
      root,
    ]);
    expect(imported.exitCode).toBe(0);
    await write(
      root,
      'i18n/account/en-US.yaml',
      'messages:\n  sign-in: Sign in\n  sign-out: Sign out\n',
    );

    const run = await runCli([
      'exchange',
      'export',
      '--locale',
      'fr-FR',
      '--project',
      root,
    ]);
    expect(run.stderr).toBe('');
    expect(run.exitCode).toBe(0);
    const document = await read(root, 'xliff/fr-FR.xlf');
    expect(document).toContain('<unit id="sign-out"');
    expect(document).toContain(
      '<target xml:space="preserve">Se connecter</target>',
    );
  });

  it('keeps the documents out of catalog discovery', async () => {
    const root = await project();
    await runCli([
      'exchange',
      'export',
      '--locale',
      'fr-FR',
      '--project',
      root,
    ]);
    const format = await runCli(['format', '--project', root, '--dry-run']);
    expect(format.stderr).toBe('');
    expect(format.exitCode).toBe(0);
  });
});

describe('thoth exchange import', () => {
  it('writes accepted translations, keeping the comments and block scalars of the catalog', async () => {
    const root = await project();
    await runCli([
      'exchange',
      'export',
      '--locale',
      'fr-FR',
      '--project',
      root,
    ]);
    let document = await read(root, 'xliff/fr-FR.xlf');
    document = translate(document, 'account', 'sign-in', 'Se connecter');
    document = translate(document, 'shell', 'farewell', 'Au revoir');
    document = document.replace(
      '<target xml:space="preserve">Bonjour <ph',
      '<target xml:space="preserve">Salut <ph',
    );
    await write(root, 'xliff/fr-FR.xlf', document);

    const run = await runCli([
      'exchange',
      'import',
      '--locale',
      'fr-FR',
      '--project',
      root,
      '--json',
    ]);
    expect(run.exitCode).toBe(0);
    const result = JSON.parse(run.stdout) as {
      result: { files: string[]; documents: unknown[] };
    };
    expect(result.result.files).toEqual([
      'i18n/account/fr-FR.yaml',
      'i18n/shell/fr-FR.yaml',
    ]);
    expect(result.result.documents).toEqual([
      { locale: 'fr-FR', path: 'xliff/fr-FR.xlf', scopes: 2, units: 4 },
    ]);
    expect(await read(root, 'i18n/shell/fr-FR.yaml')).toBe(
      `# Reviewed by the French team.
messages:
  # Window title. Keep it short.
  app-title: Échange
  greeting: |-
    Salut {$name}
  farewell: Au revoir
`,
    );
    expect(await read(root, 'i18n/account/fr-FR.yaml')).toBe(
      'messages:\n  sign-in: "Se connecter"\n',
    );

    const again = await runCli([
      'exchange',
      'import',
      '--locale',
      'fr-FR',
      '--project',
      root,
    ]);
    expect(again.exitCode).toBe(0);
    expect(again.stdout).toBe('Thoth exchange import changed no catalog.\n');
  });

  it('reads a translation calling a function the project registers', async () => {
    const root = await project();
    await write(
      root,
      'thoth.extensions.json',
      `${JSON.stringify({
        profile: 'thoth-extension-registry/1',
        descriptors: [
          {
            kind: 'message-function',
            id: 'example:uppercase',
            operandType: 'string',
            resultType: 'string',
            selector: 'none',
            maximumOutputLength: 64,
          },
        ],
      })}\n`,
    );
    await write(
      root,
      'i18n/account/en-US.yaml',
      'messages:\n  sign-in: Sign in\n  shout: "{$name :example:uppercase}"\n',
    );
    await write(
      root,
      'i18n/account/fr-FR.yaml',
      'messages:\n  shout: "{$name :example:uppercase}"\n',
    );
    const exported = await runCli([
      'exchange',
      'export',
      '--locale',
      'fr-FR',
      '--project',
      root,
    ]);
    expect(exported.exitCode).toBe(0);

    const run = await runCli([
      'exchange',
      'import',
      '--locale',
      'fr-FR',
      '--project',
      root,
    ]);

    expect(run.stderr).toBe('');
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe('Thoth exchange import changed no catalog.\n');
  });

  it('leaves the old text of a unit it refuses, and still writes the units it accepts', async () => {
    const root = await project();
    await runCli([
      'exchange',
      'export',
      '--locale',
      'fr-FR',
      '--project',
      root,
    ]);
    let document = await read(root, 'xliff/fr-FR.xlf');
    document = translate(document, 'shell', 'farewell', 'Au revoir');
    // The placeholder is gone, which is the loss the inline codes exist to catch.
    document = translate(document, 'shell', 'greeting', 'Salut');
    await write(root, 'xliff/fr-FR.xlf', document);

    const run = await runCli([
      'exchange',
      'import',
      '--locale',
      'fr-FR',
      '--project',
      root,
    ]);
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toMatch(
      /^xliff\/fr-FR\.xlf:1:1: error TH1803: XLIFF target "greeting" is missing 1 placeholder/mu,
    );
    const shell = await read(root, 'i18n/shell/fr-FR.yaml');
    expect(shell).toContain('  greeting: |-\n    Bonjour {$name}\n');
    expect(shell).toContain('  farewell: Au revoir\n');
  });

  it('reports a stale unit and leaves its entry alone', async () => {
    const root = await project();
    await runCli([
      'exchange',
      'export',
      '--locale',
      'fr-FR',
      '--project',
      root,
    ]);
    const document = translate(
      await read(root, 'xliff/fr-FR.xlf'),
      'shell',
      'farewell',
      'Au revoir',
    );
    await write(root, 'xliff/fr-FR.xlf', document);
    await write(
      root,
      'i18n/shell/en-US.yaml',
      "messages:\n  app-title: Exchange\n  greeting: 'Hello {$name}'\n  farewell: Goodbye for now\n",
    );

    const run = await runCli([
      'exchange',
      'import',
      '--locale',
      'fr-FR',
      '--project',
      root,
    ]);
    expect(run.exitCode).toBe(0);
    expect(run.stderr).toContain('warning TH1803');
    expect(run.stderr).toContain('is stale for the current source revision');
    expect(await read(root, 'i18n/shell/fr-FR.yaml')).toBe(FRENCH_SHELL);
  });

  it('reports a locale whose document is not there', async () => {
    const root = await project();
    const run = await runCli([
      'exchange',
      'import',
      '--locale',
      'de-DE',
      '--project',
      root,
    ]);
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('error TH1802');
    expect(run.stderr).toContain('xliff/de-DE.xlf');
  });
});

describe('thoth exchange invocation', () => {
  it.each([
    [['exchange', '--locale', 'fr-FR'], 'export or import'],
    [['exchange', 'export', '--locale', 'en-US'], 'source locale'],
    [['exchange', 'export', '--locale', 'it-IT'], 'not one of the locales'],
  ])('refuses %j with exit code 2', async (arguments_, wording) => {
    const root = await project();
    const run = await runCli([...arguments_, '--project', root]);
    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain('TH1701');
    expect(run.stderr).toContain(wording);
  });

  it.each([['i18n'], ['src/generated/i18n'], ['.thoth']])(
    'refuses a --dir inside %s, which Thoth reads or owns',
    async (claimed) => {
      const root = await project();
      const run = await runCli([
        'exchange',
        'export',
        '--locale',
        'fr-FR',
        '--dir',
        resolve(root, claimed, 'xliff'),
        '--project',
        root,
      ]);
      expect(run.exitCode).toBe(2);
      expect(run.stderr).toContain('--dir must name a folder');
      expect(await exists(root, `${claimed}/xliff`)).toBe(false);
    },
  );

  it('writes the documents where --dir says, inside the owner', async () => {
    const root = await project();
    const run = await runCli([
      'exchange',
      'export',
      '--locale',
      'fr-FR',
      '--dir',
      resolve(root, 'translations'),
      '--project',
      root,
    ]);
    expect(run.exitCode).toBe(0);
    expect(await exists(root, 'translations/fr-FR.xlf')).toBe(true);
  });
});

describe('exchangeProject, called from a program', () => {
  /** What a document on disk says of itself, in the shape the result describes it. */
  async function onDisk(
    root: string,
    document: ExchangeDocument,
  ): Promise<ExchangeDocument> {
    const text = await read(root, document.path);
    return {
      locale: /trgLang="([^"]+)"/u.exec(text)?.[1] ?? '',
      path: document.path,
      scopes: [...text.matchAll(/<file id="/gu)].length,
      units: [...text.matchAll(/<unit id="/gu)].length,
    };
  }

  it('exports under a dry run, writing nothing, and then writes the documents it described', async () => {
    const root = await project();
    const expected: ExchangeProjectResult = {
      direction: 'export',
      changed: true,
      files: ['xliff/de-DE.xlf', 'xliff/fr-FR.xlf'],
      documents: [
        { locale: 'de-DE', path: 'xliff/de-DE.xlf', scopes: 2, units: 4 },
        { locale: 'fr-FR', path: 'xliff/fr-FR.xlf', scopes: 2, units: 4 },
      ],
    };

    const preview = await exchangeProject({
      project: root,
      direction: 'export',
      locales: ['fr-FR', 'de-DE'],
      dryRun: true,
    });
    expect(preview.ok && preview.value).toEqual(expected);
    expect(await exists(root, 'xliff')).toBe(false);

    const exported = await exchangeProject({
      project: root,
      direction: 'export',
      locales: ['fr-FR', 'de-DE'],
    });
    expect(exported.ok && exported.value).toEqual(expected);
    for (const document of expected.documents) {
      expect(await onDisk(root, document)).toEqual(document);
    }
  });

  it('imports under a dry run, writing nothing, and then writes the catalogs it named', async () => {
    const root = await project();
    const exported = await exchangeProject({
      project: root,
      direction: 'export',
      locales: ['fr-FR'],
    });
    expect(exported.ok).toBe(true);
    let document = await read(root, 'xliff/fr-FR.xlf');
    document = translate(document, 'account', 'sign-in', 'Se connecter');
    document = translate(document, 'shell', 'farewell', 'Au revoir');
    await write(root, 'xliff/fr-FR.xlf', document);
    const expected: ExchangeProjectResult = {
      direction: 'import',
      changed: true,
      files: ['i18n/account/fr-FR.yaml', 'i18n/shell/fr-FR.yaml'],
      documents: [
        { locale: 'fr-FR', path: 'xliff/fr-FR.xlf', scopes: 2, units: 4 },
      ],
    };

    const preview = await exchangeProject({
      project: root,
      direction: 'import',
      locales: ['fr-FR'],
      dryRun: true,
    });
    expect(preview.ok && preview.value).toEqual(expected);
    expect(await exists(root, 'i18n/account/fr-FR.yaml')).toBe(false);
    expect(await read(root, 'i18n/shell/fr-FR.yaml')).toBe(FRENCH_SHELL);

    const imported = await exchangeProject({
      project: root,
      direction: 'import',
      locales: ['fr-FR'],
    });
    expect(imported.ok && imported.value).toEqual(expected);
    expect(await onDisk(root, expected.documents[0]!)).toMatchObject({
      locale: 'fr-FR',
      path: 'xliff/fr-FR.xlf',
      scopes: 2,
    });
    expect(await read(root, 'i18n/account/fr-FR.yaml')).toBe(
      'messages:\n  sign-in: "Se connecter"\n',
    );
    expect(await read(root, 'i18n/shell/fr-FR.yaml')).toBe(
      `${FRENCH_SHELL}  farewell: Au revoir\n`,
    );
  });
});
