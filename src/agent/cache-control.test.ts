import { test } from "node:test";
import assert from "node:assert/strict";
import type { ModelMessage } from "ai";
import { isAnthropic, withCacheBreakpoint } from "./cache-control.js";

const msg = (text: string, providerOptions?: unknown): ModelMessage =>
  ({
    role: "user",
    content: text,
    ...(providerOptions === undefined ? {} : { providerOptions }),
  }) as unknown as ModelMessage;

const mark = (m: ModelMessage | undefined) =>
  (m?.providerOptions as { anthropic?: { cacheControl?: unknown } } | undefined)
    ?.anthropic?.cacheControl;

test("marks only the last message", () => {
  const out = withCacheBreakpoint([msg("a"), msg("b"), msg("c")]);
  assert.equal(mark(out[0]), undefined);
  assert.equal(mark(out[1]), undefined);
  assert.deepEqual(mark(out[2]), { type: "ephemeral" });
});

test("moves an old mark", () => {
  const old = { anthropic: { cacheControl: { type: "ephemeral" } } };
  const input = [msg("a", old), msg("b"), msg("c")];
  const out = withCacheBreakpoint(input);
  assert.equal(out[0]?.providerOptions, undefined);
  assert.deepEqual(mark(out[2]), { type: "ephemeral" });
  assert.deepEqual(mark(input[0]), { type: "ephemeral" });
});

test("keeps other provider options", () => {
  const out = withCacheBreakpoint([
    msg("a", {
      openai: { x: 1 },
      anthropic: { cacheControl: { type: "ephemeral" } },
    }),
    msg("b", { openai: { y: 2 } }),
  ]);
  assert.deepEqual(out[0]?.providerOptions, { openai: { x: 1 } });
  assert.deepEqual(out[1]?.providerOptions, {
    openai: { y: 2 },
    anthropic: { cacheControl: { type: "ephemeral" } },
  });
});

test("isAnthropic looks at the model's provider", () => {
  assert.equal(isAnthropic({ provider: "anthropic.messages" }), true);
  assert.equal(isAnthropic({ provider: "openai.chat" }), false);
  assert.equal(isAnthropic("anthropic:x"), false);
  assert.equal(isAnthropic(undefined), false);
});
