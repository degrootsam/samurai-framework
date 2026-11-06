import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

/** The two instruction files together may not be larger than this (bytes) */
export const MAX_INSTRUCTIONS_BYTES = 32 * 1024;

/** The shared agent file first, the more specific SAMURAI one last: it wins where they disagree */
const FILES = ["AGENTS.md", path.join(".samurai", "agent.md")];

export interface Instructions {
  /** The files that were read, relative to the project folder */
  files: string[];
  /** Their text as it goes into the prompt; empty without files */
  text: string;
}

function readInside(root: string, name: string): string | undefined {
  const file = path.join(root, name);
  try {
    lstatSync(file);
  } catch {
    return undefined;
  }
  const real = realpathSync(file);
  const relative = path.relative(root, real);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error(
      `agent(): ${name} points outside the project folder, so it is not read`,
    );
  return readFileSync(real, "utf8");
}

/**
 * Reads `AGENTS.md` and `.samurai/agent.md` from the project folder (both are optional). A file that is a link
 * to somewhere outside the folder is an error, never read. Together they may hold at most 32 KB.
 */
export function loadInstructions(projectDir: string): Instructions {
  const root = realpathSync(projectDir);
  const parts: { name: string; text: string }[] = [];
  for (const name of FILES) {
    const text = readInside(root, name);
    if (text !== undefined) parts.push({ name, text });
  }
  const bytes = parts.reduce((sum, p) => sum + Buffer.byteLength(p.text), 0);
  if (bytes > MAX_INSTRUCTIONS_BYTES)
    throw new Error(
      `agent(): the instruction files hold ${Math.ceil(bytes / 1024)} KB, over the ${MAX_INSTRUCTIONS_BYTES / 1024} KB limit (${parts
        .map(
          (p) => `${p.name} ${Math.ceil(Buffer.byteLength(p.text) / 1024)} KB`,
        )
        .join(", ")}); shorten them`,
    );
  return {
    files: parts.map((p) => p.name),
    text: parts
      .map((p) => `### From ${p.name.replace(/\\/g, "/")}\n\n${p.text.trim()}`)
      .join("\n\n"),
  };
}
