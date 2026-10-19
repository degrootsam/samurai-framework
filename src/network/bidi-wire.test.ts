import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  headersFromBidi,
  headersToBidi,
  toBytes,
  toRequest,
} from "./bidi-wire.js";

const text = (name: string, value: string) => ({
  name,
  value: { type: "string" as const, value },
});

describe("headers", () => {
  it("lower-case the names, join repeated ones and decode base64 values", () => {
    assert.deepEqual(
      headersFromBidi([
        text("Accept", "a"),
        text("accept", "b"),
        {
          name: "X-Raw",
          value: {
            type: "base64",
            value: Buffer.from("héllo").toString("base64"),
          },
        },
      ]),
      { accept: "a, b", "x-raw": "héllo" },
    );
  });

  it("go back as a list of text values", () => {
    assert.deepEqual(headersToBidi({ "x-a": "1", "x-b": "2" }), [
      text("x-a", "1"),
      text("x-b", "2"),
    ]);
  });
});

describe("toBytes", () => {
  it("sends text as is and bytes as base64", () => {
    assert.deepEqual(toBytes("héllo"), { type: "string", value: "héllo" });
    assert.deepEqual(toBytes(Buffer.from([1, 2, 255])), {
      type: "base64",
      value: "AQL/",
    });
  });
});

describe("toRequest", () => {
  const data = (extra: object = {}) =>
    ({
      request: "r1",
      url: "https://example.test/x",
      method: "GET",
      headers: [text("Accept", "*/*")],
      destination: "script",
      initiatorType: "script",
      ...extra,
    }) as never;

  it("maps the request, falling back from destination to initiator type to other", () => {
    const request = toRequest(data(), "nav", false, null);
    assert.deepEqual(request, {
      id: "r1",
      url: "https://example.test/x",
      method: "GET",
      headers: { accept: "*/*" },
      resourceType: "script",
      navigation: "nav",
      redirectedFrom: null,
      isBlocked: false,
    });
    assert.equal(
      toRequest(
        data({ destination: "", initiatorType: "fetch" }),
        null,
        false,
        null,
      ).resourceType,
      "fetch",
    );
    assert.equal(
      toRequest(
        data({ destination: "", initiatorType: null }),
        null,
        false,
        null,
      ).resourceType,
      "other",
    );
  });
});
