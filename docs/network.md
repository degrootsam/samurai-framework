# Network

The framework follows every request of a page from the moment it opens (config `network.track`, on by default). That powers waiting for traffic, mocking, and reading responses.

## Waiting for traffic

Start the wait **before** the action that causes it, or pass `trigger`, which runs once the wait is set up so nothing can be missed:

```ts
const response = await page.waitForResponse("**/api/users", {
  trigger: () => page.getByRole("button", { name: "Load" }).click(),
  timeout: 10_000,
});
expect(response.status).toBe(200);
const users = await response.json<{ id: number }[]>();

const request = await page.waitForRequest(
  (r) => r.method === "POST" && r.url.endsWith("/orders"),
);
```

`match` is a URL pattern or a function. Patterns: a string without `*` must equal the URL; `*` matches anything except `/`, `**` anything; a `RegExp` is tested on the URL. A function receives the request or response.

On timeout you get `RequestTimeoutError` / `ResponseTimeoutError` naming what you waited for.

### Events

```ts
page.on("request", (r) => console.log(r.method, r.url));
page.on("response", (r) => console.log(r.status, r.url));
page.on("requestfailed", (r) => console.log(r.url, r.errorText));
```

A request has `id`, `url`, `method`, `headers` (lower-cased names), `resourceType` (`document`, `script`, `image`, …), `navigation`, `redirectedFrom`. A response has `url`, `status`, `statusText`, `headers`, `fromCache`, `request`.

### Response bodies

```ts
const body = await response.body(); // Buffer
const text = await response.text();
const data = await response.json();
```

Browsers only keep a body when asked before the request starts. `page.on("response")` and `waitForResponse` ask for you. To read bodies of responses you didn't listen for, set config `network.collectBodies: true` (costs browser memory). Bodies over `network.maxBodySize` (10 MiB by default) are not kept; `body()` then throws `ResponseBodyUnavailableError` with the reason.

## Mocking, blocking and modifying

`page.route(pattern, handler)` holds matching requests until the handler answers with exactly one of `fulfill`, `continue`, `abort` or `fallback`. **Await the answer**: a handler that returns first lets the request continue.

```ts
// Mock an API
await page.route("**/api/users", (route) =>
  route.fulfill({ json: [{ id: 1, name: "Sam" }] }),
);

// Custom status, headers and body
await page.route("**/api/fail", (route) =>
  route.fulfill({ status: 503, headers: { "retry-after": "5" }, body: "busy" }),
);

// Block images
await page.route(/\.(png|jpg|gif)$/, (route) => route.abort());

// Change a request and let it through
await page.route("**/api/**", (route) =>
  route.continue({ headers: { ...route.request().headers, "x-test": "1" } }),
);

// Decide per request
await page.route("**/*", async (route) => {
  if (route.request().resourceType === "image") return route.abort();
  return route.fallback(); // pass to the next matching route, or let it continue
});
```

| Answer              | Does                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `fulfill(options)`  | Answers without touching the network. `status` (200), `headers`, `contentType`, `body` (string or Buffer) or `json` (not both)                         |
| `continue(options)` | Sends the request on, optionally changing `url`, `method`, `headers` (replaces all) or `postData`. Firefox applies a changed `url` to navigations only |
| `abort()`           | Fails the request                                                                                                                                      |
| `fallback()`        | Hands it to the next matching route; with none left, it continues                                                                                      |

Rules:

- Routes added later are asked first.
- Answering twice throws.
- A handler that doesn't answer within config `network.routeTimeout` (30 s) lets the request through.
- An error thrown in a handler fails that request and, in the runner, the test. `page.routeErrors()` lists them.
- `page.unroute(pattern, handler?)` removes routes for a pattern (only that handler when given); `page.unrouteAll()` removes everything.

## Cache

```ts
await page.setCacheDisabled(true); // every request goes to the server
```
