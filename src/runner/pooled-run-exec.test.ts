import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TestResult } from "../types/test.js";
import { planItems, runPooled, type PooledRunner } from "./pooled-run.js";
import type { RunEvent } from "./reporter.js";
import TestReporter from "./reporter.js";
import type { PoolEvent } from "./worker-pool.js";
import type { WorkItem } from "./worker-protocol.js";
import { testCase } from "../testing/pooled-run-setup.js";

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
