import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { isShortSecret, MASK, maskDeep, maskFormat, maskText, registerSecret, resetSecrets } from "./mask.js";

afterEach(() => resetSecrets());

test("nothing registered leaves text alone", () => {
  assert.equal(maskText("card 4242"), "card 4242");
});

test("masks every occurrence of a long value", () => {
  registerSecret("TEST_CARD", "4242424242424242");
  assert.equal(maskText("fill 4242424242424242 then 4242424242424242x"), `fill ${MASK} then ${MASK}x`);
});

test("escapes regex characters", () => {
  registerSecret("PW", "p@ss.w*rd+(1)");
  assert.equal(maskText("pw=p@ss.w*rd+(1)!"), `pw=${MASK}!`);
  assert.equal(maskText("p@ssXw*rd+(1)"), "p@ssXw*rd+(1)");
});

test("masks the longest secret first", () => {
  registerSecret("SHORT", "secret");
  registerSecret("LONG", "secret-and-more");
  assert.equal(maskText("x secret-and-more y secret"), `x ${MASK} y ${MASK}`);
});

test("short values only match whole tokens", () => {
  registerSecret("PIN", "12");
  assert.equal(maskText("pin 12, step 12."), `pin ${MASK}, step ${MASK}.`);
  assert.equal(maskText("2012 and a12b"), "2012 and a12b");
  assert.equal(maskText("12"), MASK);
});

test("empty values are ignored", () => {
  registerSecret("EMPTY", "");
  assert.equal(maskText("anything"), "anything");
});

test("isShortSecret", () => {
  assert.equal(isShortSecret("abc"), true);
  assert.equal(isShortSecret("abcd"), false);
  assert.equal(isShortSecret(""), false);
});

test("maskDeep masks strings in nested objects and arrays and returns a copy", () => {
  registerSecret("TEST_CARD", "4242424242424242");
  const result = {
    message: "expected 4242424242424242",
    expected: "4242424242424242",
    duration: 12,
    logs: [{ text: "typed 4242424242424242", timestamp: 1 }],
  };
  const masked = maskDeep(result);
  assert.deepEqual(masked, {
    message: `expected ${MASK}`,
    expected: MASK,
    duration: 12,
    logs: [{ text: `typed ${MASK}`, timestamp: 1 }],
  });
  assert.equal(result.expected, "4242424242424242");
});

test("maskFormat masks the message and metadata of a log entry", () => {
  registerSecret("TEST_CARD", "4242424242424242");
  const info = maskFormat().transform({
    level: "info",
    message: "filled 4242424242424242",
    meta: { value: "4242424242424242" },
  }) as unknown as { message: string; meta: { value: string } };
  assert.equal(info.message, `filled ${MASK}`);
  assert.equal(info.meta.value, MASK);
});
