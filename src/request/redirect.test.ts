import assert from "node:assert/strict";
import { test } from "node:test";
import { followUp, redirectTarget } from "./redirect.js";

const from = new URL("http://x.test/a/b");

test("redirectTarget resolves Location against the URL and ignores other statuses", () => {
  assert.equal(redirectTarget(302, "/c", from)?.href, "http://x.test/c");
  assert.equal(redirectTarget(301, "d", from)?.href, "http://x.test/a/d");
  assert.equal(
    redirectTarget(307, "https://y.test/", from)?.href,
    "https://y.test/",
  );
  assert.equal(redirectTarget(200, "/c", from), undefined);
  assert.equal(redirectTarget(304, "/c", from), undefined);
  assert.equal(redirectTarget(302, undefined, from), undefined);
});

test("followUp turns POST into GET for 301, 302 and 303, and keeps method and body for 307 and 308", () => {
  const body = Buffer.from("x");
  for (const status of [301, 302, 303])
    assert.deepEqual(followUp(status, "POST", body), {
      method: "GET",
      body: undefined,
    });
  for (const status of [307, 308])
    assert.deepEqual(followUp(status, "POST", body), { method: "POST", body });
  assert.deepEqual(followUp(302, "PUT", body), { method: "PUT", body });
  assert.deepEqual(followUp(303, "PUT", body), {
    method: "GET",
    body: undefined,
  });
  assert.deepEqual(followUp(303, "HEAD", undefined), {
    method: "HEAD",
    body: undefined,
  });
});
