import { test } from "node:test";
import assert from "node:assert/strict";
import { modelRefusal } from "./refusal.js";

const call = (status: number, body: string, headers = {}) => ({
  message: "Forbidden",
  statusCode: status,
  responseBody: body,
  responseHeaders: headers,
});

test("a gateway answer with a code is read: status, code and retry-after", () => {
  assert.deepEqual(
    modelRefusal(
      call(429, '{"error":"Too many","code":"rate_limited"}', {
        "retry-after": "20",
      }),
    ),
    { status: 429, code: "rate_limited", retryAfter: 20 },
  );
  assert.deepEqual(
    modelRefusal(call(402, '{"error":"x","code":"plan_required"}')),
    { status: 402, code: "plan_required" },
  );
});

test("the last attempt of a retry error counts", () => {
  const retry = {
    message: "Failed after 3 attempts",
    lastError: call(429, '{"error":"x","code":"busy"}'),
  };
  assert.equal(modelRefusal(retry)?.code, "busy");
  assert.equal(
    modelRefusal({ cause: call(403, '{"code":"ai_off"}') })?.code,
    "ai_off",
  );
});

test("anything else is not a refusal", () => {
  assert.equal(modelRefusal(new Error("boom")), undefined);
  assert.equal(modelRefusal(call(500, "not json")), undefined);
  assert.equal(
    modelRefusal(call(401, '{"type":"error","error":{"message":"x"}}')),
    undefined,
  );
  assert.equal(modelRefusal(call(401, '{"code":7}')), undefined);
  assert.equal(modelRefusal(undefined), undefined);
});
