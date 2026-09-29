# Network tracking and real network idle — design

Date: 2026-09-29
Status: implemented (see "Implementation notes")
Roadmap item: 5
Depends on: bidi-foundation

## Goal

Replace `Page.waitForNetworkIdle` (today it only waits for the next `browsingContext.load` event, leaks its listener, and never resolves if `load` already fired) with a tracker built on `network.beforeRequestSent`, `network.responseCompleted` and `network.fetchError`. The same tracker later feeds interception and response data.

```ts
await page.navigateTo("example.com");
await page.waitForNetworkIdle();                       // no requests in flight for 500ms
await page.waitForNetworkIdle({ idleTime: 200, timeout: 10000 });
page.on("request", (r) => …); page.on("response", (r) => …); page.on("requestfailed", (r) => …);
```

## Non-goals

- Blocking or altering requests (interception spec), response bodies (network-data spec).
- Tracking requests of other tabs.
- WebSocket / SSE frames (BiDi has no events for them).

## Components

### `src/network/network-tracker.ts` (new)

```ts
class NetworkTracker {
  static async start(connector, tree: ContextTree, contextId: string, options?: TrackerOptions): Promise<NetworkTracker>;
  readonly inflight: number;
  waitForIdle(options: { idleTime: number; timeout: number }): Promise<void>;
  on(event: "request" | "response" | "requestfailed", listener): void;
  off(…): void;
  dispose(): Promise<void>;
}
interface TrackerOptions { ignore?: (request: NetworkRequest) => boolean }   // default: ignore none
```

- Subscribes (refcounted) to the three network events. Events are kept when `tree.isWithin(event.context, contextId)`.
- In-flight key: `${request.request}:${request.redirectCount}`. `beforeRequestSent` adds; `responseCompleted` and `fetchError` with the same key remove. A redirect is a new key, so a redirect chain counts as one live request at a time. Events with unknown keys (tracker started mid-request) are ignored on removal.
- Blocked requests (`isBlocked: true`, interception spec) stay in flight until resolved, so idle never fires while a route handler is pending.
- Never-completing requests (long-poll, SSE) would block idle forever: `ignore` lets callers exclude them, and `waitForIdle` also stops at its timeout.
- `waitForIdle`: resolves once `inflight === 0` has held for `idleTime` (a timer restarts on every new request). Checks the current state first, so it resolves immediately on an already-idle page (after `idleTime`). Rejects with `WaitTimeoutError` including the URLs still in flight (max 5) at the deadline.
- Started at `Page` creation, always on. Cost: three event listeners and a `Map`. Config `network.track: false` disables it; `waitForNetworkIdle` then throws `Error("network tracking is disabled")`.
- Must exist before the first navigation, otherwise requests started earlier are missed and idle can fire early; `Page` creation awaits `NetworkTracker.start`.

### `Page` changes

```ts
waitForNetworkIdle(options?: { idleTime?: number; timeout?: number }): Promise<void>; // 500ms / navigation timeout
on/off("request" | "response" | "requestfailed", …)
```

- `idleTime` default 500 (config `network.idleTime`), `timeout` default from navigation spec (30000).
- The old zero-argument call keeps working. The old behaviour (resolve on `load`) is gone; `navigateTo` with `wait: "complete"` covers it (navigation-waits spec).
- `Request` wrapper: `url`, `method`, `headers` (plain object, lower-cased names), `resourceType` (from `initiatorType`/`destination`), `navigation`, `redirectedFrom`. `Response`: `url`, `status`, `statusText`, `headers`, `fromCache`, `request`. Bodies are not included here.

## Errors

| Situation | Error |
|---|---|
| Idle not reached | `WaitTimeoutError` → message `waitForNetworkIdle(): still <n> request(s) in flight after <t>ms: <urls>` |
| Tracker disabled | `Error("network tracking is disabled")` |
| Page closed while waiting | rejects with `Error("page closed")` |

## Testing

- Unit (stub connector emitting scripted events): add/remove keys; redirect chain (same id, incrementing `redirectCount`) counts as one at a time; `fetchError` removes; event from an iframe context counted, from an unrelated context ignored; idle timer restarts on a new request; immediate idle on quiet page; timeout message lists URLs; `ignore` predicate; `dispose` unsubscribes and removes listeners; disabled config.
- Browser: local `node:http` server with `/slow` (300ms) and a redirect route; page fires three fetches on a timer; `waitForNetworkIdle` resolves after the last one plus `idleTime`, not before; a hanging route is reported on timeout.
- TDD: tests first.

## Implementation notes

- **Where it lives:** `src/network/network-tracker.ts` (`NetworkTracker`, `NetworkIdleTimeoutError`, `toHeaders`), `Page.waitForNetworkIdle/on/once/off/startNetworkTracking`, config `network: { track, idleTime }` (in `types/config.d.ts`), `PageSettings` (3rd `Page` constructor argument) to override config in tests.
- **Start:** the tracker is created lazily by `Page` (its constructor stays synchronous), and eagerly by `Browser.launch` and `Browser.newPage` through `page.startNetworkTracking()`, so requests made before the first navigation are seen. A `Page` built by hand starts tracking on first use and misses earlier requests.
- **`NetworkIdleTimeoutError extends WaitTimeoutError<string[]>`**: `last` holds up to five in-flight URLs and the message is the one from the spec.
- **`page.on/once/off`** are typed for `request` / `response` / `requestfailed` and start tracking on first use. Listener exceptions are logged, never break tracking.
- **Redirects:** a hop is linked to the previous one (`redirectedFrom`) using the `request id:redirect count` key. A redirect response keeps its request for the next hop; other responses and failures drop it.
- **`requestfailed`** payload is the request plus `errorText`.
- **Disabled tracking:** `waitForNetworkIdle()` rejects with `network tracking is disabled`; nothing is subscribed.
- **`dispose()`** rejects pending waits with `page closed`, removes listeners and unsubscribes; `Page.dispose()` disposes the tracker before the context tree it reads.
- **The old `waitForNetworkIdle`** (wait for the next `load`) is gone; `navigateTo(…, "complete")` covers that.
- **Test runner:** `npm run test:browser` now passes `--test-concurrency=1`. All browser tests launch Firefox with the same profile directory, and launching six at once made some fail to start.
- Tests: `network/network-tracker.test.ts`, the "Page network tracking" block in `browser/page.test.ts`, `network/network-tracker.browser-test.ts` (port 9237, local `node:http` server with slow, redirect, failing, hanging and iframe routes).
