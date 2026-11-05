import { readFileSync } from "node:fs";
import path from "node:path";
import type { StorageState } from "../types/use.js";
import { checkStorageStateObject } from "./use-options.js";

/** The state itself, or the JSON file (relative to `baseDir`) that holds it. Throws `<who>: what is wrong` (`use()` unless told otherwise). */
export function loadStorageState(
  source: string | StorageState,
  baseDir: string,
  who = "use()",
): StorageState {
  if (typeof source !== "string") return source;
  const file = path.resolve(baseDir, source);
  let state: unknown;
  try {
    state = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(
      `${who}: storageState file ${JSON.stringify(source)} could not be read: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (typeof state !== "object" || state === null || Array.isArray(state))
    throw new Error(
      `${who}: storageState file ${JSON.stringify(source)} must hold an object`,
    );
  checkStorageStateObject(state as Record<string, unknown>);
  return state as StorageState;
}
