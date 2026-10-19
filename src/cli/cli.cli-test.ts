import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { ConsoleReporter } from "./console-reporter.js";
import { initProject, scaffold } from "./init.js";
import type { Io } from "./io.js";
import { main, USAGE } from "./main.js";
import type { TestResult, TestSummary } from "../runner/run.js";

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
    const workers = io();
    assert.equal(await main(["run", "--workers", "0"], workers.target), 2);
    assert.match(workers.err(), /--workers must be a whole number from 1/);
  });

  it("documents --workers in the usage", () => {
    assert.match(USAGE, /--workers <n\|n%>/);
  });

  it("exits 2 for a config whose workers is not a count or a percentage, naming the key", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "samurai-cli-"));
    writeFileSync(
      path.join(dir, "samurai.config.ts"),
      'export default { workers: 0, groups: [{ name: "a", workers: "2%" }] };',
    );
    writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
    const previous = process.cwd();
    process.chdir(dir);
    try {
      const { target, err } = io();
      assert.equal(await main(["list"], target), 2);
      assert.match(
        err(),
        /^workers must be a whole number from 1 or a percentage/,
      );
    } finally {
      process.chdir(previous);
    }
  });

  it("lists tests with a marker for their modifier, and --json carries it", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "samurai-cli-"));
    writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
    writeFileSync(
      path.join(dir, "samurai.config.ts"),
      'export default { srcDir: "./specs", forbidOnly: false };',
    );
    mkdirSync(path.join(dir, "specs"));
    writeFileSync(
      path.join(dir, "specs/a.spec.ts"),
      `import { test } from ${JSON.stringify(path.resolve("src/api.ts"))};
test("plain", async () => {});
test.skip("later", async () => {});
test.fixme("broken", async () => {});
test.only("focus", async () => {});`,
    );
    const previous = process.cwd();
    process.chdir(dir);
    try {
      const human = io();
      assert.equal(await main(["list"], human.target), 0);
      const lines = human.out().split("\n");
      assert.ok(lines.includes("plain"), human.out());
      assert.ok(lines.includes("later [skip]"), human.out());
      assert.ok(lines.includes("broken [fixme]"), human.out());
      assert.ok(lines.includes("focus [only]"), human.out());

      const json = io();
      assert.equal(await main(["list", "--json"], json.target), 0);
      const listed = JSON.parse(json.out()) as {
        name: string;
        modifier?: string;
      }[];
      assert.deepEqual(
        listed.map((t) => [t.name, t.modifier]),
        [
          ["plain", undefined],
          ["later", "skip"],
          ["broken", "fixme"],
          ["focus", "only"],
        ],
      );
    } finally {
      process.chdir(previous);
    }
  });

  it("a run of only skipped tests exits 0, prints them as dashes and counts them", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "samurai-cli-skip-"));
    writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
    writeFileSync(
      path.join(dir, "samurai.config.ts"),
      'export default { srcDir: "./specs" };',
    );
    mkdirSync(path.join(dir, "specs"));
    writeFileSync(
      path.join(dir, "specs/a.spec.ts"),
      `import { test } from ${JSON.stringify(path.resolve("src/api.ts"))};
test.skip("later", async () => {});
test.fixme("broken", async () => {});`,
    );
    const previous = process.cwd();
    process.chdir(dir);
    try {
      const human = io();
      assert.equal(await main(["run"], human.target), 0);
      assert.match(human.out(), /- later \(skipped\)/);
      assert.match(human.out(), /- broken \(fixme\)/);
      assert.match(human.out(), /0 passed, 2 skipped/);

      const json = io();
      assert.equal(await main(["run", "--json"], json.target), 0);
      const types = json
        .out()
        .trim()
        .split("\n")
        .map((line) => (JSON.parse(line) as { type: string }).type);
      assert.deepEqual(types, [
        "run-start",
        "test-start",
        "test-end",
        "test-start",
        "test-end",
        "run-end",
      ]);
    } finally {
      process.chdir(previous);
    }
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

  it("record passes --headless and --no-headless to the browser", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "samurai-cli-"));
    writeFileSync(path.join(dir, "samurai.config.ts"), "export default {};");
    writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
    // A "browser" that writes the flags it was started with and exits, so the launch fails right after
    const browser = path.join(dir, "fake-firefox.sh");
    writeFileSync(
      browser,
      `#!/bin/sh\necho "$@" >> "${path.join(dir, "args.txt")}"\nexit 1\n`,
      { mode: 0o755 },
    );
    const saved = {
      path: process.env.SAMURAI_FIREFOX_PATH,
      ci: process.env.CI,
    };
    process.env.SAMURAI_FIREFOX_PATH = browser;
    process.env.CI = "1"; // headless by default, so only --no-headless gives a window
    const previous = process.cwd();
    process.chdir(dir);
    try {
      for (const flag of ["--no-headless", "--headless"]) {
        const { target } = io();
        const argv = ["record", "a.spec.ts", "--new", "t", flag];
        assert.equal(await main(argv, target), 2);
      }
      const [windowed, headless] = readFileSync(
        path.join(dir, "args.txt"),
        "utf8",
      )
        .trim()
        .split("\n");
      assert.doesNotMatch(windowed!, /--headless/);
      assert.match(headless!, /--headless/);
    } finally {
      process.chdir(previous);
      for (const [key, value] of [
        ["SAMURAI_FIREFOX_PATH", saved.path],
        ["CI", saved.ci],
      ] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("exits 2 for a config that still has the removed browser key, saying what to write", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "samurai-cli-"));
    writeFileSync(
      path.join(dir, "samurai.config.ts"),
      'export default { browser: "chrome" };',
    );
    writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
    const previous = process.cwd();
    process.chdir(dir);
    try {
      const { target, err } = io();
      assert.equal(await main(["run"], target), 2);
      assert.match(
        err(),
        /"browser" was replaced by "browsers": use browsers: \["chrome"\]/,
      );
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
