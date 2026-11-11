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
import { io } from "../testing/cli-io.js";
import { main } from "./main.js";

describe("main", () => {
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
test.fixme("broken", { reason: "flaky on CI" }, async () => {});
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
      assert.ok(lines.includes("broken [fixme: flaky on CI]"), human.out());
      assert.ok(lines.includes("focus [only]"), human.out());

      const json = io();
      assert.equal(await main(["list", "--json"], json.target), 0);
      const listed = JSON.parse(json.out()) as {
        name: string;
        modifier?: string;
        reason?: string;
      }[];
      assert.deepEqual(
        listed.map((t) => [t.name, t.modifier, t.reason]),
        [
          ["plain", undefined, undefined],
          ["later", "skip", undefined],
          ["broken", "fixme", "flaky on CI"],
          ["focus", "only", undefined],
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
test.fixme("broken", { reason: "flaky on CI" }, async () => {});`,
    );
    const previous = process.cwd();
    process.chdir(dir);
    try {
      const human = io();
      assert.equal(await main(["run"], human.target), 0);
      assert.match(human.out(), /- later \(skipped\)/);
      assert.match(human.out(), /- broken \(fixme: flaky on CI\)/);
      assert.match(human.out(), /0 passed, 2 skipped/);

      const json = io();
      assert.equal(await main(["run", "--json"], json.target), 0);
      const events = json
        .out()
        .trim()
        .split("\n")
        .map(
          (line) =>
            JSON.parse(line) as { type: string; result?: { reason?: string } },
        );
      const types = events.map((event) => event.type);
      assert.deepEqual(
        events
          .filter((e) => e.type === "test-end")
          .map((e) => e.result?.reason),
        [undefined, "flaky on CI"],
      );
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

  it("record always opens a window: CI and use.headless do not change that, and --headless is refused", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "samurai-cli-"));
    // The project asks for headless everywhere, and CI is set: a recording still gets a window
    writeFileSync(
      path.join(dir, "samurai.config.ts"),
      "export default { use: { headless: true } };",
    );
    writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
    // A "browser" that writes the flags it was started with and exits, so the launch fails right after
    const browser = path.join(dir, "fake-firefox.sh");
    const argsFile = path.join(dir, "args.txt");
    writeFileSync(browser, `#!/bin/sh\necho "$@" >> "${argsFile}"\nexit 1\n`, {
      mode: 0o755,
    });
    const saved = {
      path: process.env.SAMURAI_FIREFOX_PATH,
      ci: process.env.CI,
    };
    process.env.SAMURAI_FIREFOX_PATH = browser;
    process.env.CI = "1";
    const previous = process.cwd();
    process.chdir(dir);
    try {
      for (const flags of [[], ["--no-headless"]]) {
        const { target } = io();
        const argv = ["record", "a.spec.ts", "--new", "t", ...flags];
        assert.equal(await main(argv, target), 2);
      }
      const started = readFileSync(argsFile, "utf8").trim().split("\n");
      assert.equal(started.length, 2);
      for (const args of started) assert.doesNotMatch(args, /--headless/);

      // --headless is a usage error, and no browser is started for it
      const refused = io();
      const argv = ["record", "a.spec.ts", "--new", "t", "--headless"];
      assert.equal(await main(argv, refused.target), 2);
      assert.match(refused.err(), /--headless: a recording needs a window/);
      assert.equal(readFileSync(argsFile, "utf8").trim().split("\n").length, 2);
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
