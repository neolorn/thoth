/**
 * How a diagnostic reads to a person, wherever Thoth prints one.
 *
 * The command line and the Angular builders both write diagnostics into output a developer reads,
 * and one diagnostic has to read the same in both, so the order and the line are decided here once.
 */

import type { ToolkitDiagnostic } from './diagnostics.js';

function diagnosticKey(diagnostic: ToolkitDiagnostic): string {
  return [
    diagnostic.span?.sourcePath ?? '',
    String(diagnostic.span?.start.offset ?? -1).padStart(12, '0'),
    diagnostic.code,
    diagnostic.severity,
    JSON.stringify(diagnostic.path),
    diagnostic.summary,
  ].join('\u0000');
}

export function orderedDiagnostics(
  diagnostics: readonly ToolkitDiagnostic[],
): readonly ToolkitDiagnostic[] {
  const unique = new Map<string, ToolkitDiagnostic>();
  for (const diagnostic of diagnostics) {
    unique.set(diagnosticKey(diagnostic), diagnostic);
  }
  return [...unique.values()].sort((left, right) => {
    const leftKey = diagnosticKey(left);
    const rightKey = diagnosticKey(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}

export function humanDiagnostic(diagnostic: ToolkitDiagnostic): string {
  const location =
    diagnostic.span?.sourcePath === undefined
      ? ''
      : `${diagnostic.span.sourcePath}:${diagnostic.span.start.line + 1}:${
          diagnostic.span.start.column + 1
        }: `;
  return `${location}${diagnostic.severity} ${diagnostic.code}: ${diagnostic.summary}\n`;
}
