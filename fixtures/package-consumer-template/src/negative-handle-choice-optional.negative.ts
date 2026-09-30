import { type Localization } from '@neolorn/equator';
import { messages } from '#i18n/shell';

declare const localization: Localization;
declare const greeting: boolean;

/**
 * A handle chosen at runtime between a message taking nothing and one taking an input.
 *
 * Apart from `negative-handle-choice.negative.ts` because both files expect the same diagnostic,
 * and the verifier reads an expectation as met by any line of the output.
 */

const optionallyInputs = greeting ? messages.appTitle : messages.welcome;

// One message taking nothing does not make the other's input optional.
// EXPECT: Expected 2 arguments, but got 1
localization.text(optionallyInputs);
