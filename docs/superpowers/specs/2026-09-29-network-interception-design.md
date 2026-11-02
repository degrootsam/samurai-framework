# Network interception — design

Date: 2026-09-29
Status: implemented (see "Implementation notes")
Roadmap item: 9
Depends on: bidi-foundation, network-tracking

## Goal

Mock, block and modify requests from tests.

```ts
await page.route("**/api/users", (route) =>
  route.fulfill({ status: 200, json: [{ id: 1 }] }));
await page.route(/\.(png|jpg)$/, (route) => route.abort());
await page.route("**/api/**", (route) =>
  route.continue({ headers: { ...route.request().headers, "x-test": "1" } }));
await page.unroute("**/api/users");
```

## Non-goals

- Modifying responses of real requests (`network.continueResponse`, phase `responseStarted`); a later addition.
- `route.fetch()` (BiDi has no way to perform a request and hand back the response); use `continue` or `fulfill`.
- HTTP auth (`authRequired` + `continueWithAuth`); planned follow-up `page.setHttpCredentials`.
- Service worker requests.

## API

```ts
page.route(url: string | RegExp, handler: (route: Route) => void | Promise<void>): Promise<void>;
page.unroute(url: string | RegExp, handler?): Promise<void>;
page.unrouteAll(): Promise<void>;

class Route {
  request(): Request;
  fulfill(o: { status?: number; headers?: Record<string,string>; contentType?: string; body?: string | Buffer; json?: unknown }): Promise<void>;
  continue(o?: { url?: string; method?: string; headers?: Record<string,string>; postData?: string | Buffer }): Promise<void>;
  abort(): Promise<void>;                    // BiDi failRequest has no error code
  fallback(): Promise<void>;                 // pass to the next matching route
}
```

URL matching: a string without `*` is an exact match; with `*`/`**` a glob (`*` = no `/`, `**` = anything); a `RegExp` tests the full URL.

## Components — `src/network/router.ts` (new)

- **One intercept per page**, not per route: on the first `page.route`, send `network.addIntercept { phases: ["beforeRequestSent"], contexts: [pageContext] }` (no `urlPatterns`); matching happens in Node. This avoids translating globs/RegExps to BiDi URL patterns and keeps ordering logic in one place. Unmatched blocked requests are released immediately with `continueRequest { request }`.
  - Optimisation: when every registered route is a plain exact string, pass `urlPatterns: [{ type: "string", pattern }]` so unrelated traffic is never blocked. Recomputed (remove + add intercept) when routes change.
- On `network.beforeRequestSent` with `isBlocked: true` for this page (`ContextTree`): find matching routes, newest first; create a `Route`; call the handler. `fallback()` moves to the next match; when none remain (or none matched) the request continues unchanged.
- Resolution mapping:
  - `fulfill` → `network.provideResponse { request, statusCode, reasonPhrase, headers, body }`. `json` sets body `JSON.stringify` and content type `application/json`; `Buffer` body is `{ type: "base64" }`, string is `{ type: "string" }`. `Content-Length` computed unless supplied. Default status 200.
  - `continue` → `network.continueRequest { request, url, method, headers, body }` (headers as `{ name, value: { type: "string", value } }`).
  - `abort` → `network.failRequest { request }`.
- **Every blocked request must be resolved exactly once.** Guarantees:
  - a second resolution call throws `Error("route already handled")`;
  - a handler that throws → the request is failed (`failRequest`) and the error is stored and rethrown to the test after the next `await` boundary via `page.routeErrors` surfaced in the runner (same channel as page errors);
  - a handler that returns without resolving → after the handler's promise settles the route auto-`continue`s and logs a warn (safer than a hang);
  - `unroute*` and `dispose` resolve pending routes by continuing them, then `removeIntercept`.
  - a route pending longer than `network.routeTimeout` (default 30000) logs an error and is continued.
- Blocked requests count as in flight for `waitForNetworkIdle` (tracking spec).
- Requests from other contexts are untouched: the intercept is scoped with `contexts`.

## Errors

| Situation | Behaviour |
|---|---|
| Resolve twice | `Error("route already handled")` |
| Handler throws | request failed, error reported to the test |
| Browser rejects (`no such request`, request already finished) | `BiDiError` rethrown from the Route method |
| Redirect to a URL matching another route | the new hop is a new blocked request, routed independently |

## Testing

- Unit (stub connector): single intercept for multiple routes; exact-only optimisation and re-registration; glob and RegExp matching; newest-first ordering and `fallback`; each resolution's payload (fulfill json/Buffer/headers/default status, continue overrides, abort); unmatched blocked request continued; double resolve; throwing handler → `failRequest`; non-resolving handler → auto-continue + warning; `unroute` continues pending then removes the intercept; foreign-context request ignored.
- Browser (local server): fulfil an XHR with JSON and assert the page sees it; abort an image and see `onerror`; continue with an added header and echo it from the server; a redirect chain; a route that never resolves does not hang the page.
- TDD: tests first.

## Implementation notes

- **Where:** `network/url-match.ts` (`matchUrl`, `isExactString`, `samePattern`), `network/router.ts` (`Router`, `Route`), `Page.route/unroute/unrouteAll/routeErrors`, config `network.routeTimeout` (default 30000), and `RouteErrorsError` in `runner/page-logs-report.ts`. `network-tracker.ts` now exports `toRequest`.
- **One intercept per page, matching here**, as designed. The router listens to `network.beforeRequestSent` itself (not through the tracker, so it works when `network.track` is false) and only acts on requests held by one of its own intercept ids, in this page or its frames. Adding a route that widens what must be blocked adds the new intercept first and removes the old one after, so nothing slips through.
- **Exact-URL optimisation is conservative.** `urlPatterns` are sent only when every route is an exact string already in `new URL(x).href` form (so the browser reads it as we do); anything else blocks everything and matches in Node. If a browser rejects `urlPatterns` (`invalid argument`) the router falls back to blocking everything and remembers that per connection.
- **Every held request is answered exactly once:** a second answer throws `route already handled`; a handler that throws fails the request (`failRequest`) and the error is kept in `page.routeErrors()` (message `route handler for <url> threw: <message>`, cause attached); a handler that returns without answering lets the request continue with a `warn` (so a handler must `await` its answer; answering later from a callback is too late); a request pending longer than `routeTimeout` continues with an `error` log; `unroute*` and `dispose` continue the requests the removed routes still hold before the intercept goes; `fallback()` hands the request to the next older matching route, and past the last one it continues unchanged.
- **Runner:** route handler errors fail a passing test (`RouteErrorsError`, `<n> route handler error(s): …`), regardless of `logs.failOnPageError`; they take precedence over page errors, and a test that already failed keeps its own error.
- **`fulfill`:** status defaults to 200 with the standard reason phrase; `json` implies `application/json`; `content-type` and `content-length` (bytes) are added only when the headers you pass have none, compared case-insensitively; `json` together with `body` is a `TypeError`.
- **`continue`:** only what you pass is sent. A new `postData` always comes with a matching `content-length` (dropping the request's old one): otherwise Firefox keeps the old header and cuts the new body off (or waits for missing bytes). `headers` replaces all request headers, so spread `route.request().headers` to add one.
- **Firefox 153 facts** (browser tests): `fulfill`, `abort`, `fallback`, header changes, method changes and body replacement work for `fetch`, images and documents, iframes included; mocking a page's document by routing its URL works. **Changing the URL only works for navigations:** for `fetch`, XHR and images Firefox fails the request (`AbortError` / error event) although the rewritten request reaches the server, hence the note on `ContinueOptions.url`. A `fetch` from a page that is itself a JSON document (Firefox's JSON viewer) fails whatever the routes: use an HTML page in tests.
- Blocked requests stay in flight for `waitForNetworkIdle` (browser test: idle waits for a request a handler holds for 400 ms).
- **Not done:** `route.fetch()`, modifying real responses, HTTP auth; unchanged from the non-goals.
- Tests: `network/url-match.test.ts`, `network/router.test.ts` (38), "Page routing" block in `browser/page.test.ts`, route errors in `runner/page-logs-report.test.ts`, `network/router.browser-test.ts` (port 9241, local server, 20 tests).
