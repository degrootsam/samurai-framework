import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { projectDir } from "../../config/config.js";
import { splitFrontMatter } from "./front-matter.js";
import { MAX_PLAN_BYTES, parsePlan } from "./plan-file.js";

/**
 * Reads a plan for `generate --plan`: the text goes to the agent as it is, without a front matter block. A missing file, a file over 32 KB and a
 * file without a `## Steps` heading are errors that name the file.
 */
export function readPlan(file: string): string {
  const full = path.resolve(projectDir(), file);
  let size: number;
  try {
    size = statSync(full).size;
  } catch {
    throw new Error(`readPlan(): ${full} cannot be read`);
  }
  if (size > MAX_PLAN_BYTES)
    throw new Error(
      `readPlan(): ${full} is ${Math.ceil(size / 1024)} KB, over the ${MAX_PLAN_BYTES / 1024} KB limit`,
    );
  const text = readFileSync(full, "utf8");
  try {
    parsePlan(text);
    return splitFrontMatter(text).body;
  } catch (error) {
    throw new Error(
      `readPlan(): ${full}: ${(error as Error).message.replace(/^parsePlan\(\): /, "")}`,
    );
  }
}
