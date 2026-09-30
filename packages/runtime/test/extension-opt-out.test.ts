import { describe, expect, it } from 'vitest';

import type {
  MessageFunctionResult,
  RuntimeExtensionBinding,
  RuntimeMessageFunctionDescriptor,
} from '@neolorn/equator/core';
import { defineExtensionRegistry } from '../../toolkit/src/extensions.js';
import { defineRuntimeExtensions } from '../src/extensions.js';

/**
 * An extension carries no field it could use to step outside the rules.
 *
 * `specs/09-safe-content-and-ux.spec.md` section 15: an extension MUST NOT opt out of validation,
 * resource limits, request isolation, the content security policy, accessibility, or transaction
 * semantics, and a release MUST NOT provide a way to. The way it would be provided is a field: a
 * descriptor or a binding that admitted one more key than its kind declares would be a place for a
 * switch to live, whatever the runtime read from it today. So the shapes are closed, and a key the
 * kind does not declare is refused rather than ignored.
 */

const descriptor = (() => {
  const registry = defineExtensionRegistry([
    {
      kind: 'message-function',
      id: 'test:upper',
      operandType: 'string',
      resultType: 'string',
      selector: 'none',
      maximumOutputLength: 32,
    },
  ]);
  if (!registry.ok) throw new Error(JSON.stringify(registry.diagnostics));
  return registry.value
    .descriptors[0] as unknown as RuntimeMessageFunctionDescriptor;
})();

const evaluate = (): MessageFunctionResult => ({ text: 'X', value: 'X' });

describe('a runtime extension', () => {
  it('is admitted with exactly the fields its kind declares', () => {
    expect(defineRuntimeExtensions([{ descriptor, evaluate }])).toHaveLength(1);
  });

  it('is refused when its descriptor carries a field its kind does not declare', () => {
    for (const extra of [
      { unbounded: true },
      { maximumEvaluationSteps: Number.MAX_SAFE_INTEGER },
      { trusted: true },
    ]) {
      expect(() =>
        defineRuntimeExtensions([
          {
            descriptor: { ...descriptor, ...extra },
            evaluate,
          } as unknown as RuntimeExtensionBinding,
        ]),
      ).toThrow(/descriptor is invalid/u);
    }
  });

  it('is refused when its binding carries a field beside the handler', () => {
    expect(() =>
      defineRuntimeExtensions([
        {
          descriptor,
          evaluate,
          skipValidation: true,
        } as unknown as RuntimeExtensionBinding,
      ]),
    ).toThrow(/binding shape is invalid/u);
  });
});
