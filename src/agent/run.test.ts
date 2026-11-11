import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { scriptedModel } from "../testing/scripted-model.js";
import { runAgent } from "./index.js";
import { startAgent } from "./run.js";
import type { AgentEvent, AgentOptions } from "./types.js";

const options = (extra: Partial<AgentOptions> = {}): AgentOptions => ({
  model: scriptedModel([{ text: "hi" }]),
  goal: "x",
  file: "a.spec.ts",
  create: "t",
  projectDir: mkdtempSync(path.join(os.tmpdir(), "agent-run-")),
  config: {},
  ...extra,
});

test("a string model id is refused at the entry, before anything starts", () => {
  assert.throws(
    () => runAgent(options({ model: "anthropic/claude-sonnet-4" as never })),
    /agent\(\): model must be a model object.*Gateway/s,
  );
});

test("a limit that is not a positive number is refused at the entry", () => {
  assert.throws(
    () => runAgent(options({ limits: { maxSteps: 0 } })),
    /limits\.maxSteps/,
  );
});

test("without the ai package the run ends with an error that says what to install", async () => {
  const seen: AgentEvent[] = [];
  const session = startAgent(options({ onEvent: (e) => seen.push(e) }), {
    importAi: async () => {
      throw Object.assign(new Error("Cannot find package 'ai'"), {
        code: "ERR_MODULE_NOT_FOUND",
      });
    },
  });
  const result = await session.result;
  assert.equal(result.reason, "error");
  assert.match(
    result.error ?? "",
    /the "ai" package is not installed.*npm install ai zod/,
  );
  assert.deepEqual(
    seen.map((e) => e.type),
    ["ended"],
  );
});

test("a failure before any replay does not say the replay failed", async () => {
  const session = startAgent(options(), {
    importAi: async () => {
      throw new Error("no ai");
    },
  });
  const result = await session.result;
  assert.equal(result.reason, "error");
  assert.equal("failedIn" in result, false);
  assert.equal("replayStep" in result, false);
});
