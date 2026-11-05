import path from "node:path";
import { projectDir } from "../config/config.js";
import { loadStorageState } from "../config/storage-state-file.js";
import type { StorageState } from "../types/use.js";
import {
  APIRequestContext,
  type RequestContextOptions,
} from "./api-request-context.js";
import { CookieJar } from "./cookie-jar.js";

/** Options of `request.newContext()` */
export interface NewRequestContextOptions extends RequestContextOptions {
  /** Cookies to start with: a JSON file (relative to the project folder) or the object itself. Local storage is not used. */
  storageState?: string | StorageState;
}

/** A request context with its own cookies: the same API as `page.request`, without a browser */
export function createRequestContext(
  options: NewRequestContextOptions = {},
): APIRequestContext {
  const { storageState, ...rest } = options;
  const state =
    storageState === undefined
      ? undefined
      : loadStorageState(
          storageState,
          path.resolve(projectDir()),
          "newContext()",
        );
  return new APIRequestContext(rest, new CookieJar(state?.cookies));
}

/**
 * Creates `APIRequestContext`s that belong to no page: `request.newContext({ baseURL })`. Inside a test, the
 * `request` fixture is one already.
 */
export const request = {
  newContext: (options?: NewRequestContextOptions) =>
    Promise.resolve(createRequestContext(options)),
};
