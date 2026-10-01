import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ResponseBodyUnavailableError } from "./data-collector.js";
import type { NetworkRequest, NetworkResponse } from "./network-tracker.js";
import { Response } from "./response.js";

const request: NetworkRequest = {
  id: "r1",
  url: "https://e.test/api",
  method: "GET",
  headers: {},
  resourceType: "fetch",
  navigation: null,
  redirectedFrom: null,
  isBlocked: false,
};
const data = (extra: Partial<NetworkResponse> = {}): NetworkResponse => ({
  url: "https://e.test/api",
  status: 200,
  statusText: "OK",
  headers: { "content-type": "application/json" },
  fromCache: false,
  request,
  ...extra,
});

function response(body: Buffer | Error, extra: Partial<NetworkResponse> = {}) {
  let loads = 0;
  const wrapped = new Response(data(extra), async () => {
    loads++;
    if (body instanceof Error) throw body;
    return body;
  });
  return { wrapped, loads: () => loads };
}

describe("Response", () => {
  it("carries what the network tracker knew", () => {
    const { wrapped } = response(Buffer.alloc(0));
    assert.equal(wrapped.id, "r1");
    assert.equal(wrapped.url, "https://e.test/api");
    assert.equal(wrapped.status, 200);
    assert.equal(wrapped.statusText, "OK");
    assert.deepEqual(wrapped.headers, { "content-type": "application/json" });
    assert.equal(wrapped.fromCache, false);
    assert.equal(wrapped.request, request);
  });

  it("body, text and json read the same bytes", async () => {
    const { wrapped } = response(Buffer.from('{"a":"héllo"}'));
    assert.deepEqual([...(await wrapped.body())], [...Buffer.from('{"a":"héllo"}')]);
    assert.equal(await wrapped.text(), '{"a":"héllo"}');
    assert.deepEqual(await wrapped.json(), { a: "héllo" });
  });

  it("loads the body once, however often or concurrently it is read", async () => {
    const { wrapped, loads } = response(Buffer.from("1"));
    await Promise.all([wrapped.body(), wrapped.text(), wrapped.json()]);
    await wrapped.body();
    assert.equal(loads(), 1);
  });

  it("json names the url when the body is not JSON", async () => {
    const { wrapped } = response(Buffer.from("<html>"));
    await assert.rejects(wrapped.json(), /Response body of https:\/\/e\.test\/api is not JSON: /);
  });

  it("a failed load can be tried again", async () => {
    let attempts = 0;
    const wrapped = new Response(data(), async () => {
      if (++attempts === 1) throw new Error("first fails");
      return Buffer.from("ok");
    });
    await assert.rejects(wrapped.body(), /first fails/);
    assert.equal(await wrapped.text(), "ok");
  });

  it("a redirect has no body, and the browser is not asked", async () => {
    const { wrapped, loads } = response(Buffer.from("x"), { status: 302, headers: { location: "/next" } });
    await assert.rejects(wrapped.body(), (err: unknown) => {
      assert.ok(err instanceof ResponseBodyUnavailableError);
      assert.equal(err.reason, "redirect response");
      return true;
    });
    assert.equal(loads(), 0);
  });

  it("a 3xx without Location (304 Not Modified) is asked for", async () => {
    const { wrapped, loads } = response(Buffer.from("cached"), { status: 304 });
    assert.equal(await wrapped.text(), "cached");
    assert.equal(loads(), 1);
  });
});
