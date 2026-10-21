import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { defineStep } from "../flows/steps/index.js";
import { listTests } from "../runner/run.js";
import type { SamuraiTestConfig } from "../types/config.js";
import {
  DEFAULT_COLLECT_BODIES,
  DEFAULT_COMMAND_TIMEOUT,
  DEFAULT_DOWNLOADS_DIR,
  DEFAULT_EXPECT_TIMEOUT,
  DEFAULT_FAIL_ON_PAGE_ERROR,
  DEFAULT_FILES_DIR,
  DEFAULT_IDLE_TIME,
  DEFAULT_LOGS_CAPTURE,
  DEFAULT_MAX_BODY_SIZE,
  DEFAULT_NAVIGATION_TIMEOUT,
  DEFAULT_RETRIES,
  DEFAULT_ROUTE_TIMEOUT,
  DEFAULT_SRC_DIR,
  DEFAULT_TIMEOUT,
  DEFAULT_TRACK_NETWORK,
  DEFAULT_VIEWPORT,
  DEFAULT_WAIT_UNTIL,
} from "./defaults.js";
import { loadConfig, resolveConfig, writtenConfig } from "./resolved-config.js";
import { validateWorkersConfig } from "./workers.js";
import { resolveWorkers } from "./workers-option.js";

const resolve = (raw: SamuraiTestConfig, env: Record<string, string> = {}) =>
  resolveConfig(raw, { projectDir: "/p", env });

describe("resolveConfig", () => {
  it("fills every default for an empty config", () => {
    assert.deepEqual(resolve({}), {
      projectDir: path.resolve("/p"),
      srcDir: path.resolve("/p/src"),
      srcDirRelative: DEFAULT_SRC_DIR,
      browsers: ["firefox"],
      browserPaths: {},
      timeout: DEFAULT_TIMEOUT,
      expectTimeout: DEFAULT_EXPECT_TIMEOUT,
      navigationTimeout: DEFAULT_NAVIGATION_TIMEOUT,
      waitUntil: DEFAULT_WAIT_UNTIL,
      bidiCommandTimeout: DEFAULT_COMMAND_TIMEOUT,
      workersResolved: resolveWorkers({}),
      retries: DEFAULT_RETRIES,
      forbidOnly: false,
      headless: false,
      viewport: DEFAULT_VIEWPORT,
      downloadsDir: DEFAULT_DOWNLOADS_DIR,
      filesDir: DEFAULT_FILES_DIR,
      logs: {
        capture: DEFAULT_LOGS_CAPTURE,
        failOnPageError: DEFAULT_FAIL_ON_PAGE_ERROR,
        ignoreErrors: [],
      },
      network: {
        track: DEFAULT_TRACK_NETWORK,
        idleTime: DEFAULT_IDLE_TIME,
        routeTimeout: DEFAULT_ROUTE_TIMEOUT,
        collectBodies: DEFAULT_COLLECT_BODIES,
        maxBodySize: DEFAULT_MAX_BODY_SIZE,
      },
      environments: {
        default: {
          timeout: 30000,
          expectTimeout: 5000,
          headless: false,
          variables: {},
        },
      },
      groups: [],
      steps: [],
    });
  });

  it("copies the shared defaults instead of handing them out", () => {
    const resolved = resolve({});
    assert.notEqual(resolved.viewport, DEFAULT_VIEWPORT);
    resolved.browsers.push("chrome");
    assert.deepEqual(resolve({}).browsers, ["firefox"]);
  });

  it("keeps what the config says", () => {
    const resolved = resolve({
      srcDir: "tests",
      workers: "50%",
      browserPaths: { chrome: "bin/chrome" },
      use: { viewport: null, headless: true },
      baseURL: "http://shop",
    });
    assert.equal(resolved.srcDir, path.resolve("/p/tests"));
    assert.equal(resolved.srcDirRelative, "tests");
    assert.equal(resolved.workers, "50%");
    assert.equal(resolved.workersResolved, resolveWorkers({ config: "50%" }));
    assert.deepEqual(resolved.browserPaths, { chrome: "bin/chrome" });
    assert.equal(resolved.viewport, null);
    assert.equal(resolved.headless, true);
    assert.equal(resolved.baseURL, "http://shop");
    assert.equal(resolved.environments.default!.baseURL, "http://shop");
  });

  it("CI makes it headless and forbids only", () => {
    const resolved = resolve({}, { CI: "1" });
    assert.equal(resolved.headless, true);
    assert.equal(resolved.forbidOnly, true);
    assert.equal(resolved.environments.default!.headless, true);
  });

  it("does not apply SAMURAI_WORKERS", () => {
    assert.equal(
      resolve({ workers: 3 }, { SAMURAI_WORKERS: "7" }).workersResolved,
      3,
    );
  });

  it("environments merge with the project the way runs do", () => {
    const resolved = resolve({
      timeout: 10000,
      baseURL: "http://project",
      environments: {
        staging: {
          expect: { timeout: 2000 },
          headless: true,
          variables: { user: "a" },
        },
        prod: { baseURL: "http://prod", timeout: 60000 },
      },
    });
    assert.deepEqual(resolved.environments, {
      staging: {
        baseURL: "http://project",
        timeout: 10000,
        expectTimeout: 2000,
        headless: true,
        variables: { user: "a" },
      },
      prod: {
        baseURL: "http://prod",
        timeout: 60000,
        expectTimeout: DEFAULT_EXPECT_TIMEOUT,
        headless: false,
        variables: {},
      },
    });
  });

  it("several environments without a default do not throw", () => {
    const environments = { a: {}, b: {} };
    const none = resolve({ environments });
    assert.match(none.environmentProblem!, /No environment chosen/);
    assert.equal(none.defaultEnvironment, undefined);
    assert.deepEqual(Object.keys(none.environments), ["a", "b"]);

    const unknown = resolve({ environments, defaultEnvironment: "nope" });
    assert.match(unknown.environmentProblem!, /Unknown environment "nope"/);
    assert.equal(unknown.defaultEnvironment, "nope");

    const noEnvironments = resolve({ defaultEnvironment: "nope" });
    assert.match(noEnvironments.environmentProblem!, /Unknown environment/);
    assert.deepEqual(Object.keys(noEnvironments.environments), ["default"]);

    const fine = resolve({ environments, defaultEnvironment: "b" });
    assert.ok(!("environmentProblem" in fine));
  });

  it("ignoreErrors survive JSON", () => {
    const resolved = resolve({ logs: { ignoreErrors: ["boom", /x+/gi] } });
    assert.deepEqual(resolved.logs.ignoreErrors, [
      { text: "boom", regexp: false },
      { text: "x+", regexp: true, flags: "gi" },
    ]);
    assert.deepEqual(JSON.parse(JSON.stringify(resolved)), resolved);
  });

  it("groups get their browsers", () => {
    const resolved = resolve({
      browsers: ["firefox"],
      groups: [{ name: "g", browsers: ["chrome"] }, { name: "plain" }],
    });
    assert.deepEqual(resolved.groups, [
      { name: "g", browsers: ["chrome"] },
      { name: "plain", browsers: ["firefox"] },
    ]);
  });

  it("steps are listed by kind", () => {
    const step = defineStep({
      kind: "my-step",
      label: "Mine",
      icon: "globe",
      section: "integrations",
      fields: [],
      async run() {},
    });
    assert.deepEqual(resolve({ steps: [step] }).steps, ["my-step"]);
  });

  it("an invalid config throws like a run", () => {
    let expected: Error | undefined;
    try {
      validateWorkersConfig({ workers: 0 });
    } catch (error) {
      expected = error as Error;
    }
    assert.ok(expected);
    assert.throws(() => resolve({ workers: 0 }), { message: expected.message });
  });
});

describe("writtenConfig", () => {
  it("is the config as the file states it: nothing filled in", () => {
    assert.deepEqual(writtenConfig({}), {});
    const written = writtenConfig({ timeout: 1000, use: { headless: true } });
    assert.deepEqual(written, { timeout: 1000, use: { headless: true } });
    assert.ok(!("workers" in written));
    assert.ok(!("environments" in written));
  });

  it("is JSON: patterns become text, steps become their kinds", () => {
    const written = writtenConfig({
      logs: { capture: "all", ignoreErrors: ["boom", /x+/gi] },
      steps: [
        defineStep({
          kind: "my-step",
          label: "Mine",
          icon: "globe",
          section: "integrations",
          fields: [],
          async run() {},
        }),
      ],
      environments: { staging: { baseURL: "https://s", variables: { n: 1 } } },
    });
    assert.deepEqual(written, {
      logs: {
        capture: "all",
        ignoreErrors: [
          { text: "boom", regexp: false },
          { text: "x+", regexp: true, flags: "gi" },
        ],
      },
      steps: ["my-step"],
      environments: { staging: { baseURL: "https://s", variables: { n: 1 } } },
    });
    assert.deepEqual(JSON.parse(JSON.stringify(written)), written);
  });

  it("does not share objects with the config", () => {
    const config: SamuraiTestConfig = {
      use: { viewport: { width: 1, height: 2 } },
    };
    const written = writtenConfig(config);
    assert.notEqual(written.use, config.use);
  });
});

describe("loadConfig", () => {
  it("with written: true gives the config as written next to the resolved one", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "samurai-written-"));
    writeFileSync(
      path.join(dir, "samurai.config.ts"),
      "export default { timeout: 1234, logs: { ignoreErrors: [/boom/i] } };\n",
    );
    const both = await loadConfig({ projectDir: dir, env: {}, written: true });
    assert.deepEqual(both.written, {
      timeout: 1234,
      logs: { ignoreErrors: [{ text: "boom", regexp: true, flags: "i" }] },
    });
    assert.equal(both.resolved?.timeout, 1234);
    assert.equal(both.resolved?.workersResolved, resolveWorkers({}));
    assert.ok(!("error" in both));
  });

  it("with written: true still gives the written config when it is invalid", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "samurai-written-"));
    writeFileSync(
      path.join(dir, "samurai.config.ts"),
      "export default { workers: 0 };\n",
    );
    let expected: Error | undefined;
    try {
      validateWorkersConfig({ workers: 0 });
    } catch (error) {
      expected = error as Error;
    }
    const both = await loadConfig({ projectDir: dir, env: {}, written: true });
    assert.deepEqual(both.written, { workers: 0 });
    assert.equal(both.resolved, undefined);
    assert.equal(both.error, expected?.message);
    await assert.rejects(loadConfig({ projectDir: dir, env: {} }), {
      message: expected?.message,
    });
  });

  it("reads a project's config and leaves no project active", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "samurai-resolved-"));
    writeFileSync(
      path.join(dir, "samurai.config.ts"),
      'export default { srcDir: "./tests", timeout: 1234 };\n',
    );
    const resolved = await loadConfig({ projectDir: dir, env: {} });
    assert.equal(resolved.projectDir, dir);
    assert.equal(resolved.srcDir, path.join(dir, "tests"));
    assert.equal(resolved.timeout, 1234);

    const other = mkdtempSync(path.join(tmpdir(), "samurai-other-"));
    writeFileSync(path.join(other, "package.json"), '{"type":"module"}');
    writeFileSync(
      path.join(other, "samurai.config.ts"),
      'export default { srcDir: "./src" };\n',
    );
    mkdirSync(path.join(other, "src"));
    writeFileSync(
      path.join(other, "src/a.spec.ts"),
      `import { test } from ${JSON.stringify(path.resolve("src/api.ts"))};
test("one", async () => {});`,
    );
    const tests = await listTests({ projectDir: other });
    assert.deepEqual(
      tests.map((t) => t.name),
      ["one"],
    );
  });
});
