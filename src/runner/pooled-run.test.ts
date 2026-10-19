import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SamuraiGroup } from "../types/config.js";
import type { RegisteredTestCase, TestResult } from "../types/test.js";
import type { ResolvedGroup } from "./groups.js";
import {
  concurrency,
  planItems,
  poolMode,
  runPooled,
  serialKeyOf,
  type PooledRunner,
} from "./pooled-run.js";
import type { RunEvent } from "./reporter.js";
import TestReporter from "./reporter.js";
import type { PoolEvent } from "./worker-pool.js";
import { newSuite } from "./suite.js";
import type { WorkItem } from "./worker-protocol.js";

const testCase = (file: string, name: string): RegisteredTestCase => ({
  file,
  name,
  titlePath: name.split(" > "),
  suite: newSuite(),
  function: async () => {},
});

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

describe("runPooled", () => {
  const a = testCase("/p/src/a.spec.ts", "one");
  const b = testCase("/p/src/a.spec.ts", "two");
  const c = testCase("/p/src/a.spec.ts", "three");

  const resultOf = (
    item: WorkItem,
    worker: number,
    status: "success" | "failed" = "success",
  ): TestResult =>
    ({
      name: item.testName,
      file: item.file,
      browser: item.browser,
      status,
      startTime: 5,
      duration: 10 + item.index,
      worker,
      ...(status === "failed" && { message: "boom", type: "error" }),
    }) as TestResult;

  function setup() {
    const events: RunEvent[] = [];
    const reporter = new TestReporter({
      environment: "staging",
      browsers: ["firefox"],
      output: false,
      onEvent: (event) => events.push(event),
    });
    const { items, planned } = planItems(
      [a, b, c],
      ["firefox"],
      () => undefined,
    );
    reporter.onStart(3, 2);
    return { events, reporter, items, planned };
  }

  it("feeds a reporter the events as they come, and the report lists the plan's order", async () => {
    const { events, reporter, items, planned } = setup();
    const pool: PooledRunner = {
      async run(given, hooks) {
        assert.deepEqual(given, items);
        const emit = (event: PoolEvent) => hooks?.onEvent?.(event);
        emit({ type: "test-start", item: items[1]!, worker: 1 });
        emit({ type: "test-start", item: items[0]!, worker: 0 });
        emit({
          type: "test-end",
          item: items[1]!,
          worker: 1,
          result: resultOf(items[1]!, 1),
        });
        emit({ type: "test-start", item: items[2]!, worker: 1 });
        emit({
          type: "test-end",
          item: items[0]!,
          worker: 0,
          result: resultOf(items[0]!, 0, "failed"),
        });
        emit({
          type: "test-end",
          item: items[2]!,
          worker: 1,
          result: resultOf(items[2]!, 1),
        });
        return items.map((item) => resultOf(item, item.index));
      },
    };
    await runPooled(pool, planned, items, reporter);
    const summary = await reporter.onEnd();
    assert.deepEqual(
      summary.tests.map((t) => [t.name, t.status]),
      [
        ["one", "failed"],
        ["two", "success"],
        ["three", "success"],
      ],
    );
    assert.deepEqual(
      events.map((e) => (e.type === "test-end" ? `end:${e.name}` : e.type)),
      [
        "run-start",
        "test-start",
        "test-start",
        "end:two",
        "test-start",
        "end:one",
        "end:three",
        "run-end",
      ],
    );
  });

  it("reports an item the pool answered without events: an aborted one, or a worker that died before it started", async () => {
    const { events, reporter, items, planned } = setup();
    const pool: PooledRunner = {
      async run(_given, hooks) {
        hooks?.onEvent?.({
          type: "test-end",
          item: items[0]!,
          worker: 0,
          result: resultOf(items[0]!, 0, "failed"),
        });
        return [
          resultOf(items[0]!, 0, "failed"),
          { ...resultOf(items[1]!, 0, "failed"), message: "Run aborted" },
          { ...resultOf(items[2]!, 0, "failed"), message: "Run aborted" },
        ] as TestResult[];
      },
    };
    await runPooled(pool, planned, items, reporter);
    const summary = await reporter.onEnd();
    assert.deepEqual(
      summary.tests.map((t) => [t.name, "message" in t && t.message]),
      [
        ["one", "boom"],
        ["two", "Run aborted"],
        ["three", "Run aborted"],
      ],
    );
    assert.deepEqual(
      events.filter((e) => e.type === "test-end").map((e) => e.type),
      ["test-end", "test-end", "test-end"],
      "every test has exactly one end",
    );
    assert.deepEqual(
      events.filter((e) => e.type === "test-start").length,
      3,
      "and a start before it",
    );
  });

  it("passes the signal to the pool", async () => {
    const { reporter, items, planned } = setup();
    const controller = new AbortController();
    let seen: AbortSignal | undefined;
    const pool: PooledRunner = {
      async run(_given, hooks) {
        seen = hooks?.signal;
        return items.map((item) => resultOf(item, 0));
      },
    };
    await runPooled(pool, planned, items, reporter, controller.signal);
    assert.equal(seen, controller.signal);
  });

  it("lets a pool failure through", async () => {
    const { reporter, items, planned } = setup();
    const pool: PooledRunner = {
      run: () => Promise.reject(new Error("worker could not start")),
    };
    await assert.rejects(
      runPooled(pool, planned, items, reporter),
      /worker could not start/,
    );
  });
});

describe("runPooled with skipped tests", () => {
  it("reports them first without a worker, and the report keeps the plan's order", async () => {
    const events: RunEvent[] = [];
    const reporter = new TestReporter({
      environment: "staging",
      browsers: ["firefox"],
      output: false,
      onEvent: (event) => events.push(event),
    });
    const a = testCase("/p/src/a.spec.ts", "one");
    const skipped = {
      ...testCase("/p/src/a.spec.ts", "later"),
      modifier: "fixme" as const,
    };
    const c = testCase("/p/src/a.spec.ts", "three");
    const { items, planned } = planItems(
      [a, skipped, c],
      ["firefox"],
      () => undefined,
    );
    reporter.onStart(planned.length, 2);

    const asked: WorkItem[][] = [];
    await runPooled(
      {
        async run(list, hooks) {
          asked.push(list);
          return list.map((item) => {
            const result = {
              name: item.testName,
              file: item.file,
              browser: item.browser,
              status: "success",
              startTime: 1,
              duration: 2,
            } as TestResult;
            hooks?.onEvent?.({ type: "test-start", item, worker: 0 });
            hooks?.onEvent?.({ type: "test-end", item, worker: 0, result });
            return result;
          });
        },
      },
      planned,
      items,
      reporter,
    );
    const summary = await reporter.onEnd();

    assert.deepEqual(
      asked[0]?.map((i) => i.testName),
      ["one", "three"],
    );
    assert.deepEqual(
      summary.tests.map((t) => [t.name, t.status]),
      [
        ["one", "success"],
        ["later", "skipped"],
        ["three", "success"],
      ],
    );
    assert.equal(events[1]?.type, "test-start");
    assert.equal(
      (events[1] as { name: string }).name,
      "later",
      "skips are reported before the pool runs",
    );
    assert.equal(summary.status, "success");
  });
});

describe("runPooled with retries", () => {
  it("reports the start of each attempt, and the end once", async () => {
    const events: RunEvent[] = [];
    const reporter = new TestReporter({
      environment: "staging",
      browsers: ["firefox"],
      output: false,
      onEvent: (event) => events.push(event),
    });
    const a = testCase("/p/src/a.spec.ts", "flaky");
    const { items, planned } = planItems([a], ["firefox"], () => undefined);
    reporter.onStart(1, 2);
    await runPooled(
      {
        async run(list, hooks) {
          const item = list[0]!;
          hooks?.onEvent?.({ type: "test-start", item, worker: 0 });
          hooks?.onEvent?.({ type: "test-start", item, worker: 0, retry: 1 });
          const result = {
            name: item.testName,
            file: item.file,
            browser: item.browser,
            status: "success",
            startTime: 1,
            duration: 2,
            retry: 1,
            flaky: true,
          } as TestResult;
          hooks?.onEvent?.({ type: "test-end", item, worker: 0, result });
          return [result];
        },
      },
      planned,
      items,
      reporter,
    );
    const summary = await reporter.onEnd();

    assert.deepEqual(
      events.map((e) => [e.type, (e as { retry?: number }).retry]),
      [
        ["run-start", undefined],
        ["test-start", undefined],
        ["test-start", 1],
        ["test-end", undefined],
        ["run-end", undefined],
      ],
    );
    assert.equal(summary.tests.length, 1);
    assert.equal((summary.tests[0] as { flaky?: boolean }).flaky, true);
  });
});
