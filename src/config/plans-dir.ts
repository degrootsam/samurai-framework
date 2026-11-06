import path from "node:path";
import type { SamuraiTestConfig } from "../types/config.js";

/** Checks the `plansDir` key of a config: a folder inside the project. Throws an Error that names the key */
export function validatePlansDirConfig(config: SamuraiTestConfig): void {
  const dir = config.plansDir;
  if (dir === undefined) return;
  if (typeof dir !== "string" || dir.trim() === "")
    throw new Error(
      `plansDir must be a folder name relative to the project, got ${JSON.stringify(dir)}`,
    );
  if (path.isAbsolute(dir) || path.normalize(dir).split(path.sep)[0] === "..")
    throw new Error(
      `plansDir must be a folder inside the project, got "${dir}"`,
    );
}
