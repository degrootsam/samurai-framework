import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NetworkRequest } from "./network-tracker.js";
import {
  installTrackerHooks,
  setup,
  start,
  done,
  fail,
} from "../testing/network-tracker-setup.js";

installTrackerHooks();

describe("NetworkTracker events", () => {
  it("emits request, response and requestfailed with plain wrappers", async () => {
    const { ws, tracker } = await setup();
    const seen: string[] = [];
    let request!: NetworkRequest;
    tracker.on("request", (r) => {
      request = r;
      seen.push(`request ${r.method} ${r.url}`);
    });
    tracker.on("response", (r) =>
      seen.push(`response ${r.status} ${r.request.url}`),
    );
    tracker.on("requestfailed", (r) => seen.push(`failed ${r.errorText}`));
    start(ws, "1");
    done(ws, "1", "top", {
      headers: [
        {
          name: "Content-Type",
          value: { type: "string", value: "text/plain" },
        },
      ],
    });
    start(ws, "2");
    fail(ws, "2");
    assert.deepEqual(seen, [
      "request GET https://example.test/1",
      "response 200 https://example.test/1",
      "request GET https://example.test/2",
      "failed NS_ERROR_NET_RESET",
    ]);
    assert.deepEqual(request.headers, { accept: "text/html" });
    assert.equal(request.resourceType, "script");
    assert.equal(request.redirectedFrom, null);
  });

  it("decodes base64 header values and joins repeated headers", async () => {
    const { ws, tracker } = await setup();
    let headers: Record<string, string> = {};
    tracker.on("response", (r) => (headers = r.headers));
    start(ws, "1");
    done(ws, "1", "top", {
      headers: [
        {
          name: "X-B64",
          value: {
            type: "base64",
            value: Buffer.from("héllo").toString("base64"),
          },
        },
        { name: "Set-Cookie", value: { type: "string", value: "a=1" } },
        { name: "set-cookie", value: { type: "string", value: "b=2" } },
      ],
    });
    assert.deepEqual(headers, { "x-b64": "héllo", "set-cookie": "a=1, b=2" });
  });

  it("links a redirect to the request it came from", async () => {
    const { ws, tracker } = await setup();
    const requests: NetworkRequest[] = [];
    tracker.on("request", (r) => requests.push(r));
    start(ws, "1", "top", {
      redirectCount: 0,
      url: "https://example.test/old",
    });
    done(ws, "1", "top", { redirectCount: 0, status: 301 });
    start(ws, "1", "top", {
      redirectCount: 1,
      url: "https://example.test/new",
    });
    assert.equal(requests[1]!.redirectedFrom, requests[0]);
    assert.equal(requests[0]!.redirectedFrom, null);
  });

  it("events of other pages are not emitted", async () => {
    const { ws, tracker } = await setup();
    let count = 0;
    tracker.on("request", () => count++);
    start(ws, "1", "other");
    assert.equal(count, 0);
  });

  it("a throwing listener does not break tracking or other listeners", async () => {
    const { ws, tracker } = await setup();
    let second = 0;
    tracker.on("request", () => {
      throw new Error("listener failed");
    });
    tracker.on("request", () => second++);
    start(ws, "1");
    assert.equal(second, 1);
    assert.equal(tracker.inflight, 1);
  });

  it("off removes a listener", async () => {
    const { ws, tracker } = await setup();
    let count = 0;
    const listener = () => count++;
    tracker.on("request", listener);
    tracker.off("request", listener);
    start(ws, "1");
    assert.equal(count, 0);
  });
});
