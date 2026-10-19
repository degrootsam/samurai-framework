# Network idle and body collection

Date: 2026-10-19
Status: approved
Part of: [Chrome support](../chrome-support-todo.md), item 09

## Evidence

Chrome for Testing 155, headless, Linux, launched through chromedriver.

- `navigation requests are tracked from the start of the browser`: `still 1 request(s) in flight after 10000ms: …/hang`.
- `a body over maxBodySize is reported as unavailable, with the reason`: `ResponseBodyUnavailableError … no body was collected: the collector started after the request, or the response is larger than maxBodySize`.

Affects: network-tracker (1), network-data (1).

## Cause

- Neither failure's assertion was captured. First: the test releases a hung request and Chrome may not emit the closing event when the server drops the socket. Second: Chrome collects bodies differently (`network.addDataCollector` with a size limit), so the reason text or the moment it is thrown differs from what the test expects.

## Proposal

- Capture both failures. Then decide per case between fixing the framework (the release of a dropped request, the reason text) and making the test browser-aware.

## Done when

- Both tests pass or are Firefox-only with a stated reason.
- `waitForNetworkIdle` does not hang on a request the server dropped.
