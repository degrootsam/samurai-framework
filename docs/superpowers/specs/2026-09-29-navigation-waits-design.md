# Navigation waits — design

Date: 2026-09-29
Status: implemented (see "Implementation notes")
Roadmap item: 6
Depends on: bidi-foundation, network-tracking

## Goal

Make navigation deterministic: pick when `navigateTo` resolves, fail with a real error when navigation fails, and expose load-state waiting for actions that trigger navigation (a click on a link).

```ts
await page.navigateTo("example.com");                              // wait: "complete" (default)
await page.navigateTo("example.com", { wait: "interactive" });
await page.navigateTo("example.com", { wait: "none" });
await page.locator("//a[@id='next']").click();
await page.waitForLoadState("domcontentloaded");                   // "load" | "domcontentloaded" | "networkidle"
await page.reload();
```

## Non-goals

- `waitForURL` and `waitForNavigation` (small follow-ups on the events added here).
- History traversal and `reload` details (page-api spec owns those commands; this spec only defines the shared wait semantics).

## API

```ts
navigateTo(url: string, options?: NavigateOptions): Promise<{ navigation: string | null; url: string }>;
interface NavigateOptions {
  wait?: "none" | "interactive" | "complete";   // default config navigation.waitUntil, else "complete"
  timeout?: number;                             // default config navigation.timeout, else 30000
  protocol?: "http" | "https";                  // existing third param, kept
}
waitForLoadState(state?: "load" | "domcontentloaded" | "networkidle", options?: { timeout?: number }): Promise<void>; // default "load"
```

The current positional signature `navigateTo(url, wait?, protocol?)` stays accepted for one release: a string second argument is treated as `wait`.

Config additions (`SamuraiTestConfig`):

```ts
navigation?: { timeout?: number /* 30000 */; waitUntil?: "none" | "interactive" | "complete" /* "complete" */ };
```

The navigation timeout is deliberately separate from `expect.timeout` (5000, for actions/assertions): page loads legitimately take longer.

## Behaviour

- `browsingContext.navigate { context, url, wait }` runs with the navigation timeout as its command timeout (foundation spec). The result `{ navigation, url }` is returned (`navigation` is null for same-document navigations).
- The `wait` value is passed to the browser, replacing the existing `if (!result)` check (which could never fire).
- Failure detection: on a `BiDiError` from `navigate` (DNS failure, connection refused, TLS error surface as `unknown error` with the net error in the message), throw `NavigationError { url, reason, code }`. `navigationFailed` / `navigationAborted` events matching the `navigation` id also reject a still-pending wait (covers `wait: "none"` followed by `waitForLoadState`).
- Timeout: throw `NavigationError` with `reason: "timeout after <t>ms"`. A best-effort `browsingContext.navigate` to the current URL is *not* attempted; the caller decides.
- Existing scheme handling (`about:blank`, `data:`, `localhost:3000`) is kept.
- `waitForLoadState(state)`:
  1. Read `document.readyState` via `callFunction` (already reached → resolve). Mapping: `load` ⇔ `complete`; `domcontentloaded` ⇔ `interactive` or `complete`.
  2. Otherwise `waitForEvent("browsingContext.load" | "browsingContext.domContentLoaded", context === page)`, listener registered *before* step 1 completes to avoid the read/event race.
  3. `networkidle` = `load` then `NetworkTracker.waitForIdle`.
- Navigation triggered by a click: `click()` does not wait for navigation itself; callers use `waitForLoadState`. (Auto-waiting for navigations after actions is out of scope.)

## Errors

`NavigationError extends Error { url: string; reason: string; code?: string }` with message `navigateTo(): <url> failed: <reason>`. The runner maps it to a normal test error.

## Testing

- Unit (stub connector): `wait` param forwarded, default resolved from config; `BiDiError` → `NavigationError`; `navigationFailed` rejects a pending wait for the matching navigation id only; timeout path; positional-argument compatibility; `waitForLoadState` already-reached (no event wait), not-yet-reached (event), event-before-read race (event registered first), `networkidle` composition.
- Browser (local `node:http` server): `complete` resolves after a delayed subresource, `interactive` before it, `none` immediately; connection-refused port yields `NavigationError`; slow server hits the navigation timeout; click on a link then `waitForLoadState("load")`.
- TDD: tests first.

## Implementation notes

- **Where:** `Page.navigateTo` / `Page.waitForLoadState`, `browser/navigation-error.ts` (`NavigationError`, `LoadStateTimeoutError`), config `navigation: { timeout, waitUntil }` in `types/config.d.ts`, `PageSettings` (`Pick<SamuraiTestConfig, "network" | "navigation">`). `navigateTo(url, wait?, protocol?)` still works; the second argument may be a string (the wait) or an options object.
- **Default wait is now `"complete"`** (was the browser default, `"none"`), from config `navigation.waitUntil` when set.
- **`NavigationError`** for every BiDi error from `browsingContext.navigate` (`code` = the BiDi code, or `"timeout"` with reason `timeout after <t>ms`). The BiDi command itself carries the navigation timeout.
- **`LoadStateTimeoutError extends WaitTimeoutError`**: `waitForLoadState("load") did not finish within <t>ms`. `waitForNetworkIdle`'s default timeout is now the navigation timeout too.
- **Progress per navigation (not in the draft).** A document that is still the old one reports `readyState === "complete"`, so `navigateTo(url, { wait: "none" })` followed by `waitForLoadState()` would have returned at once. For navigations that do not wait for the load, `Page` records which navigation ids reached DOMContentLoaded and load (`browsingContext.domContentLoaded`/`load`, subscribed from the first such navigation until `dispose()`, latest 20 ids kept). `waitForLoadState` trusts that record when it says the last `navigateTo` navigation is short of the state, and reads `document.readyState` otherwise. Failure events count when they belong to that navigation, or, when no navigation is known, `navigationFailed` in this page's context.
- **`waitForLoadState` after a click** cannot know a navigation is coming: if the click's navigation has not started yet, the old document counts as loaded. Wait for a sign of the navigation first (an element of the new page, the URL) and then for the load state; the browser test does this.
- **Firefox 153 facts** (browser tests): the `browsingContext.navigationAborted` event is unknown to it (`session.subscribe` answers `invalid argument`), so a wait subscribes to it only when the browser knows it and remembers per connection when it does not; `navigate` fails with `NS_ERROR_CONNECTION_REFUSED` even with `wait: "none"`; `wait: "none"` returns once the navigation has committed (response headers received), so a server that never answers blocks it until the navigation timeout.
- **`networkidle`** = load, then `NetworkTracker.waitForIdle` (idle time from config `network.idleTime`); the timeout applies to each of the two stages.
- `reload` is left to the page-api spec.
- **Test infra:** `autoReply` handlers may now answer `session.subscribe` (an Error with a `code` property answers with that BiDi code). A few timing assertions in `wait-until.test.ts` and `expect-locator.test.ts` got 5 ms of slack (`setTimeout` can fire a millisecond early).
- Tests: the "Page navigation" block in `browser/page.test.ts`, `browser/navigation.browser-test.ts` (port 9238; local server with a slow image, refused port, hanging route).
