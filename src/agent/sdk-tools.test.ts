import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { toSdkTools, type AiModule } from "./sdk-tools.js";
import type { AgentTool, ToolResult } from "./tools/context.js";

const fakeAi = {
  jsonSchema: (schema: unknown) => schema,
  zodSchema: () => ({ jsonSchema: {} }),
  tool: (definition: unknown) => definition,
} as unknown as AiModule;

const gate = { wait: async () => {}, note: async () => undefined };

type Executable = { execute(input: unknown): Promise<ToolResult> };

function slowTool(name: string, log: string[], ms: number): AgentTool {
  return {
    name,
    description: name,
    inputSchema: z.object({}),
    async run() {
      log.push(`${name} start`);
      await new Promise((resolve) => setTimeout(resolve, ms));
      log.push(`${name} end`);
      return { ok: true, message: name };
    },
  };
}

test("tool calls the model makes in one step run one after the other, in the order it made them", async () => {
  const log: string[] = [];
  const tools = toSdkTools(
    fakeAi,
    [slowTool("first", log, 30), slowTool("second", log, 1)],
    gate,
  ) as Record<string, Executable>;
  await Promise.all([
    tools.first!.execute({}),
    tools.second!.execute({}),
    tools.first!.execute({}),
  ]);
  assert.deepEqual(log, [
    "first start",
    "first end",
    "second start",
    "second end",
    "first start",
    "first end",
  ]);
});

test("a call that throws does not stop the calls queued behind it", async () => {
  const log: string[] = [];
  const failing: AgentTool = {
    name: "failing",
    description: "failing",
    inputSchema: z.object({}),
    async run() {
      throw new Error("boom");
    },
  };
  const tools = toSdkTools(
    fakeAi,
    [failing, slowTool("after", log, 1)],
    gate,
  ) as Record<string, Executable>;
  const [first, second] = await Promise.allSettled([
    tools.failing!.execute({}),
    tools.after!.execute({}),
  ]);
  assert.equal(first.status, "rejected");
  assert.equal(second.status, "fulfilled");
  assert.deepEqual(log, ["after start", "after end"]);
});
