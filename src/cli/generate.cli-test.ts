import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Io } from "./io.js";
import { main, USAGE } from "./main.js";

function io(env: Partial<NodeJS.ProcessEnv> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const target: Io = {
    out: (t) => out.push(t),
    err: (t) => err.push(t),
    color: false,
    env,
  };
  return { target, out: () => out.join(""), err: () => err.join("") };
}

const KEY = "sk-cli-test-key-456";

describe("samurai plan", () => {
  it("is in the usage, with the options of both commands", () => {
    assert.match(USAGE, /samurai plan "<goal>"/);
    assert.match(USAGE, /--out <plan\.md>/);
    assert.match(USAGE, /--plan <plan\.md>/);
  });

  it("exits 2 without a goal or a model", async () => {
    for (const [argv, message] of [
      [["plan"], /Which goal\?/],
      [["plan", "sign in"], /No model: pass --model/],
      [["plan", "sign in", "--out", "p.md"], /No model: pass --model/],
    ] as const) {
      const run = io();
      assert.equal(await main([...argv], run.target), 2);
      assert.match(run.err(), message);
    }
  });

  it("exits 2 for a missing key and never prints one", async () => {
    const run = io();
    const code = await main(
      ["plan", "x", "--out", "p.md", "--model", "anthropic:claude-x"],
      run.target,
    );
    assert.equal(code, 2);
    assert.match(run.err(), /ANTHROPIC_API_KEY/);
  });
});

describe("samurai generate", () => {
  it("is in the usage", () => {
    assert.match(USAGE, /samurai generate "<goal>"/);
    assert.match(USAGE, /--model <provider:name>/);
    assert.match(USAGE, /--continue-at <n>/);
  });

  it("exits 2 without a goal, a file or a model", async () => {
    for (const [argv, message] of [
      [["generate"], /Which goal\?/],
      [["generate", "sign in"], /exactly one --file/],
      [
        ["generate", "sign in", "--file", "a.spec.ts"],
        /No model: pass --model/,
      ],
    ] as const) {
      const run = io();
      assert.equal(await main([...argv], run.target), 2);
      assert.match(run.err(), message);
    }
  });

  it("exits 2 for a missing key, naming the variable and never printing a key", async () => {
    const run = io();
    const code = await main(
      ["generate", "x", "--file", "a.spec.ts", "--model", "anthropic:claude-x"],
      run.target,
    );
    assert.equal(code, 2);
    assert.match(run.err(), /ANTHROPIC_API_KEY is not set/);
  });

  it("exits 2 for a provider package the project lacks, saying what to install", async () => {
    const run = io({ OPENAI_API_KEY: KEY });
    const code = await main(
      ["generate", "x", "--file", "a.spec.ts", "--model", "openai:gpt-x"],
      run.target,
    );
    assert.equal(code, 2);
    assert.match(
      run.err(),
      /@ai-sdk\/openai is not installed in this project; run: npm install @ai-sdk\/openai ai zod/,
    );
    assert.equal(run.err().includes(KEY) || run.out().includes(KEY), false);
  });

  it("exits 2 for a model that is not provider:name", async () => {
    const run = io();
    const code = await main(
      ["generate", "x", "--file", "a.spec.ts", "--model", "claude"],
      run.target,
    );
    assert.equal(code, 2);
    assert.match(run.err(), /--model must look like provider:name/);
  });
});
