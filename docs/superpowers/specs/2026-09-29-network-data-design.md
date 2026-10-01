# Network data (cache control and response bodies) — design

Date: 2026-09-29
Status: implemented (see "Implementation notes")
Roadmap item: 10
Depends on: network-tracking

## Goal

Read response bodies and control the HTTP cache.

```ts
const response = await page.waitForResponse("**/api/users");
expect(response.status).toBe(200);
const users = await response.json();

await page.setCacheDisabled(true);       // network.setCacheBehavior { cacheBehavior: "bypass" }
```

## Non-goals

- Streaming bodies, request body capture beyond what `dataType: "request"` returns (added if Firefox supports it; otherwise out of scope).
- HAR export.
- Modifying responses (interception spec).

## API

```ts
page.waitForResponse(match: string | RegExp | ((r: Response) => boolean), options?: { timeout?: number }): Promise<Response>;
page.waitForRequest(match: …, options?): Promise<Request>;
page.setCacheDisabled(disabled: boolean): Promise<void>;

interface Response {
  url; status; statusText; headers; fromCache; request;      // from network-tracking spec
  body(): Promise<Buffer>;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
}
```

`match` strings/RegExps use the URL matching from the interception spec (shared `matchUrl` util in `src/network/url-match.ts`). `waitForResponse` uses `waitForEvent`-style registration: call it before triggering the request, or pass the trigger: `page.waitForResponse(match, { trigger: () => button.click() })` (registers first, runs the trigger, then awaits).

## Components

### Data collector — `src/network/data-collector.ts` (new)

- BiDi only retains bodies for requests that a **collector** was registered for *before* the request. `network.addDataCollector { dataTypes: ["response"], maxEncodedDataSize, contexts: [pageContext] }` returns a `collector` id.
- The collector is created lazily on the first use of `waitForResponse`, `response.body()`, `page.on("response")` body access, or explicitly by `page.collectResponseBodies()`. Bodies of requests that completed before that are unavailable: `response.body()` throws `ResponseBodyUnavailableError`.
- Trade-off (documented): always-on collection would retain every body in browser memory, so it is opt-in by first use, plus config `network.collectBodies: true` to start with the page.
- `maxEncodedDataSize` from config `network.maxBodySize` (default 10 MiB). Larger responses: `body()` throws `ResponseBodyUnavailableError("exceeds maxBodySize")`.
- `Response.body()`: waits for `responseCompleted` of that request if not yet seen, then `network.getData { dataType: "response", collector, request }` → `bytes` (`{ type: "string" | "base64", value }`) → `Buffer`. The Buffer is cached on the `Response` so repeated calls work. After a successful read: `network.disownData { dataType, collector, request }` to free browser memory (guarded; failures logged, not thrown).
- `dispose()`: `network.removeDataCollector`.
- Redirect responses have no body: `body()` throws `ResponseBodyUnavailableError("redirect response")`.

### Cache

`setCacheDisabled(true)` → `network.setCacheBehavior { cacheBehavior: "bypass", contexts: [pageContext] }`; `false` → `"default"`. Scoped to the page. If unsupported: `UnsupportedOperationError`.

## Errors

`ResponseBodyUnavailableError extends Error { url: string; reason: string }` with reasons: `collector not registered before the request`, `exceeds maxBodySize`, `redirect response`, `no data available`.

## Testing

- Unit (stub connector): lazy collector creation and payload; `getData` mapping for string/base64 bytes; caching of the buffer; `disownData` after read and failure tolerance; `redirect` and size errors; `waitForResponse` with `trigger` registers before running it; timeout error text; `setCacheDisabled` payload both ways; `dispose` removes the collector.
- Browser (local server): JSON endpoint body via `json()`; binary body round trip via `base64`; second `fetch` with `setCacheDisabled(true)` hits the server twice while default hits it once (server counts requests, cacheable headers set); a response completed before the collector exists rejects with the documented error.
- TDD: tests first.

## Implementation notes

- **Where:** `network/data-collector.ts` (`DataCollector`, `ResponseBodyUnavailableError`), `network/response.ts` (`Response`), `network/network-wait.ts` (`RequestTimeoutError`, `ResponseTimeoutError`, `toPredicate`), and on `Page`: `startBodyCollection`, `waitForResponse`, `waitForRequest`, `setCacheDisabled`. Config `network.collectBodies` (default false) and `network.maxBodySize` (default 10485760).
- **`page.on("response")` now hands out `Response` objects** (a superset of the tracker's plain response: `url`, `status`, `statusText`, `headers`, `fromCache`, `request`, plus `id`, `body()`, `text()`, `json()`). There is exactly one `Response` per network response however many listeners or `waitForResponse` calls see it, so a body is read from the browser once, kept, and released with `network.disownData`.
- **Collection starts on first use** (`page.on("response")`, `waitForResponse`, `startBodyCollection()`), or with the page when `collectBodies` is true. A response that completed before collection began cannot be read. `page.on("response")` starts collection asynchronously, so a response that arrives within the first few milliseconds after registering may still miss it; register listeners before triggering traffic.
- **Error reasons:** the browser answers `no such network data` for both "collector started after the request" and "larger than maxBodySize", and they cannot be told apart, so `ResponseBodyUnavailableError` says: `no body was collected: the collector started after the request, or the response is larger than maxBodySize`. A 3xx response with a `Location` header is a `redirect response` (checked locally, the browser is not asked; a 304 is asked for). `unavailable network data` maps to `the body is not available yet`. Other errors pass through.
- **`waitForResponse(match, { timeout, trigger })` / `waitForRequest`:** `match` is a URL pattern (same rules as `page.route`) or a function of the response/request. The wait listens first, then runs `trigger`; a trigger that throws rejects the wait with that error and leaves nothing listening. `timeout` defaults to the navigation timeout. The timeout error names what was awaited: `waitForResponse(): no response matching "**/api/users" within 5000ms` (`/regex/` and `the given function` likewise).
- **`setCacheDisabled(disabled)`** is `network.setCacheBehavior` with `bypass` / `default` for this page; an unsupported browser gives `UnsupportedOperationError`.
- **Firefox 153 facts** (probed, then browser-tested): `addDataCollector`, `getData` (text as `string`, binary as `base64`, readable repeatedly until disowned), `disownData`, `removeDataCollector` and `setCacheBehavior` all work; `getData` for `dataType: "request"` answers `no such network data` for a plain GET, so request bodies were left out; with the cache on, two fetches of a `max-age` resource hit the server once, with `bypass` twice.
- Tests: `network/data-collector.test.ts`, `network/response.test.ts`, the "Page network data" block in `browser/page.test.ts`, `network/network-data.browser-test.ts` (port 9243: JSON, text, binary, empty, document and redirect bodies, click trigger, size limit through a second `Page` view with a small `maxBodySize`, cache on/off against a request-counting server).
