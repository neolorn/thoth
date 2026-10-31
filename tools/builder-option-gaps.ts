/**
 * The options an installed Angular builder has that the installed Thoth builder wrapping it lacks.
 *
 * The Angular CLI parses a command's options from the schema of the builder the target names, so an
 * option Thoth's schema lacks is refused on `ng build`, `ng serve` or `ng test` while it works
 * without Thoth. The schemas are generated from the releases the rows pin; this is the check on
 * each row that what the row installs is covered, run by `verify-package-consumer.ts` in every
 * Angular row and runnable on its own:
 *
 *   node tools/builder-option-gaps.ts <@angular/build directory> <@neolorn/thoth-toolkit directory>
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { WRAPPED } from './angular-build-rows.ts';

interface OptionSchema {
  readonly properties?: Readonly<Record<string, unknown>>;
}

const readJson = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(path, 'utf8')) as unknown;

/**
 * One line for each Thoth builder that lacks an option of the Angular builder it wraps, naming the
 * options; none when every option is covered.
 */
export async function builderOptionGaps(
  angularBuildRoot: string,
  toolkitRoot: string,
): Promise<readonly string[]> {
  const { version } = (await readJson(
    resolve(angularBuildRoot, 'package.json'),
  )) as { readonly version: string };
  const { builders } = (await readJson(
    resolve(toolkitRoot, 'builders.json'),
  )) as {
    readonly builders: Readonly<Record<string, { readonly schema: string }>>;
  };
  const gaps: string[] = [];
  for (const [command, builder] of Object.entries(WRAPPED)) {
    const entry = builders[command];
    if (entry === undefined) {
      gaps.push(`The toolkit declares no ${command} builder.`);
      continue;
    }
    const angular = (await readJson(
      resolve(angularBuildRoot, 'src/builders', builder, 'schema.json'),
    )) as OptionSchema;
    const thoth = (await readJson(
      resolve(toolkitRoot, entry.schema),
    )) as OptionSchema;
    const missing = Object.keys(angular.properties ?? {}).filter(
      (name) => !(name in (thoth.properties ?? {})),
    );
    if (missing.length > 0) {
      gaps.push(
        `@neolorn/thoth-toolkit:${command} lacks ${missing.join(', ')} from @angular/build:${builder} ${version}; run pnpm run generate:builder-options with this release in a row.`,
      );
    }
  }
  return gaps;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [angularBuildRoot, toolkitRoot] = process.argv.slice(2);
  if (angularBuildRoot === undefined || toolkitRoot === undefined) {
    throw new Error(
      'Usage: node tools/builder-option-gaps.ts <@angular/build directory> <@neolorn/thoth-toolkit directory>',
    );
  }
  const gaps = await builderOptionGaps(
    resolve(angularBuildRoot),
    resolve(toolkitRoot),
  );
  if (gaps.length > 0) {
    console.error(gaps.join('\n'));
    process.exit(1);
  }
  const wrapped = Object.values(WRAPPED).map(
    (builder) => `@angular/build:${builder}`,
  );
  console.log(
    `Every option of ${wrapped.join(', ')} in ${angularBuildRoot} is an option of the Thoth builder wrapping it.`,
  );
}
