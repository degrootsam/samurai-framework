import type { StorageState, StorageStateCookie } from "../types/use.js";
import type { CookieInput } from "./browser-context.js";

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
