# `script.addPreloadScript` — design

Date: 2026-09-29
Status: implemented (see "Implementation notes")
Roadmap item: 2
Depends on: bidi-foundation, script-call-function

## Goal

Run code before any page script in every new document, so (a) the framework installs its own helper library once per document instead of re-sending probe source every poll, and (b) users get `page.addInitScript`.

```ts
await page.addInitScript(() => { window.__testMode = true });   // page's own world
await page.addInitScript((flag) => { … }, { flag: 1 });
```

## Non-goals

- Exposing binding functions (`exposeFunction`); `script.message` channels are used internally only (logs spec).
- Removing scripts by handle from user code beyond the returned `dispose()`.

## Components

### `src/script/preload.ts` (new)

```ts
export interface PreloadHandle { readonly id: string; dispose(): Promise<void> }
export async function addPreload(
  connector: BiDiConnector,
  options: { source: string; contexts?: string[]; sandbox?: string; args?: ChannelValue[] },
): Promise<PreloadHandle>;
```

- Sends `script.addPreloadScript { functionDeclaration, contexts, sandbox, arguments }`; result `{ script }` is the id.
- Preload scripts only affect documents created **after** registration. `addPreload` therefore also runs the same function once in every already-loaded context in scope (`browsingContext.getTree`, via `callFunction` in the same sandbox), so registration order never matters.
- `dispose()` sends `script.removePreloadScript`; idempotent. Already-loaded documents keep the effect until they navigate; documented.

### Framework helper realm

- Name: sandbox `"samurai"`. A sandbox realm shares the DOM with the page but has its own JS globals, so page code cannot tamper with the helpers and helpers do not leak into `window`.
- `src/script/helpers.ts` exports a function declaration that installs `globalThis.__samurai = { probeElement, resolveXpath, … }` in the sandbox realm.
- `Page` registers it once at creation (`contexts: [rootContext]` includes its iframes automatically since preload scripts apply to child navigables of the listed top-level context).
- Locator `callFunction` calls pass `sandbox: "samurai"` and call `(…a) => globalThis.__samurai.probeElement(…a)`. If the helper is missing (registration lost), the wrapper reinstalls it once and retries; a second miss throws `ScriptError`.

### `page.addInitScript`

```ts
addInitScript(script: string | ((arg?: any) => void), arg?: unknown): Promise<PreloadHandle>;
```

- Runs in the page's main realm (no sandbox): it is meant to change what page scripts see.
- Function form is serialized like `callFunction` (same `__name(` guard). `arg` goes through `toLocalValue` as the function's first argument.
- All init scripts registered on a page dispose with it.

## Errors

| Situation | Error |
|---|---|
| Init script throws | Browser reports through `log.entryAdded` (javascript error); the logs spec surfaces it. Not a test failure by itself. |
| Registration fails (`invalid argument`) | `BiDiError` rethrown from `addInitScript` |
| Helper missing during a locator call | one reinstall + retry, then `ScriptError` |

## Testing

- Unit: payload shape (sandbox, contexts, arguments); the "also run in existing contexts" step calls `getTree` and one `callFunction` per context; `dispose` is idempotent; helper-missing retry path with a stub returning the missing-helper error once.
- Browser: an init script sets `window.__x = 1`, then after `navigateTo` a locator-independent `evaluate` reads it; a script registered *after* load still applies to the current document (via the immediate run) and to the next navigation; the helper realm is invisible: `typeof window.__samurai === "undefined"` from the main realm; `dispose()` stops the effect on the next navigation.
- TDD: tests first.

## Implementation notes

Deviations and details settled while implementing:

- **Lazy install.** `Page` is constructed synchronously (tests and `Browser` build pages without I/O), so the helpers are not registered at creation. `Locator` awaits `HelperRealm.ensureInstalled()` before every probe; the first call registers, later calls reuse the cached promise (a failed install is retried). The immediate run covers any document loaded before the first probe.
- **Missing helpers are detected with a marker, not error text.** The call wrapper is `(...args) => globalThis.__samurai ? probeElement(...args) : "samurai:helpers-missing"`. On the marker the locator calls `reinstall()` (runs the helpers again in the loaded documents, no new registration) and retries once; a second marker throws `ScriptError`.
- **Only `probeElement` is installed.** `resolveXpath` from the draft is not added: nothing calls it yet, and the other element reads keep resolving the xpath inline.
- **A `Locator` built by hand (no helper realm) still works:** it sends the probe source to the page realm on every poll, as before. `Page.locator()` always passes its realm.
- **Channels are not supported yet.** `addPreload` has no `args`; BiDi preload arguments can only be channels, and the logs spec will add them when it needs `script.message`.
- **`addInitScript` argument.** Preload scripts cannot take arguments, so the function is wrapped as `() => (<function>)(<JSON of arg>)`; `arg` must be JSON-serializable (`TypeError` otherwise, and for a `bigint` or a cycle). A string script is wrapped as `() => { <script> }` and takes no argument.
- **Errors while running in an already-loaded document.** For `addInitScript` a throwing script is logged (`warn`) and the registration stays; for the framework helpers it fails the install. If the immediate run throws, the fresh registration is removed again.
- **`page.dispose()`** (new) removes init scripts, the helper registration and the context tree; the page-api spec's `close()` should call it.
- **Verified in Firefox:** preload scripts with a `sandbox` create the sandbox realm before page scripts; init scripts also apply to iframes created later; the page cannot reach or overwrite `__samurai` (it lives only in the sandbox realm). Firefox prints `TypeError: WeakMap key null …` from its own `browsingContext.sys.mjs` on stderr when an iframe loads under a preload script; it is harmless and unrelated to our code.
- Tests: `script/{preload,helpers}.test.ts`, additions to `browser/page.test.ts` and `locator/locator-actions.test.ts`, `script/preload.browser-test.ts` (port 9234). The reply pumps in the fake-WebSocket tests are `unref`'d so a failing test can no longer hang the run.
