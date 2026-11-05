<!-- markdownlint-disable MD041 -->

An `APIRequestContext` sends HTTP requests from the test, without the browser rendering anything: log in through the API, set test data up, check a backend. It runs on Node's `http` and `https` and has no dependencies. There are three ways to get one:

| Where                                | Cookies                                                                                      |
| ------------------------------------ | -------------------------------------------------------------------------------------------- |
| `page.request` and `context.request` | The browser context's: the page and the requests share one session, in both directions       |
| the `request` fixture                | Its own, in memory, for the one test. Seeded from `use.storageState`                         |
| `await request.newContext(options)`  | Its own, in memory. Import `request` from the package; dispose it with `await api.dispose()` |

```ts
import { test, expect } from "@itmetsam/samurai-framework";

test("log in through the API, then use the page", async ({ page }) => {
  const login = await page.request.post("/api/login", {
    data: { user: "ada", password: "secret" },
  });
  expect(login.ok()).toBe(true);
  // The Set-Cookie of the response is in the browser context: the page is logged in
  await page.goto("/account");
});
```

## Methods

`get`, `post`, `put`, `patch`, `delete` and `head` take a URL and options. `fetch(urlOrRequest, options)` takes any `method` in its options, and an object with a `url` (such as a request the page made) instead of a string. They return an `APIResponse`.

A relative URL (`/api/users`, `users`) resolves against the `baseURL` of `request.newContext()`, else the run's `baseURL`; with neither the call throws `fetch(): "/api/users" needs a baseURL; ...`.

| Option              | What it does                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `headers`           | Added to the context's `extraHTTPHeaders`; a name in both takes the call's value. Names are case-insensitive                               |
| `params`            | Query parameters: an object, a `URLSearchParams` or a string. Added to the ones the URL has (an object's keys replace the same name)       |
| `data`              | A string or `Buffer` is sent as it is; anything else is sent as JSON (`content-type: application/json`)                                    |
| `form`              | An object or `URLSearchParams`, sent as `application/x-www-form-urlencoded`                                                                |
| `multipart`         | Fields and files: `{ title: "x", avatar: { name: "a.png", mimeType: "image/png", buffer } }`, sent as `multipart/form-data`                |
| `timeout`           | Milliseconds for the whole request, redirects included. Default 30000; 0 is no limit                                                       |
| `failOnStatusCode`  | Throw `fetch(): 404 Not Found (GET http://host/path)` for a status outside 200 to 299 instead of returning the response                    |
| `ignoreHTTPSErrors` | Accept a self-signed, expired or wrong-host certificate. Default: the context's setting                                                    |
| `maxRedirects`      | Redirects to follow, default 20. `0` returns the 3xx response itself; more redirects than allowed throw `fetch(): too many redirects, ...` |
| `maxRetries`        | Send the request again when the connection is reset before an answer. Default 0                                                            |

Only one of `data`, `form` and `multipart` may be set. A `content-type` header you set wins over the one the body implies.

Redirects are followed by hand: 303 (and 301 and 302 after a POST) become a GET without a body, 307 and 308 keep the method and the body. The `Authorization` header is dropped when a redirect leaves the origin. Every hop sends the cookies that match its URL and stores the cookies it sets, so a `Set-Cookie` on a redirect is not lost. gzip, deflate and Brotli bodies are decoded.

## The response

| Method                       | Returns                                                                                                                |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `status()`, `statusText()`   | `404`, `"Not Found"`                                                                                                   |
| `ok()`                       | `true` for 200 to 299                                                                                                  |
| `url()`                      | The URL answered: the last one when redirects were followed                                                            |
| `headers()`                  | An object with lower-case names; a repeated name is joined with a comma and a space (`set-cookie` with a new line)     |
| `headersArray()`             | `[{ name, value }]` as they arrived, each `Set-Cookie` an entry of its own                                             |
| `body()`, `text()`, `json()` | The decoded body as a `Buffer`, as text, parsed. `json()` throws `json(): the response body of <url> is not JSON: ...` |
| `dispose()`                  | Frees the body; reading it afterwards throws `response disposed`                                                       |

## Cookies

`page.request` and `context.request` read the context's cookies for each request (domain, path, `Secure`, expiry; `SameSite` is not applied, as the request is not made from another site) and put every `Set-Cookie` of the responses into the context, so `document.cookie`, `context.cookies()` and the next navigation see them. A cookie the site deletes (`Max-Age=0`, an `Expires` in the past) is removed from the context. A cookie the browser refuses is left out, as it would be for a page.

A standalone context (the fixture, `request.newContext()`) keeps the same rules on its own jar. `await api.storageState()` returns its cookies in the `storageState` format, so another context can start from them:

```ts
const api = await request.newContext({ baseURL: "https://shop.example" });
await api.post("/api/login", { form: { user: "ada", password: "secret" } });
const state = await api.storageState();
await api.dispose();
// later, in the same run: test.use({ storageState: state }), or request.newContext({ storageState: state })
```

## Options of a context

`request.newContext({ baseURL, extraHTTPHeaders, ignoreHTTPSErrors, storageState })`:

- `baseURL`: relative URLs resolve against it. Default: the run's `baseURL`.
- `extraHTTPHeaders`: sent with every request.
- `ignoreHTTPSErrors`: accept any certificate.
- `storageState`: a path (relative to the project folder) or the object; its cookies seed the jar.

`page.request`, `context.request` and the `request` fixture follow the run's [`use` options](Writing-tests#use-options): `extraHTTPHeaders` is sent, `acceptInsecureCerts` means `ignoreHTTPSErrors`, and `storageState` seeds the fixture's jar. A context made with `browser.newContext({ acceptInsecureCerts: true })` applies that to its `request` too.

## Errors and secrets

Errors read `fetch(): what is wrong`, for example `fetch(): ECONNREFUSED (GET http://localhost:3000/api)` or `fetch(): timed out after 100ms (GET ...)`. They name the method and the URL without credentials or query string, and never echo request headers (`Authorization`, `Cookie`), so a secret does not reach a report through them. A disposed context throws `request context disposed`; disposing aborts the requests in flight.

## Limits

- No HTTP proxy support.
- Requests do not appear in the page's [network events](Network) or the test report.
- `storageState()` has cookies only (no local storage).
