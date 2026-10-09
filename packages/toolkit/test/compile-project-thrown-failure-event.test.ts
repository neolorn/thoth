import { describe, expect, it } from 'vitest';

import {
  TOOLKIT_EVENT_CODES,
  compileProject,
  parseCatalog,
  type Catalog,
  type CompileProjectRequest,
  type ToolkitObservabilityEvent,
} from '../src/index.js';
import { testProjectConfiguration } from './fixtures.js';

/**
 * What a sink hears when a compilation throws.
 *
 * A compilation answers with diagnostics, and a sink that heard it start hears it succeed or fail.
 * A request that cannot be read is not a compilation with diagnostics: reading it throws, and the
 * throw is the caller's to see as it is. The sink still hears the end of what it heard start, so a
 * log never holds a compilation that began and did nothing, and the error reaches the caller
 * unchanged.
 */

function catalog(): Catalog {
  const parsed = parseCatalog('messages:\n  app-title: Probe\n', {
    role: 'source',
    providerId: '@example/app',
    scopeId: 'shell',
    locale: 'en-US',
    sourcePath: 'i18n/shell/en-US.yaml',
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return parsed.value;
}

const OWNER = {
  providerId: '@example/app',
  generatedRootPath: 'src/generated/i18n',
};

describe('a compilation that throws while a sink is listening', () => {
  it('compiles the same request when its catalogs can be read', () => {
    const events: ToolkitObservabilityEvent[] = [];
    const compiled = compileProject({
      owner: OWNER,
      configuration: testProjectConfiguration(['en-US']),
      catalogs: [catalog()],
      observability: { emit: (event) => void events.push(event) },
    });

    expect(compiled.ok).toBe(true);
    expect(events.map(({ status }) => status)).toEqual([
      'started',
      'succeeded',
    ]);
  });

  it('reports the failure in the compilation phase and throws what was thrown', () => {
    const events: ToolkitObservabilityEvent[] = [];
    const unreadable = new Error('the catalogs under test cannot be read');
    const request = {
      owner: OWNER,
      configuration: testProjectConfiguration(['en-US']),
      get catalogs(): readonly Catalog[] {
        throw unreadable;
      },
      observability: {
        emit: (event: ToolkitObservabilityEvent) => void events.push(event),
      },
    } satisfies CompileProjectRequest;

    let thrown: unknown;
    try {
      compileProject(request);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(unreadable);
    expect(
      events.map(({ code, phase, status, diagnosticCode }) => ({
        code,
        phase,
        status,
        diagnosticCode,
      })),
    ).toEqual([
      {
        code: TOOLKIT_EVENT_CODES.compilation,
        phase: 'compilation',
        status: 'started',
        diagnosticCode: undefined,
      },
      {
        code: TOOLKIT_EVENT_CODES.compilation,
        phase: 'compilation',
        status: 'failed',
        diagnosticCode: undefined,
      },
    ]);
  });
});
