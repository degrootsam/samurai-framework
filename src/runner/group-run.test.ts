import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { SamuraiTestConfig } from "../types/config.js";
import type { RegisteredTestCase } from "../types/test.js";
import { newSuite } from "./suite.js";
import { listTests } from "./run.js";
import { withProject } from "./project.js";
import {
  browserPlan,
  expandByGroup,
  groupNamesOf,
  loadSpecs,
  selectTests,
} from "./select.js";
import { effectiveUse } from "./use-options.js";

const API = JSON.stringify(path.resolve("src/api.ts"));
let dir: string;

const config: SamuraiTestConfig = {
  browsers: ["firefox"],
  use: {
    locale: "en-US",
    timezoneId: "UTC",
    viewport: { width: 800, height: 600 },
  },
  groups: [
    {
      name: "phone",
      browsers: ["chrome"],
      use: {
        locale: "nl-NL",
        isMobile: true,
        viewport: { width: 390, height: 844 },
      },
    },
    { name: "desktop", use: { timezoneId: "Europe/Amsterdam" } },
    { name: "login", src: "./src/auth" },
  ],
};

before(() => {
  dir = mkdtempSync(path.join(tmpdir(), "samurai-group-run-"));
  writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
  mkdirSync(path.join(dir, "src/auth"), { recursive: true });
  writeFileSync(
    path.join(dir, "src/auth/login.spec.ts"),
    `import { test } from ${API};\ntest("signs in", async () => {});`,
  );
  writeFileSync(
    path.join(dir, "src/home.spec.ts"),
    `import { test } from ${API};\ntest("loads", async () => {});`,
  );
});

after(() => rmSync(dir, { recursive: true, force: true }));

const inProject = <T>(work: () => Promise<T>) =>
  withProject({ projectDir: dir, config }, work);

describe("groupNamesOf", () => {
  it("is empty without a group and keeps each name once, in order", () => {
    assert.deepEqual(groupNamesOf(undefined), []);
    assert.deepEqual(groupNamesOf("a"), ["a"]);
    assert.deepEqual(groupNamesOf(["b", "a", "b"]), ["b", "a"]);
  });
});

describe("selecting more than one group", () => {
  const options = { files: ["src/home.spec.ts", "src/auth/login.spec.ts"] };

  it("lists the union of the groups' tests, each test once", async () => {
    const tests = await listTests({
      projectDir: dir,
      config: {
        ...config,
        groups: [
          { name: "a", src: "./src/auth" },
          { name: "b", testMatch: "**/*.spec.ts" },
        ],
      },
      group: ["a", "b"],
    });
    assert.deepEqual(tests.map((t) => t.name).sort(), ["loads", "signs in"]);
  });

  it("an unknown group among several is an error naming the groups", async () => {
    await assert.rejects(
      listTests({ projectDir: dir, config, group: ["phone", "nope"] }),
      /Unknown group "nope"\. Groups: phone, desktop, login\./,
    );
  });

  it("runs a test once per selected group that holds it, each copy naming its group", async () => {
    await inProject(async () => {
      const loaded = await loadSpecs([
        path.join(dir, "src/home.spec.ts"),
        path.join(dir, "src/auth/login.spec.ts"),
      ]);
      const run = { ...options, group: ["phone", "desktop", "login"] };
      const selected = selectTests(loaded, run);
      assert.equal(selected.length, 2, "the union holds each test once");
      const runs = expandByGroup(selected, loaded, run);
      assert.deepEqual(
        runs.map((t) => [t.group, t.name]),
        [
          ["phone", "loads"],
          ["phone", "signs in"],
          ["desktop", "loads"],
          ["desktop", "signs in"],
          ["login", "signs in"],
        ],
      );
    });
  });

  it("without a group the tests are as they are", async () => {
    await inProject(async () => {
      const loaded = await loadSpecs([path.join(dir, "src/home.spec.ts")]);
      const selected = selectTests(loaded, {});
      assert.equal(expandByGroup(selected, loaded, {}), selected);
      assert.ok(!("group" in selected[0]!));
    });
  });
});

describe("browsers of a run with groups", () => {
  const plan = (options: Parameters<typeof browserPlan>[1]) =>
    inProject(async () => {
      const { groups } = await loadSpecs([path.join(dir, "src/home.spec.ts")]);
      return browserPlan(groups, options);
    });
  const test = (group?: string) =>
    ({ name: "t", group }) as unknown as RegisteredTestCase;

  it("each group runs in its own browsers, else the project's; the run holds their union", async () => {
    const { browsers, browsersOf } = await plan({
      group: ["phone", "desktop"],
    });
    assert.deepEqual(browsers, ["chrome", "firefox"]);
    assert.deepEqual(browsersOf(test("phone")), ["chrome"]);
    assert.deepEqual(browsersOf(test("desktop")), ["firefox"]);
  });

  it("--browser beats the groups' browsers", async () => {
    const { browsers, browsersOf } = await plan({
      group: ["phone", "desktop"],
      browsers: ["firefox", "chrome"],
    });
    assert.deepEqual(browsers, ["firefox", "chrome"]);
    assert.deepEqual(browsersOf(test("phone")), ["firefox", "chrome"]);
  });

  it("a run without groups uses the project's browsers", async () => {
    const { browsers } = await plan({});
    assert.deepEqual(browsers, ["firefox"]);
  });
});

describe("the use a test runs with", () => {
  const testIn = (group?: string, ...use: object[]) =>
    ({
      name: "t",
      file: "/p/a.spec.ts",
      titlePath: ["t"],
      function: async () => {},
      suite: { ...newSuite(), use },
      ...(group !== undefined && { group }),
    }) as unknown as RegisteredTestCase;

  it("config use, then the group's use, then test.use, the inner winning", async () => {
    await inProject(async () => {
      assert.deepEqual(
        await effectiveUse(testIn("phone", { locale: "fr-FR" })),
        {
          locale: "fr-FR",
          timezoneId: "UTC",
          isMobile: true,
          viewport: { width: 390, height: 844 },
        },
      );
      assert.deepEqual(await effectiveUse(testIn("phone")), {
        locale: "nl-NL",
        timezoneId: "UTC",
        isMobile: true,
        viewport: { width: 390, height: 844 },
      });
    });
  });

  it("a test of another group takes that group's use, and without a group none applies", async () => {
    await inProject(async () => {
      assert.deepEqual(await effectiveUse(testIn("desktop")), {
        locale: "en-US",
        timezoneId: "Europe/Amsterdam",
      });
      assert.deepEqual(await effectiveUse(testIn()), {
        locale: "en-US",
        timezoneId: "UTC",
      });
    });
  });
});
