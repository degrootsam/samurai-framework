/** Wraps text in an ANSI colour code when `color` is on, and leaves it as it is when not */
export function painter(
  color: boolean,
): (code: number, text: string) => string {
  return (code, text) => (color ? `\u001b[${code}m${text}\u001b[0m` : text);
}
