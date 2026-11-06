const FENCE = "---";

/**
 * Splits the YAML front matter off a plan: a first line of `---` up to the next line of `---`. Nothing inside is
 * parsed (the app keeps its own metadata there, and any key is fine). A plan without it is returned as it is; an
 * opening fence with no closing one throws.
 */
export function splitFrontMatter(text: string): {
  front: string;
  body: string;
} {
  const lines = text.replace(/^﻿/, "").split("\n");
  if (lines[0]?.trimEnd() !== FENCE) return { front: "", body: text };
  const end = lines.findIndex((line, i) => i > 0 && line.trimEnd() === FENCE);
  if (end < 0)
    throw new Error(
      `the front matter block opened with "---" on the first line has no closing "---" line`,
    );
  return {
    front: `${lines.slice(0, end + 1).join("\n")}\n`,
    body: lines.slice(end + 1).join("\n"),
  };
}
