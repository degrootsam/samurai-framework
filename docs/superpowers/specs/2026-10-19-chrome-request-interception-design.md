# Request interception differs from Firefox

Date: 2026-10-19
Status: implemented (Task 11)
Part of: [Chrome support](../chrome-support-todo.md), item 08

## Evidence

Chrome for Testing 155, headless, Linux, launched through chromedriver.

- `continue can replace the body of a request, also with a longer one` and `…with a shorter one too`: 30 s timeouts.
- `a request held by a handler keeps the network busy until it is answered`: `still 2 request(s) in flight after 10000ms`, both the same URL.
- `a handler that throws fails the request and is reported`: reported 3 times, expected 1.

Affects: router (4 tests; 16 pass).

## Result (Task 11)

One cause, and the other two failures followed from it. `network.continueRequest` with a new body and an explicit `content-length` header hangs the request on Chrome; sent without the header, Chrome sets the right length itself (`30` for the 30-byte test body). Firefox needs the header, because it keeps the old length and would cut the body off. The two hung `/echo` requests stayed in flight (hence "still 2 request(s) in flight", both the same URL) and their routes left errors behind (hence "3 reported, expected 1"). The assumed duplicate events do not exist.

Fix: `Route.continue({ postData })` does not send a `content-length` when the browser is Chrome (`connector.browserName`, set by `Browser.attach`; a unit test pins both ways). All 20 router tests pass on both browsers.

## Cause (original reading, mostly wrong)

- Chrome sends more events per request than Firefox: a held request counts twice and a failure is reported by several events.
- A replaced body with a stale `Content-Length` hangs the request; Firefox's mapper fixes the header, Chrome's may not.

## Proposal

- Count a request once per request id, not per event, and de-duplicate `fetchError` against the handler failure already reported.
- On `network.continueRequest` with a `body`, set or remove `Content-Length` ourselves.

## Done when

- The four tests pass on both browsers.
- In-flight counting is by request id, with a unit test that feeds duplicated events.
