# Network idle and body collection

Date: 2026-10-19
Status: implemented (Task 12)
Part of: [Chrome support](../chrome-support-todo.md), item 09

## Evidence

Chrome for Testing 155, headless, Linux, launched through chromedriver.

- `navigation requests are tracked from the start of the browser`: `still 1 request(s) in flight after 10000ms: …/hang`.
- `a body over maxBodySize is reported as unavailable, with the reason`: `ResponseBodyUnavailableError … no body was collected: the collector started after the request, or the response is larger than maxBodySize`.

Affects: network-tracker (1), network-data (1).

## Result (Task 12)

Two different causes, both confirmed by trace:

1. **Hung request after a navigation.** When a document is replaced, Firefox reports each of its unfinished requests as failed (`NS_BINDING_ABORTED`); Chrome says nothing, so the request counted as in flight for good and `waitForNetworkIdle` never settled. `NetworkTracker` now also listens for `browsingContext.navigationCommitted` and ends the in-flight requests of the replaced document (and its frames), except the navigation's own request, reporting them as `requestfailed` with the text `aborted by navigation`.
2. **`maxBodySize`.** Chrome compares the collector limit with the bytes it received, headers included (a 14-byte body counts as about 200), so a limit of 100 refused even small bodies. On Chrome the collector limit is raised by 64 KiB for headers, and the body is measured after it is read; a body over `maxBodySize` now fails with `the response is larger than maxBodySize (N bytes)` on both browsers.

Both tests pass on both browsers.

## Cause (original reading)

- Neither failure's assertion was captured. First: the test releases a hung request and Chrome may not emit the closing event when the server drops the socket. Second: Chrome collects bodies differently (`network.addDataCollector` with a size limit), so the reason text or the moment it is thrown differs from what the test expects.

## Proposal

- Capture both failures. Then decide per case between fixing the framework (the release of a dropped request, the reason text) and making the test browser-aware.

## Done when

- Both tests pass or are Firefox-only with a stated reason.
- `waitForNetworkIdle` does not hang on a request the server dropped.
