/** Replaces C0/DEL control characters without embedding them in a RegExp.
 * Common text whitespace can be preserved for diagnostics that are flattened
 * in a later step. */
export function replaceControlCharacters(
  value: string,
  replacement: string,
  preserveWhitespace = false,
): string {
  let output = ''
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0
    const commonWhitespace = code === 9 || code === 10 || code === 13
    const control = code === 127 || (code <= 31 && !(preserveWhitespace && commonWhitespace))
    output += control ? replacement : character
  }
  return output
}
