import { describe, expect, it } from 'vitest';

import {
  catchallOtherCollisions,
  parseMessageSemanticModel,
} from '../src/message-format.js';

function variantsOf(lines: readonly string[]) {
  const parsed = parseMessageSemanticModel(lines.join('\n'));
  if (!parsed.ok || !('variants' in parsed.value)) {
    throw new Error('fixture is not a select message that parses');
  }
  return parsed.value.variants;
}

const head = ['.input {$a :string}', '.input {$b :string}', '.match $a $b'];

// A quoted key may hold a space, so two different tuples can read the same once their keys are
// run together.
describe('key tuples whose keys hold a space', () => {
  it('do not collide when the keys differ at each position', () => {
    expect(
      catchallOtherCollisions(
        variantsOf([
          ...head,
          '* |x y| {{1}}',
          '|other x| y {{2}}',
          '* * {{3}}',
        ]),
      ),
    ).toEqual([]);
  });

  it('still collide when the tuples are the same', () => {
    expect(
      catchallOtherCollisions(
        variantsOf([
          ...head,
          '* |x y| {{1}}',
          'other |x y| {{2}}',
          '* * {{3}}',
        ]),
      ),
    ).toEqual([[0, 1]]);
  });
});
