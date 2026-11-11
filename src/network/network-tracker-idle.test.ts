import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NetworkRequest } from "./network-tracker.js";
import { tick, type FakeWebSocket } from "../testing/fake-websocket.js";
import { WaitTimeoutError } from "../wait/wait-until.js";
import { NetworkIdleTimeoutError } from "./network-tracker.js";
import {
  installTrackerHooks,
  setup,
  start,
  done,
  fail,
} from "../testing/network-tracker-setup.js";

installTrackerHooks();

describe("NetworkTracker and Chrome's redirects", () => {
  const LOCATION = [
    { name: "Location", value: { type: "string", value: "/new" } },
  ];
  const chrome = () => setup(undefined, "chrome");
  const redirect = (ws: FakeWebSocket) => {
    start(ws, "1", "top", { url: "https://example.test/old" });
    done(ws, "1", "top", { status: 302, headers: LOCATION });
  };

  it("keeps a redirect in flight until the next hop is announced", async () => {
    const { ws, tracker } = await chrome();
    redirect(ws);
    assert.equal(tracker.inflight, 1, "Chrome has started the next hop");
    start(ws, "1", "top", { redirectCount: 1 });
    assert.equal(tracker.inflight, 1);
    done(ws, "1", "top", { redirectCount: 1 });
    assert.equal(tracker.inflight, 0);
  });

  it("announces a hop whose beforeRequestSent never came with its response, linked", async () => {
    const { ws, tracker } = await chrome();
    const seen: string[] = [];
    const requests: NetworkRequest[] = [];
    tracker.on("request", (r) => {
      requests.push(r);
      seen.push(`request ${r.url}`);
    });
    tracker.on("response", (r) => seen.push(`response ${r.status}`));
    redirect(ws);
    // chromium-bidi leaves out the next hop's beforeRequestSent when its extra info arrives first
    done(ws, "1", "top", { redirectCount: 1 });
    assert.deepEqual(seen, [
      "request https://example.test/old",
      "response 302",
      "request https://example.test/1",
      "response 200",
    ]);
    assert.equal(requests[1]!.redirectedFrom, requests[0]);
    assert.equal(tracker.inflight, 0);
  });

  it("ends the chain when the unannounced next hop fails (a fetch with redirect manual)", async () => {
    const { ws, tracker } = await chrome();
    const failed: string[] = [];
    tracker.on("requestfailed", (r) => failed.push(r.url));
    redirect(ws);
    fail(ws, "1", "top", { redirectCount: 1 });
    assert.deepEqual(failed, ["https://example.test/1"]);
    assert.equal(tracker.inflight, 0);
  });

  it("ends a 3xx without a location at once, it goes nowhere", async () => {
    const { ws, tracker } = await chrome();
    start(ws, "1");
    done(ws, "1", "top", { status: 304 });
    assert.equal(tracker.inflight, 0);
  });

  it("drops a waiting redirect without failing it when the document goes", async () => {
    const { ws, tracker } = await chrome();
    const failed: string[] = [];
    tracker.on("requestfailed", (r) => failed.push(r.url));
    redirect(ws);
    ws.emitEvent("browsingContext.navigationCommitted", {
      context: "top",
      navigation: "nav-2",
      timestamp: 0,
      url: "https://example.test/next",
    });
    assert.equal(tracker.inflight, 0);
    assert.deepEqual(failed, [], "its response arrived");
  });

  it("on Firefox a redirect response ends the hop: the next one is announced on its own", async () => {
    const { ws, tracker } = await setup();
    start(ws, "1");
    done(ws, "1", "top", { status: 302, headers: LOCATION });
    assert.equal(tracker.inflight, 0);
  });
});

describe("NetworkTracker.waitForIdle", () => {
  it("resolves after idleTime on a page that is already quiet", async () => {
    const { tracker } = await setup();
    const started = Date.now();
    await tracker.waitForIdle({ idleTime: 40, timeout: 1000 });
    assert.ok(Date.now() - started >= 35);
  });

  it("waits for requests in flight, then for idleTime after the last one", async () => {
    const { ws, tracker } = await setup();
    start(ws, "1");
    let resolved = false;
    const idle = tracker
      .waitForIdle({ idleTime: 60, timeout: 2000 })
      .then(() => (resolved = true));
    await tick(80);
    assert.equal(resolved, false, "a request is still in flight");
    done(ws, "1");
    const finished = Date.now();
    await tick(30);
    assert.equal(resolved, false, "idleTime has not passed yet");
    await idle;
    assert.ok(Date.now() - finished >= 55);
  });

  it("restarts the idle timer when a new request starts", async () => {
    const { ws, tracker } = await setup();
    let resolved = false;
    const idle = tracker
      .waitForIdle({ idleTime: 60, timeout: 2000 })
      .then(() => (resolved = true));
    await tick(40);
    start(ws, "1");
    await tick(60);
    assert.equal(resolved, false);
    done(ws, "1");
    await idle;
    assert.equal(resolved, true);
  });

  it("times out with the URLs still in flight", async () => {
    const { ws, tracker } = await setup();
    for (let i = 0; i < 7; i++) start(ws, `r${i}`);
    await assert.rejects(
      tracker.waitForIdle({ idleTime: 20, timeout: 60 }),
      (err: unknown) => {
        assert.ok(err instanceof NetworkIdleTimeoutError);
        assert.ok(err instanceof WaitTimeoutError);
        assert.equal(err.timeout, 60);
        assert.equal(err.last?.length, 5, "at most five URLs");
        assert.match(
          err.message,
          /waitForNetworkIdle\(\): still 7 request\(s\) in flight after 60ms: https:\/\/example\.test\/r0/,
        );
        return true;
      },
    );
  });

  it("stops listening after it resolves or times out", async () => {
    const { ws, tracker } = await setup();
    await tracker.waitForIdle({ idleTime: 10, timeout: 500 });
    start(ws, "1");
    done(ws, "1");
    assert.equal(tracker.waiting, 0);
  });

  it("rejects pending waits with page closed when disposed", async () => {
    const { ws, tracker } = await setup();
    start(ws, "1");
    const idle = tracker.waitForIdle({ idleTime: 20, timeout: 5000 });
    const rejection = assert.rejects(idle, /page closed/);
    await tracker.dispose();
    await rejection;
  });
});
