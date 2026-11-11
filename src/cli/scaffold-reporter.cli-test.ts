import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { ConsoleReporter } from "./console-reporter.js";
import { initProject, scaffold } from "./init.js";
import type { TestResult, TestSummary } from "../runner/run.js";

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
    browsers: ["firefox"],
    tests: [
      {
        name: "a",
        file: "/x/a.spec.ts",
        browser: "firefox",
        startTime: 0,
        status: "success",
        duration: 1000,
      },
      {
        name: "b > c",
        file: "/x/a.spec.ts",
        browser: "firefox",
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
    reporter.handle({
      type: "run-start",
      environment: "staging",
      total: 2,
      browsers: ["firefox"],
    });
    reporter.handle({
      type: "test-start",
      name: "a",
      file: "/x/a.spec.ts",
      browser: "firefox",
    });
    for (const result of summary.tests)
      reporter.handle({
        type: "test-end",
        name: "name" in result ? result.name : "",
        file: "/x/a.spec.ts",
        browser: "firefox",
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

  it("labels each test with its browser when the run has more than one", () => {
    let text = "";
    const reporter = new ConsoleReporter({
      write: (t) => (text += t),
      color: false,
    });
    reporter.handle({
      type: "run-start",
      environment: "staging",
      total: 4,
      browsers: ["firefox", "chrome"],
    });
    for (const browser of ["firefox", "chrome"] as const)
      reporter.handle({
        type: "test-end",
        name: "a",
        file: "/x/a.spec.ts",
        browser,
        result: { ...summary.tests[0]!, browser } as TestResult,
      });
    reporter.handle({
      type: "run-end",
      summary: {
        ...summary,
        browsers: ["firefox", "chrome"],
        tests: [{ ...summary.tests[1]!, browser: "chrome" } as TestResult],
      },
    });
    assert.match(text, /Running 4 tests against staging in firefox, chrome/);
    assert.match(text, /✔ a \[firefox\] \(1\.0s\)/);
    assert.match(text, /✔ a \[chrome\] \(1\.0s\)/);
    assert.match(text, /\nb > c \[chrome\]\n/);
  });

  it("names the workers of a run that uses more than one", () => {
    let text = "";
    const reporter = new ConsoleReporter({
      write: (t) => (text += t),
      color: false,
    });
    reporter.handle({
      type: "run-start",
      environment: "staging",
      total: 6,
      browsers: ["firefox"],
      workers: 3,
    });
    assert.equal(text, "Running 6 tests with 3 workers against staging\n");
  });

  it("prints no label for a run with one browser", () => {
    let text = "";
    const reporter = new ConsoleReporter({
      write: (t) => (text += t),
      color: false,
    });
    reporter.handle({
      type: "run-start",
      environment: "staging",
      total: 1,
      browsers: ["chrome"],
    });
    reporter.handle({
      type: "test-end",
      name: "a",
      file: "/x/a.spec.ts",
      browser: "chrome",
      result: summary.tests[0]!,
    });
    assert.ok(!text.includes("["), text);
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

describe("scaffold dependency", () => {
  it("asks for the version that scaffolded the project", () => {
    const own = JSON.parse(readFileSync("package.json", "utf8")) as {
      version: string;
    };
    const manifest = JSON.parse(scaffold("shop")["package.json"]!) as {
      dependencies: Record<string, string>;
    };
    assert.equal(
      manifest.dependencies["@itmetsam/samurai-framework"],
      `^${own.version}`,
    );
  });
});
