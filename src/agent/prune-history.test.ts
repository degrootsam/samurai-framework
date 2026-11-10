import { test } from "node:test";
import assert from "node:assert/strict";
import type { ModelMessage } from "ai";
import {
  pruneStalePages,
  STALE_SCREENSHOT_NOTE,
  STALE_SNAPSHOT_NOTE,
} from "./prune-history.js";

type Output = Record<string, unknown>;

function result(toolName: string, id: string, output: Output) {
  return { type: "tool-result" as const, toolCallId: id, toolName, output };
}

function toolMessage(...parts: ReturnType<typeof result>[]): ModelMessage {
  return { role: "tool", content: parts } as unknown as ModelMessage;
}

function snap(id: string, value: string) {
  return result("snapshot", id, { type: "text", value });
}

function shot(id: string) {
  return result("screenshot", id, {
    type: "content",
    value: [
      { type: "text", text: "shot" },
      { type: "file", data: "AAAA", mediaType: "image/png" },
    ],
  });
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function outputs(messages: ModelMessage[]): Output[] {
  return messages.flatMap((m) =>
    m.role === "tool"
      ? (m.content as { output: Output }[]).map((p) => p.output)
      : [],
  );
}

test("keeps the only snapshot", () => {
  const messages = [toolMessage(snap("1", "page A"))];
  assert.deepEqual(pruneStalePages(messages), messages);
});

test("replaces all but the latest snapshot", () => {
  const messages = [
    toolMessage(snap("1", "page A")),
    toolMessage(snap("2", "page B")),
    toolMessage(snap("3", "page C")),
  ];
  const out = pruneStalePages(messages);
  assert.deepEqual(
    outputs(out).map((o) => o.value),
    [STALE_SNAPSHOT_NOTE, STALE_SNAPSHOT_NOTE, "page C"],
  );
  const ids = out.flatMap((m) =>
    (m.content as { toolCallId: string }[]).map((p) => p.toolCallId),
  );
  assert.deepEqual(ids, ["1", "2", "3"]);
});

const opening = (): ModelMessage => ({
  role: "user",
  content: [
    { type: "text", text: "Goal: x" },
    { type: "text", text: "page 0" },
  ],
});

test("the opening page counts as the first snapshot", () => {
  const out = pruneStalePages([opening(), toolMessage(snap("1", "page A"))], {
    openingPage: true,
  });
  assert.deepEqual(out[0]?.content, [
    { type: "text", text: "Goal: x" },
    { type: "text", text: STALE_SNAPSHOT_NOTE },
  ]);
  assert.equal(outputs(out)[0]?.value, "page A");
});

test("the opening page is found after a leading system message", () => {
  const out = pruneStalePages(
    [
      { role: "system", content: "rules" },
      opening(),
      toolMessage(snap("1", "page A")),
    ],
    { openingPage: true },
  );
  assert.deepEqual(out[1]?.content, [
    { type: "text", text: "Goal: x" },
    { type: "text", text: STALE_SNAPSHOT_NOTE },
  ]);
  assert.deepEqual(out[0], { role: "system", content: "rules" });
});

test("without openingPage the first user message is left alone", () => {
  const messages = [opening(), toolMessage(snap("1", "page A"))];
  assert.deepEqual(pruneStalePages(messages), messages);
});

test("two snapshots in one step", () => {
  const out = pruneStalePages([
    toolMessage(snap("1", "page A"), snap("2", "page B")),
  ]);
  assert.deepEqual(
    outputs(out).map((o) => o.value),
    [STALE_SNAPSHOT_NOTE, "page B"],
  );
});

test("screenshots are a separate series", () => {
  const out = pruneStalePages([
    toolMessage(snap("1", "page A")),
    toolMessage(shot("2")),
    toolMessage(snap("3", "page B")),
    toolMessage(shot("4")),
  ]);
  const o = outputs(out);
  assert.deepEqual(o[0], { type: "text", value: STALE_SNAPSHOT_NOTE });
  assert.deepEqual(o[1], { type: "text", value: STALE_SCREENSHOT_NOTE });
  assert.deepEqual(o[2], { type: "text", value: "page B" });
  assert.equal(o[3]?.type, "content");
});

test("error results are not page items", () => {
  const error = result("snapshot", "2", { type: "error-text", value: "boom" });
  const messages = [toolMessage(snap("1", "page A")), toolMessage(error)];
  assert.deepEqual(pruneStalePages(messages), messages);
});

test("other tools are untouched", () => {
  const messages = [
    toolMessage(snap("0", "page A")),
    toolMessage(
      result("act", "1", { type: "text", value: "taken over\npage text" }),
    ),
    toolMessage(result("expect", "2", { type: "text", value: "ok" })),
    toolMessage(result("navigate", "3", { type: "text", value: "done" })),
    toolMessage(snap("4", "page B")),
  ];
  const out = pruneStalePages(messages);
  assert.deepEqual(out.slice(1, 4), messages.slice(1, 4));
});

test("idempotent", () => {
  const messages = [
    opening(),
    toolMessage(snap("1", "page A")),
    toolMessage(shot("2")),
    toolMessage(snap("3", "page B")),
    toolMessage(shot("4")),
  ];
  const once = pruneStalePages(messages, { openingPage: true });
  assert.deepEqual(pruneStalePages(once, { openingPage: true }), once);
});

test("does not mutate the input", () => {
  const messages = deepFreeze([
    opening(),
    toolMessage(snap("1", "page A")),
    toolMessage(snap("2", "page B")),
  ]);
  assert.doesNotThrow(() => pruneStalePages(messages, { openingPage: true }));
});

const thinking = (text = "hmm") => ({
  type: "reasoning" as const,
  text,
  providerOptions: { anthropic: { signature: "sig-abc" } },
});
const redacted = {
  type: "reasoning" as const,
  text: "",
  providerOptions: { anthropic: { redactedData: "opaque" } },
};
const call = (id: string) => ({
  type: "tool-call" as const,
  toolCallId: id,
  toolName: "snapshot",
  input: {},
});
const assistant = (...content: unknown[]): ModelMessage =>
  ({ role: "assistant", content }) as unknown as ModelMessage;
const types = (m: ModelMessage) =>
  (m.content as { type: string }[]).map((p) => p.type);

test("pruning strips reasoning and keeps text and tool calls", () => {
  const text = { type: "text" as const, text: "looking" };
  const messages = deepFreeze([
    assistant(thinking(), redacted, text, call("1")),
    toolMessage(snap("1", "page A")),
    assistant(thinking("again"), call("2")),
    toolMessage(snap("2", "page B")),
  ]);
  const out = pruneStalePages(messages);
  assert.deepEqual(out[0], assistant(text, call("1")));
  assert.deepEqual(out[2], assistant(call("2")));
  assert.equal(
    out.some((m) => types(m).includes("reasoning")),
    false,
  );
  assert.deepEqual(outputs(out)[0], {
    type: "text",
    value: STALE_SNAPSHOT_NOTE,
  });
});

test("without pruning the reasoning stays and messages are identical", () => {
  const messages = deepFreeze([
    assistant(thinking(), call("1")),
    toolMessage(snap("1", "page A")),
  ]);
  assert.deepEqual(pruneStalePages(messages), messages);
});

test("pruning with reasoning is idempotent", () => {
  const messages = [
    assistant(thinking(), call("1")),
    toolMessage(snap("1", "page A")),
    assistant(thinking(), call("2")),
    toolMessage(snap("2", "page B")),
  ];
  const once = pruneStalePages(messages);
  assert.deepEqual(pruneStalePages(once), once);
});

test("an assistant message left empty is dropped", () => {
  const messages = [
    assistant(thinking()),
    toolMessage(snap("1", "page A")),
    toolMessage(snap("2", "page B")),
  ];
  const out = pruneStalePages(messages);
  assert.equal(out.length, 2);
  assert.equal(
    out.some((m) => m.role === "assistant"),
    false,
  );
});
