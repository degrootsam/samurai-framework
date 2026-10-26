/** Offset of the first character of the line `offset` is on */
export const lineStart = (source: string, offset: number) =>
  source.lastIndexOf("\n", offset - 1) + 1;

/** Offset just after the newline that ends the line `offset` is on, or the end of the source */
export function lineEnd(source: string, offset: number): number {
  const newline = source.indexOf("\n", offset);
  return newline === -1 ? source.length : newline + 1;
}

/** The spaces and tabs that start the line `offset` is on */
export const indentOf = (source: string, offset: number) =>
  /^[ \t]*/.exec(source.slice(lineStart(source, offset)))![0];

export function splice(
  source: string,
  from: number,
  to: number,
  text: string,
): string {
  return source.slice(0, from) + text + source.slice(to);
}
