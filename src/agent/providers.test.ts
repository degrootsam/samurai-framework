import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import http, { type IncomingHttpHeaders } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
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

const GATEWAY_HEADERS = JSON.stringify({
  authorization: "Bearer member-token-7d2e",
  "x-samurai-organization": "org-1",
});

test("SAMURAI_AI_BASE_URL and SAMURAI_AI_HEADERS reach the factory of every provider", async () => {
  for (const [spec, pkg, factory, keyEnv] of [
    [
      "anthropic:m",
      "@ai-sdk/anthropic",
      "createAnthropic",
      "ANTHROPIC_API_KEY",
    ],
    ["openai:m", "@ai-sdk/openai", "createOpenAI", "OPENAI_API_KEY"],
    [
      "openai-compatible:m",
      "@ai-sdk/openai-compatible",
      "createOpenAICompatible",
      "SAMURAI_AI_API_KEY",
    ],
  ] as const) {
    const model = (await modelFromSpec(spec, {
      projectDir: project({ [pkg]: factory }),
      env: {
        [keyEnv]: KEY,
        SAMURAI_AI_BASE_URL: "https://gateway.example/p/v1",
        SAMURAI_AI_HEADERS: GATEWAY_HEADERS,
      },
    })) as unknown as {
      settings: { baseURL: string; headers: Record<string, string> };
    };
    assert.equal(model.settings.baseURL, "https://gateway.example/p/v1", spec);
    assert.deepEqual(model.settings.headers, JSON.parse(GATEWAY_HEADERS), spec);
  }
});

test("without a base URL or headers, anthropic and openai get neither", async () => {
  const model = (await modelFromSpec("anthropic:m", {
    projectDir: project({ "@ai-sdk/anthropic": "createAnthropic" }),
    env: { ANTHROPIC_API_KEY: KEY, SAMURAI_AI_HEADERS: "  " },
  })) as unknown as { settings: object };
  assert.deepEqual(Object.keys(model.settings), ["apiKey"]);
});

test("bad SAMURAI_AI_HEADERS is a setup error that never repeats the value", async () => {
  const dir = project({ "@ai-sdk/anthropic": "createAnthropic" });
  for (const bad of [
    "{not json authorization Bearer secret-1",
    '["Bearer secret-2"]',
    '"Bearer secret-3"',
    "null",
    '{"authorization": 42, "x":"secret-4"}',
  ])
    await assert.rejects(
      modelFromSpec("anthropic:m", {
        projectDir: dir,
        env: { ANTHROPIC_API_KEY: KEY, SAMURAI_AI_HEADERS: bad },
      }),
      (error: Error) =>
        error instanceof ModelSetupError &&
        /SAMURAI_AI_HEADERS must be a JSON object/.test(error.message) &&
        !/secret-|Bearer|42/.test(error.message),
    );
});

/** The real provider package, when a workspace project has it installed (the framework depends on none) */
function realProviderDir(pkg: string): string | undefined {
  const dir = path.resolve(
    import.meta.dirname,
    "../../../../examples/sandbox-app",
  );
  try {
    createRequire(path.join(dir, "package.json")).resolve(pkg);
    return dir;
  } catch {
    return undefined;
  }
}

test("the anthropic SDK sends the gateway path, bearer token and extra headers", async (t) => {
  const dir = realProviderDir("@ai-sdk/anthropic");
  if (!dir)
    return t.skip("@ai-sdk/anthropic is not installed in the workspace");
  const seen: { url?: string; headers?: IncomingHttpHeaders } = {};
  const server = http.createServer((req, res) => {
    seen.url = req.url;
    seen.headers = req.headers;
    req.resume();
    res.statusCode = 500;
    res.end("{}");
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  try {
    const { port } = server.address() as AddressInfo;
    const model = (await modelFromSpec("anthropic:claude-test", {
      projectDir: dir,
      env: {
        ANTHROPIC_API_KEY: KEY,
        SAMURAI_AI_BASE_URL: `http://127.0.0.1:${port}/anthropic/v1`,
        SAMURAI_AI_HEADERS: GATEWAY_HEADERS,
      },
    })) as unknown as { doGenerate: (o: object) => Promise<unknown> };
    await model
      .doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        maxRetries: 0,
      })
      .catch(() => undefined);
    assert.equal(seen.url, "/anthropic/v1/messages");
    assert.equal(seen.headers?.authorization, "Bearer member-token-7d2e");
    assert.equal(seen.headers?.["x-samurai-organization"], "org-1");
  } finally {
    server.close();
  }
});
