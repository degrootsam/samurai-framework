import { test } from "node:test";
import assert from "node:assert/strict";
import type { ModelMessage } from "ai";
import { runLoop, type LoopInput } from "./loop.js";
import { STALE_SNAPSHOT_NOTE } from "./prune-history.js";

type Options = {
  prompt?: unknown;
  system?: unknown;
  messages: { role: string; content: { type: string; text: string }[] }[];
  prepareStep: (arg: { messages: ModelMessage[] }) => Promise<unknown>;
  onStepFinish: (step: Step) => void;
};

type Step = { usage: Record<string, unknown>; text: string };

function setup(gate: () => Promise<void> = async () => undefined) {
  const captured: { options?: Options } = {};
  const ai = {
    generateText: async (options: Options) => {
      captured.options = options;
      return { steps: [], text: "" };
    },
    isStepCount: () => () => false,
    hasToolCall: () => () => false,
  };
  const events: Record<string, unknown>[] = [];
  const tally = { modelCalls: 0, tokens: 0, finished: false };
  const input = (page?: string, model: unknown = {}): LoopInput =>
    ({
      ai,
      model,
      system: "sys",
      prompt: "Goal: x\n\n",
      ...(page === undefined ? {} : { page }),
      tools: {},
      controller: {
        signal: undefined,
        gate,
        emit: (e: Record<string, unknown>) => events.push(e),
      },
      limits: { maxSteps: 5, maxTokens: 100 },
      tally,
    }) as unknown as LoopInput;
  return { captured, input, events, tally };
}

const snapResult = (id: string, value: string): ModelMessage =>
  ({
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: id,
        toolName: "snapshot",
        output: { type: "text", value },
      },
    ],
  }) as unknown as ModelMessage;

test("the opening page is its own part", async () => {
  const { captured, input } = setup();
  await runLoop(input("page 0"));
  const options = captured.options!;
  assert.equal(options.prompt, undefined);
  assert.deepEqual(options.messages[0]?.content, [
    { type: "text", text: "Goal: x\n\n" },
    { type: "text", text: "page 0" },
  ]);
});

test("no page, one part", async () => {
  const { captured, input } = setup();
  await runLoop(input());
  assert.deepEqual(captured.options!.messages[0]?.content, [
    { type: "text", text: "Goal: x\n\n" },
  ]);
});

test("prepareStep returns pruned messages", async () => {
  const { captured, input } = setup();
  await runLoop(input());
  const out = (await captured.options!.prepareStep({
    messages: [snapResult("1", "A"), snapResult("2", "B")],
  })) as { messages: { content: { output: { value: string } }[] }[] };
  assert.equal(out.messages[0]?.content[0]?.output.value, STALE_SNAPSHOT_NOTE);
  assert.equal(out.messages[1]?.content[0]?.output.value, "B");
});

test("prepareStep still waits on the gate", async () => {
  let open!: () => void;
  const gate = () => new Promise<void>((resolve) => (open = resolve));
  const { captured, input } = setup(gate);
  await runLoop(input());
  let settled = false;
  const pending = captured.options!.prepareStep({ messages: [] }).then(() => {
    settled = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(settled, false);
  open();
  await pending;
  assert.equal(settled, true);
});

const lastMark = async (model: unknown) => {
  const { captured, input } = setup();
  await runLoop(input(undefined, model));
  const out = (await captured.options!.prepareStep({
    messages: [snapResult("1", "A"), snapResult("2", "B")],
  })) as { messages: { providerOptions?: unknown }[] };
  return out.messages[1]?.providerOptions;
};

test("anthropic models get a breakpoint", async () => {
  assert.deepEqual(await lastMark({ provider: "anthropic.messages" }), {
    anthropic: { cacheControl: { type: "ephemeral" } },
  });
});

test("other models get none", async () => {
  assert.equal(await lastMark({ provider: "openai.chat" }), undefined);
});

test("usage reports cached input", async () => {
  const { captured, input, events, tally } = setup();
  await runLoop(input());
  captured.options!.onStepFinish({
    text: "",
    usage: {
      inputTokens: 100,
      outputTokens: 10,
      totalTokens: 110,
      inputTokenDetails: { cacheReadTokens: 80 },
    },
  });
  assert.deepEqual(events[0], {
    type: "usage",
    inputTokens: 100,
    outputTokens: 10,
    totalTokens: 110,
    cachedInputTokens: 80,
  });
  assert.equal(tally.tokens, 110);
});

test("no cache field, no cachedInputTokens key", async () => {
  const { captured, input, events } = setup();
  await runLoop(input());
  captured.options!.onStepFinish({
    text: "",
    usage: { inputTokens: 5, outputTokens: 1, totalTokens: 6 },
  });
  assert.equal("cachedInputTokens" in events[0]!, false);
});

test("an Anthropic model gets the system prompt as a cached system message", async () => {
  const { captured, input } = setup();
  await runLoop(input(undefined, { provider: "anthropic.messages" }));
  assert.deepEqual(captured.options!.system, {
    role: "system",
    content: "sys",
    providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
  });
});

test("another model keeps the system prompt as a plain string", async () => {
  const { captured, input } = setup();
  await runLoop(input(undefined, { provider: "openai.chat" }));
  assert.equal(captured.options!.system, "sys");
});
