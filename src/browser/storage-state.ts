import { readFileSync } from "node:fs";
import path from "node:path";
import { checkStorageStateObject } from "../config/use-options.js";
import type { StorageState, StorageStateCookie } from "../types/use.js";
import type { CookieInput } from "./browser-context.js";

/** The state itself, or the JSON file (relative to `baseDir`) that holds it. Throws `use(): what is wrong`. */
export function loadStorageState(
  source: string | StorageState,
  baseDir: string,
): StorageState {
  if (typeof source !== "string") return source;
  const file = path.resolve(baseDir, source);
  let state: unknown;
  try {
    state = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(
      `use(): storageState file ${JSON.stringify(source)} could not be read: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (typeof state !== "object" || state === null || Array.isArray(state))
    throw new Error(
      `use(): storageState file ${JSON.stringify(source)} must hold an object`,
    );
  checkStorageStateObject(state as Record<string, unknown>);
  return state as StorageState;
}

const SAME_SITE = { Strict: "strict", Lax: "lax", None: "none" } as const;

/** The state's cookies as `context.addCookies()` takes them; `expires` of -1 (or none) is a session cookie */
export function cookiesOf(state: StorageState): CookieInput[] {
  return (state.cookies ?? []).map((cookie: StorageStateCookie) => ({
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    ...(cookie.path !== undefined && { path: cookie.path }),
    ...(cookie.expires !== undefined &&
      cookie.expires > 0 && { expiry: cookie.expires }),
    ...(cookie.httpOnly !== undefined && { httpOnly: cookie.httpOnly }),
    ...(cookie.secure !== undefined && { secure: cookie.secure }),
    ...(cookie.sameSite !== undefined && {
      sameSite: SAME_SITE[cookie.sameSite],
    }),
  }));
}
