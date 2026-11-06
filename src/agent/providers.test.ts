import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  defaultModelSpec,
  modelFromSpec,
  ModelSetupError,
} from "./providers.js";

const KEY = "sk-test-key-9f3a1c";

/** A project whose node_modules holds a fake provider package: its factory returns models that echo the settings */
function project(packages: Record<string, string> = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "agent-provider-"));
  writeFileSync(path.join(dir, "package.json"), '{"name":"p"}');
  for (const [name, factory] of Object.entries(packages)) {
    const folder = path.join(dir, "node_modules", ...name.split("/"));
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      path.join(folder, "package.json"),
      JSON.stringify({ name, main: "index.js" }),
    );
    writeFileSync(
      path.join(folder, "index.js"),
      `exports.${factory} = (settings) => (modelId) => ({ specificationVersion: "v4", provider: "fake", modelId, settings });`,
    );
  }
  return dir;
}

test("anthropic:name loads the package from the project and passes the key", async () => {
  const dir = project({ "@ai-sdk/anthropic": "createAnthropic" });
  const model = (await modelFromSpec("anthropic:claude-test", {
    projectDir: dir,
    env: { ANTHROPIC_API_KEY: KEY },
  })) as unknown as { modelId: string; settings: { apiKey: string } };
  assert.equal(model.modelId, "claude-test");
  assert.equal(model.settings.apiKey, KEY);
});

test("openai:name uses OPENAI_API_KEY", async () => {
  const dir = project({ "@ai-sdk/openai": "createOpenAI" });
  const model = (await modelFromSpec("openai:gpt-test", {
    projectDir: dir,
    env: { OPENAI_API_KEY: KEY },
  })) as unknown as { settings: { apiKey: string } };
  assert.equal(model.settings.apiKey, KEY);
});

test("openai-compatible:name needs the endpoint; the key is optional", async () => {
  const dir = project({
    "@ai-sdk/openai-compatible": "createOpenAICompatible",
  });
  await assert.rejects(
    modelFromSpec("openai-compatible:llama", { projectDir: dir, env: {} }),
    /SAMURAI_AI_BASE_URL is not set/,
  );
  const model = (await modelFromSpec("openai-compatible:llama", {
    projectDir: dir,
    env: { SAMURAI_AI_BASE_URL: "http://localhost:11434/v1" },
  })) as unknown as {
    settings: { baseURL: string; name: string; apiKey?: string };
  };
  assert.equal(model.settings.baseURL, "http://localhost:11434/v1");
  assert.equal(model.settings.name, "openai-compatible");
  assert.equal(model.settings.apiKey, undefined);
});

test("a missing key or package is a setup error that says what to set or install, without a key in it", async () => {
  const dir = project({ "@ai-sdk/anthropic": "createAnthropic" });
  await assert.rejects(
    modelFromSpec("anthropic:x", { projectDir: dir, env: {} }),
    (error: Error) =>
      error instanceof ModelSetupError &&
      /ANTHROPIC_API_KEY is not set/.test(error.message),
  );
  await assert.rejects(
    modelFromSpec("openai:x", {
      projectDir: dir,
      env: { OPENAI_API_KEY: KEY },
    }),
    (error: Error) =>
      error instanceof ModelSetupError &&
      /@ai-sdk\/openai is not installed in this project; run: npm install @ai-sdk\/openai ai zod/.test(
        error.message,
      ) &&
      !error.message.includes(KEY),
  );
});

test("a spec that is not provider:name is refused", async () => {
  for (const spec of ["claude", "mystery:model", "anthropic:", ":x"])
    await assert.rejects(
      modelFromSpec(spec, {
        projectDir: project(),
        env: { ANTHROPIC_API_KEY: KEY },
      }),
      /--model must look like provider:name/,
    );
});

test("a package that gives no model is a setup error", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "agent-provider-"));
  writeFileSync(path.join(dir, "package.json"), "{}");
  const folder = path.join(dir, "node_modules", "@ai-sdk", "openai");
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    path.join(folder, "package.json"),
    '{"name":"@ai-sdk/openai","main":"index.js"}',
  );
  writeFileSync(
    path.join(folder, "index.js"),
    "exports.createOpenAI = () => () => 'not a model';",
  );
  await assert.rejects(
    modelFromSpec("openai:x", {
      projectDir: dir,
      env: { OPENAI_API_KEY: KEY },
    }),
    /did not give a model for "x"/,
  );
});

test("the default model comes from SAMURAI_AI_MODEL first", async () => {
  assert.equal(
    await defaultModelSpec({ SAMURAI_AI_MODEL: "openai:gpt-x" }),
    "openai:gpt-x",
  );
});
