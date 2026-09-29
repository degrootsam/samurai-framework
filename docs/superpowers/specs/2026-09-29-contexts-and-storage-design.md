# User contexts and storage — design

Date: 2026-09-29
Status: implemented (see "Implementation notes")
Roadmap item: 12
Depends on: bidi-foundation

## Goal

Cheap isolated browser sessions (separate cookies, storage, cache) inside one browser process, and a cookie API that is scoped to them. Base for parallel tests and multi-user scenarios.

```ts
const alice = await browser.newContext();
const bob = await browser.newContext();
const pageA = await alice.newPage();
await alice.addCookies([{ name: "sid", value: "1", domain: "example.com" }]);
await bob.close();
```

## Non-goals

- Parallel test execution (only the primitive it needs; the runner currently launches one browser per test and keeps doing so).
- Persistent profiles per context, proxy per context (`createUserContext.proxy` is left out until needed).
- Cross-context storage copying.

## Components

### `BrowserContext` (rewrite of the test helper in `src/browser/browser-context.ts`)

The existing file holds only the test-only `setContent`; it moves to `src/testing/set-content.ts` (imports updated) and the file becomes the real class.

```ts
class BrowserContext {
  readonly id: string;                                   // BiDi userContext, "default" for the default one
  newPage(): Promise<Page>;                              // browsingContext.create { type: "tab", userContext }
  pages(): Page[];
  addCookies(cookies: Cookie[]): Promise<void>;          // storage.setCookie, partition { type: "context", userContext }
  cookies(filter?: { name?: string; domain?: string; path?: string }): Promise<Cookie[]>; // storage.getCookies
  clearCookies(filter?): Promise<void>;                  // storage.deleteCookies
  close(): Promise<void>;                                // browser.removeUserContext, closes its pages
}
```

`Browser` additions:

```ts
newContext(options?: { acceptInsecureCerts?: boolean; unhandledPromptBehavior?: … }): Promise<BrowserContext>; // browser.createUserContext
contexts(): BrowserContext[];                               // browser.getUserContexts
defaultContext: BrowserContext
```

- `Browser.newPage()` delegates to `defaultContext.newPage()` and returns a working `Page` (bug fix owned by the foundation spec).
- `Browser.getCookie` / `setCookie` (existing) are kept and delegate to `defaultContext` with the `partition` argument still accepted.
- Cookie value conversion: BiDi cookies carry `value: { type: "string" | "base64", value }`; the public `Cookie` uses plain strings (base64 only when `valueEncoding: "base64"`). `sameSite`, `httpOnly`, `secure`, `expiry` map 1:1. `domain` is mandatory in BiDi; `addCookies` throws `TypeError` when missing and no `url` was given (`url` is parsed for domain/path/secure).
- `BrowserContext.close()` removes the user context; the browser closes its tabs. `Page`s of that context reject further use with `Error("page closed")`.
- Context ids for `Page`: a `Page` remembers its `BrowserContext` so `page.context()` works and cookie helpers on `Page` (`page.context().addCookies`) are scoped correctly.
- Cleanup: `Browser.close()` closes all contexts first (best effort), then the browser.

### Storage partitions

`storage.*` commands take `partition`: `{ type: "context", context }` (by top-level context) or `{ type: "storageKey", userContext, sourceOrigin }`. `BrowserContext` cookies use `{ type: "storageKey", userContext }`; the returned `partitionKey` is ignored on read.

## Errors

| Situation | Error |
|---|---|
| Removing the default context | `Error("cannot close the default context")` |
| Cookie without domain/url | `TypeError` |
| `no such user context` | `BiDiError` (context already removed) |

## Testing

- Unit (stub connector): create/remove payloads; `newPage` passes `userContext`; cookie mapping both ways incl. base64 and `url` parsing; `close` order (pages, then remove); default-context guard; `Browser.getCookie/setCookie` still work.
- Browser: two contexts; a cookie set in one is invisible to the other (via `document.cookie` on a local server origin); `clearCookies` with filter; closing a context closes its pages; the old `newPage()` bug (empty context id) has a regression test navigating the returned page.
- TDD: tests first.

## Implementation notes

- **Where:** `browser/browser-context.ts` (`BrowserContext`, `Cookie`, `CookieInput`, `CookieFilter`), `Browser.newContext/contexts/defaultContext`, `Page.context()`. The old contents of that file (a test-only `setContent` copy nobody imported; tests use `testing/browser-fixture.ts`) were replaced, so nothing had to move.
- **`browser.newPage(options)` keeps its BiDi-shaped signature** and sends exactly what it is given (existing tests depend on that); it attaches the page to the context named by `userContext` (the default one when absent or `"default"`). `context.newPage()` calls it with `userContext` for a user context and without for the default one. The page `Browser.launch` returns belongs to the default context. `Browser.getCookie/setCookie` stay as raw partition-based calls.
- **`browser.contexts()` is sync and lists the default context plus the contexts this browser created** (not `browser.getUserContexts`): Firefox keeps user contexts in its profile, so that command also lists contexts left by earlier runs. A page opened with a `userContext` id this browser did not create adopts a context object for it.
- **Contexts are removed with the browser.** `Browser.close()` closes the contexts still open before it closes the browser (failures ignored), because otherwise every context a test forgets stays in the test profile. A browser test relaunches the browser after closing and checks none of the ids it created remain.
- **Cookies:** `addCookies` takes plain string values, a `domain` or a `url` (then domain, path and `secure` come from it unless given; `path` defaults to `/`), and checks every cookie before storing any. `cookies(filter?)` returns plain cookies (`value` a string, `expiry` only for persistent ones); `clearCookies(filter?)`. All use the partition `{ type: "storageKey", userContext }`, which for the default context is `"default"`. The local partition typing said `"storagekey"`; the browser only accepts `"storageKey"`.
- **Base64 cookie values were left out:** Firefox returns a base64 value as a Latin-1 string (`héllo` comes back as `hÃ©llo`), so a round trip would garble text; `cookies()` still decodes a `base64` value if a browser sends one.
- **`BrowserContext.close()`** removes the user context (the browser closes its tabs), then marks its pages closed (`Page.detach()`, which releases what they registered) and drops it from `browser.contexts()`. `no such user context` counts as closed; the default context cannot be closed (`cannot close the default context`); a second call does nothing; other errors leave it open. After closing, `newPage`, `addCookies`, `cookies` and `clearCookies` throw `context closed`.
- **Firefox 153 facts:** `createUserContext` (also `acceptInsecureCerts`), `getUserContexts`, `removeUserContext` (closes the tabs; the default context answers `invalid argument`), cookies isolated per user context (`document.cookie` in the other context is empty), `setCookie` without a partition writes to the default context; a new context inherits the session's `unhandledPromptBehavior`, so dialogs there are handled by the same page policy.
- **Not done:** per-context proxy, persistent profiles per context, cross-context storage copying (non-goals); `emulation` options on `newContext` come with the emulation spec.
- Tests: `browser/browser-context.test.ts` (24), `browser/browser-context.browser-test.ts` (port 9245; isolation, cookies through `document.cookie`, closing, dialog and viewport in a new context, leftovers checked after the browser closed with a second launch on port 9246).
