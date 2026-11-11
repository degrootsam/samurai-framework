import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SamuraiGroup } from "../types/config.js";
import type { RegisteredTestCase } from "../types/test.js";
import type { ResolvedGroup } from "./groups.js";
import { concurrency, planItems, poolMode, serialKeyOf } from "./pooled-run.js";
import type { WorkItem } from "./worker-protocol.js";
import { testCase } from "../testing/pooled-run-setup.js";

describe("planItems", () => {
  it("lists every test in the first browser, then every test in the second", () => {
    const a = testCase("/p/src/a.spec.ts", "A > one");
    const b = testCase("/p/src/b.spec.ts", "two");
    const { items, planned } = planItems(
      [a, b],
      ["firefox", "chrome"],
      () => undefined,
    );
    assert.deepEqual(items, [
      { index: 0, file: a.file, testName: "A > one", browser: "firefox" },
      { index: 1, file: b.file, testName: "two", browser: "firefox" },
      { index: 2, file: a.file, testName: "A > one", browser: "chrome" },
      { index: 3, file: b.file, testName: "two", browser: "chrome" },
    ]);
    assert.deepEqual(
      planned.map((p) => [p.test.name, p.browser]),
      items.map((i) => [i.testName, i.browser]),
    );
  });

  it("keeps a skipped test in the plan but out of the queue, and the items still point into the plan", () => {
    const a = testCase("/p/src/a.spec.ts", "one");
    const skipped = {
      ...testCase("/p/src/a.spec.ts", "two"),
      modifier: "skip" as const,
    };
    const c = testCase("/p/src/a.spec.ts", "three");
    const { items, planned } = planItems(
      [a, skipped, c],
      ["firefox", "chrome"],
      () => undefined,
    );
    assert.equal(planned.length, 6);
    assert.deepEqual(
      items.map((i) => [i.index, i.testName, i.browser]),
      [
        [0, "one", "firefox"],
        [2, "three", "firefox"],
        [3, "one", "chrome"],
        [5, "three", "chrome"],
      ],
    );
  });

  it("puts the tests of a unit in one unit per browser, and marks a serial block", () => {
    const a = testCase("/p/src/a.spec.ts", "one");
    const b = testCase("/p/src/a.spec.ts", "two");
    const c = testCase("/p/src/a.spec.ts", "three");
    const { items } = planItems(
      [a, b, c],
      ["firefox", "chrome"],
      () => undefined,
      undefined,
      (test) => (test === c ? undefined : { key: "block", serial: test === a }),
    );
    assert.deepEqual(
      items.map((i) => [i.unit, i.serial]),
      [
        ["block@firefox", true],
        ["block@firefox", undefined],
        [undefined, undefined],
        ["block@chrome", true],
        ["block@chrome", undefined],
        [undefined, undefined],
      ],
    );
  });

  it("gives a test of a serial group its group's key, in every browser", () => {
    const a = testCase("/p/src/a.spec.ts", "one");
    const b = testCase("/p/src/b.spec.ts", "two");
    const { items } = planItems([a, b], ["firefox", "chrome"], (test) =>
      test === a ? "group:shared-account" : undefined,
    );
    assert.deepEqual(
      items.map((i) => i.serialKey),
      ["group:shared-account", undefined, "group:shared-account", undefined],
    );
    assert.ok(
      !("serialKey" in items[1]!),
      "no key at all, not an undefined one",
    );
  });
});

describe("planItems with groups", () => {
  const base = testCase("/p/src/a.spec.ts", "A > one");
  const phone = { ...base, group: "phone" };
  const desktop = { ...base, group: "desktop" };

  it("lists the same test once per group, each item naming its group", () => {
    const { items, planned } = planItems(
      [phone, desktop],
      ["firefox"],
      () => undefined,
    );
    assert.deepEqual(
      items.map((i) => [i.index, i.testName, i.group]),
      [
        [0, "A > one", "phone"],
        [1, "A > one", "desktop"],
      ],
    );
    assert.deepEqual(
      planned.map((p) => p.test.group),
      ["phone", "desktop"],
    );
  });

  it("leaves group out of the items of a run without groups", () => {
    const { items } = planItems([base], ["firefox"], () => undefined);
    assert.ok(!("group" in items[0]!));
  });

  it("runs a test only in the browsers its group names", () => {
    const { items } = planItems(
      [phone, desktop],
      ["firefox", "chrome"],
      () => undefined,
      undefined,
      () => undefined,
      (test, browser) => test.group !== "phone" || browser === "chrome",
    );
    assert.deepEqual(
      items.map((i) => [i.group, i.browser]),
      [
        ["desktop", "firefox"],
        ["phone", "chrome"],
        ["desktop", "chrome"],
      ],
    );
  });

  it("gives a file's unit of each group its own key", () => {
    const unit = (test: RegisteredTestCase) => ({
      key: `file:${test.file}${test.group ? `@${test.group}` : ""}`,
      serial: false,
    });
    const { items } = planItems(
      [phone, desktop],
      ["firefox"],
      () => undefined,
      undefined,
      unit,
    );
    assert.equal(new Set(items.map((i) => i.unit)).size, 2);
  });
});

describe("serialKeyOf", () => {
  const groups: ResolvedGroup[] = [
    group("parallel-ok", ["a.spec.ts::one"]),
    group("shared", ["a.spec.ts::one", "b.spec.ts::two"]),
    group("also-serial", ["b.spec.ts::two", "c.spec.ts::three"]),
  ];
  const configGroups: SamuraiGroup[] = [
    { name: "parallel-ok", workers: 4 },
    { name: "shared", workers: 1 },
    { name: "also-serial", workers: 1 },
  ];

  it("is the first group with workers 1 that holds the test", () => {
    const key = serialKeyOf(groups, configGroups, "/p/src");
    assert.equal(key(testCase("/p/src/a.spec.ts", "one")), "group:shared");
    assert.equal(key(testCase("/p/src/b.spec.ts", "two")), "group:shared");
    assert.equal(
      key(testCase("/p/src/c.spec.ts", "three")),
      "group:also-serial",
    );
    assert.equal(key(testCase("/p/src/d.spec.ts", "free")), undefined);
  });

  it("is nothing without groups", () => {
    assert.equal(
      serialKeyOf([], undefined, "/p/src")(testCase("/p/src/a.spec.ts", "x")),
      undefined,
    );
  });

  function group(name: string, testIds: string[]): ResolvedGroup {
    return {
      name,
      kind: "pattern",
      testIds,
      missing: [],
      browsers: ["firefox"],
    };
  }
});

describe("concurrency", () => {
  const item = (index: number, serialKey?: string): WorkItem => ({
    index,
    file: "/p/src/a.spec.ts",
    testName: `t${index}`,
    browser: "firefox",
    ...(serialKey !== undefined && { serialKey }),
  });

  it("counts every item without a key, and every key once", () => {
    assert.equal(concurrency([item(0), item(1), item(2)]), 3);
    assert.equal(concurrency([item(0, "g"), item(1, "g"), item(2)]), 2);
    assert.equal(concurrency([item(0, "g"), item(1, "h")]), 2);
  });

  it("counts the items of one unit once", () => {
    const unit = (index: number, name: string): WorkItem => ({
      ...item(index),
      unit: name,
    });
    assert.equal(
      concurrency([unit(0, "u"), unit(1, "u"), unit(2, "v"), item(3)]),
      3,
    );
  });

  it("is 1 when one group that runs alone holds everything", () => {
    assert.equal(concurrency([item(0, "g"), item(1, "g"), item(2, "g")]), 1);
    assert.equal(concurrency([]), 0);
  });
});

describe("poolMode", () => {
  it("uses the pool for more than one worker and more than one item", () => {
    assert.equal(
      poolMode({ workers: 2, items: 3, inlineConfig: false }),
      "pool",
    );
  });

  it("stays in this process with one worker or one item", () => {
    assert.equal(
      poolMode({ workers: 1, items: 9, inlineConfig: false }),
      "in-process",
    );
    assert.equal(
      poolMode({ workers: 4, items: 1, inlineConfig: false }),
      "in-process",
    );
    assert.equal(
      poolMode({ workers: 4, items: 0, inlineConfig: true }),
      "in-process",
    );
  });

  it("falls back, and says so, when the config was given as an object", () => {
    assert.equal(
      poolMode({ workers: 4, items: 3, inlineConfig: true }),
      "inline-config",
    );
    assert.equal(
      poolMode({ workers: 1, items: 3, inlineConfig: true }),
      "in-process",
      "one worker needs nothing from the folder, so no warning",
    );
  });
});
