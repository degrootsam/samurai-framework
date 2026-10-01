import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { ConsoleReporter } from "./console-reporter.js";
import { initProject, scaffold } from "./init.js";
import { main, USAGE, type Io } from "./main.js";
import type { TestSummary } from "../runner/run.js";

function io() {
  const out: string[] = [];
  const err: string[] = [];
  const target: Io = {
    out: (t) => out.push(t),
    err: (t) => err.push(t),
    color: false,
    env: {},
  };
  return { target, out: () => out.join(""), err: () => err.join("") };
}

describe("main", () => {
  it("prints the usage for --help, -h and help", async () => {
    for (const argv of [["--help"], ["-h"], ["help"], ["run", "--help"]]) {
      const { target, out } = io();
      assert.equal(await main(argv, target), 0);
      assert.equal(out(), USAGE);
    }
  });

  it("prints the version", async () => {
    const { target, out } = io();
    assert.equal(await main(["--version"], target), 0);
    assert.match(out(), /^\d+\.\d+\.\d+/);
  });

  it("exits 2 for an unknown command, with the usage", async () => {
    const { target, err } = io();
    assert.equal(await main(["bogus"], target), 2);
    assert.match(err(), /Unknown command "bogus"/);
    assert.match(err(), /Usage:/);
  });

  it("exits 2 for an unknown flag or a bad value, with a message", async () => {
    const flag = io();
    assert.equal(await main(["run", "--nope"], flag.target), 2);
    assert.match(flag.err(), /nope/);
    const port = io();
    assert.equal(await main(["run", "--port", "abc"], port.target), 2);
    assert.match(port.err(), /--port/);
  });

  it("exits 2 when the project has no config", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "samurai-cli-"));
    const previous = process.cwd();
    process.chdir(dir);
    try {
      const { target, err } = io();
      assert.equal(await main(["list"], target), 2);
      assert.ok(err().length > 0);
    } finally {
      process.chdir(previous);
    }
  });

  it("record needs a spec and a sensible --at", async () => {
    const none = io();
    assert.equal(await main(["record"], none.target), 2);
    assert.match(none.err(), /Which spec/);
    const bad = io();
    assert.equal(
      await main(["record", "a.spec.ts", "--at", "x"], bad.target),
      2,
    );
    assert.match(bad.err(), /--at/);
  });

  it("record refuses a spec that does not exist unless --new is given", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "samurai-cli-"));
    writeFileSync(path.join(dir, "samurai.config.ts"), "export default {};");
    const previous = process.cwd();
    process.chdir(dir);
    try {
      const { target, err } = io();
      assert.equal(await main(["record", "tests/none.spec.ts"], target), 2);
      assert.match(err(), /does not exist/);
    } finally {
      process.chdir(previous);
    }
  });

  it("init scaffolds a project and never overwrites", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "samurai-init-"));
    writeFileSync(path.join(dir, "package.json"), '{"name":"mine"}');
    const { target, out } = io();
    assert.equal(await main(["init", dir], target), 0);
    assert.match(out(), /kept\s+package\.json/);
    assert.match(out(), /created samurai\.config\.ts/);
    assert.equal(
      readFileSync(path.join(dir, "package.json"), "utf8"),
      '{"name":"mine"}',
    );
    for (const file of [
      "samurai.config.ts",
      "tests/example.spec.ts",
      ".env.example",
      ".gitignore",
    ]) {
      assert.ok(existsSync(path.join(dir, file)), file);
    }
  });
});

describe("scaffold", () => {
  it("is an ES module project with a test script", () => {
    const manifest = JSON.parse(scaffold("shop")["package.json"]!) as {
      type: string;
      scripts: { test: string };
      name: string;
    };
    assert.equal(manifest.type, "module");
    assert.equal(manifest.scripts.test, "samurai run");
    assert.equal(manifest.name, "shop");
  });

  it("names the package after the folder, safely", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "My Shop!-"));
    initProject(dir);
    const manifest = JSON.parse(
      readFileSync(path.join(dir, "package.json"), "utf8"),
    ) as { name: string };
    assert.match(manifest.name, /^[a-z0-9-]+$/);
  });
});

describe("ConsoleReporter", () => {
  const summary: TestSummary = {
    status: "failed",
    duration: 2300,
    startTime: 0,
    environment: "staging",
    tests: [
      {
        name: "a",
        file: "/x/a.spec.ts",
        startTime: 0,
        status: "success",
        duration: 1000,
      },
      {
        name: "b > c",
        file: "/x/a.spec.ts",
        startTime: 0,
        status: "failed",
        duration: 1300,
        type: "error",
        message: "boom\nsecond line",
      },
    ],
  };

  it("prints a line per test, the failures in full and a count", () => {
    let text = "";
    const reporter = new ConsoleReporter({
      write: (t) => (text += t),
      color: false,
    });
    reporter.handle({ type: "run-start", environment: "staging", total: 2 });
    reporter.handle({ type: "test-start", name: "a", file: "/x/a.spec.ts" });
    for (const result of summary.tests)
      reporter.handle({
        type: "test-end",
        name: "name" in result ? result.name : "",
        file: "/x/a.spec.ts",
        result,
      });
    reporter.handle({ type: "run-end", summary });
    assert.match(text, /Running 2 tests against staging/);
    assert.match(text, /✔ a \(1\.0s\)/);
    assert.match(text, /✖ b > c \(1\.3s\)/);
    assert.match(text, /\n {4}boom\n {4}second line\n/);
    assert.match(text, /1 failed, 1 passed \(2\.3s\)/);
    assert.ok(!text.includes("\u001b"), "no colour codes when colour is off");
  });

  it("colours when asked to", () => {
    let text = "";
    new ConsoleReporter({ write: (t) => (text += t), color: true }).handle({
      type: "run-end",
      summary,
    });
    assert.ok(text.includes("\u001b[31m"));
  });
});
