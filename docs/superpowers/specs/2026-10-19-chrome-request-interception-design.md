# Request interception differs from Firefox

Date: 2026-10-19
Status: approved
Part of: [Chrome support](../chrome-support-todo.md), item 08

## Evidence

Chrome for Testing 155, headless, Linux, launched through chromedriver.

- `continue can replace the body of a request, also with a longer one` and `…with a shorter one too`: 30 s timeouts.
- `a request held by a handler keeps the network busy until it is answered`: `still 2 request(s) in flight after 10000ms`, both the same URL.
- `a handler that throws fails the request and is reported`: reported 3 times, expected 1.

Affects: router (4 tests; 16 pass).

## Cause

- Chrome sends more events per request than Firefox: a held request counts twice and a failure is reported by several events.
- A replaced body with a stale `Content-Length` hangs the request; Firefox's mapper fixes the header, Chrome's may not.

## Proposal

- Count a request once per request id, not per event, and de-duplicate `fetchError` against the handler failure already reported.
- On `network.continueRequest` with a `body`, set or remove `Content-Length` ourselves.

## Done when

- The four tests pass on both browsers.
- In-flight counting is by request id, with a unit test that feeds duplicated events.
