import { afterEach, test } from "node:test";
import { inspect } from "node:util";
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

class Wrapper {
  constructor(public v: string) {}
}

test("maskDeep masks inside class instances, toJSON objects and null-prototype objects", () => {
  registerSecret("TEST_CARD", "4242424242424242");
  const input = new Wrapper("4242424242424242");
  const out = maskDeep({ w: input, u: new URL("https://x.test/?c=4242424242424242") }) as unknown as {
    w: { v: string };
    u: string;
  };
  assert.deepEqual(out.w, { v: MASK });
  assert.equal(out.u, `https://x.test/?c=${MASK}`);
  assert.equal(input.v, "4242424242424242");

  const bare = Object.create(null) as Record<string, string>;
  bare.v = "4242424242424242";
  assert.deepEqual(maskDeep({ bare }), { bare: { v: MASK } });
  assert.equal(bare.v, "4242424242424242");
});

test("maskDeep masks an Error's name, message and stack", () => {
  registerSecret("TEST_CARD", "4242424242424242");
  const err = new Error("bad 4242424242424242");
  const out = maskDeep({ err }) as unknown as { err: { name: string; message: string; stack: string } };
  assert.equal(out.err.message, `bad ${MASK}`);
  assert.ok(!out.err.stack.includes("4242424242424242"));
  assert.equal(err.message, "bad 4242424242424242");
});

test("maskFormat masks class instances, URLs and errors in metadata", () => {
  registerSecret("TEST_CARD", "4242424242424242");
  const info = maskFormat().transform({
    level: "info",
    message: "m",
    meta: { w: new Wrapper("4242424242424242"), u: new URL("https://x.test/4242424242424242"), e: new Error("4242424242424242") },
  }) as unknown as { meta: unknown };
  assert.ok(!JSON.stringify(info.meta).includes("4242424242424242"));
  assert.ok(JSON.stringify(info.meta).includes(MASK));
});

test("circular structures do not throw and are masked elsewhere", () => {
  registerSecret("TEST_CARD", "4242424242424242");
  const circ: Record<string, unknown> = { card: "4242424242424242" };
  circ.self = circ;
  const out = maskDeep(circ) as { card: string; self: unknown };
  assert.equal(out.card, MASK);
  assert.equal(out.self, "[Circular]");
  const info = maskFormat().transform({ level: "info", message: "m", meta: { circ } }) as unknown as {
    meta: { circ: { card: string } };
  };
  assert.equal(info.meta.circ.card, MASK);
});

test("the same object twice (not circular) is masked both times", () => {
  registerSecret("TEST_CARD", "4242424242424242");
  const shared = { v: "4242424242424242" };
  assert.deepEqual(maskDeep({ a: shared, b: shared }), { a: { v: MASK }, b: { v: MASK } });
});

test("escaped and encoded copies of a secret are masked", () => {
  const secret = 'ab\\cd"ef gh';
  registerSecret("PW", secret);
  assert.equal(maskText(JSON.stringify(secret)), `"${MASK}"`);
  assert.equal(maskText(inspect(secret)), `'${MASK}'`);
  assert.equal(maskText(`q=${encodeURIComponent(secret)}`), `q=${MASK}`);
  assert.equal(maskText(secret), MASK);
});
