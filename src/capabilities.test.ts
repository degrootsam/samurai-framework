import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { CAPABILITIES } from "./capabilities.js";
import { FLOWS_API } from "./flows/core/index.js";

describe("capabilities", () => {
  it("lists what this framework can do", () => {
    assert.deepEqual(CAPABILITIES, {
      groups: true,
      recorderToolbar: true,
      recorderFiles: true,
      flowsApi: FLOWS_API,
      flowSteps: true,
      managedBrowsers: true,
      modifiers: true,
      skipReason: true,
      testIds: true,
      resolvedConfig: true,
      recorderStartStatus: true,
      outputDir: true,
    });
  });

  it("imports nothing", () => {
    const text = readFileSync(
      new URL("./capabilities.ts", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(text, /^\s*import\s/m);
  });

  it("survives JSON", () => {
    assert.deepEqual(JSON.parse(JSON.stringify(CAPABILITIES)), CAPABILITIES);
  });
});
