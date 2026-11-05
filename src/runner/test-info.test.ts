import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { RegisteredTestCase, TestFixtures } from "../types/test.js";
import { SkipSignal } from "./skip.js";
import { newSuite } from "./suite.js";
import {
  currentTestInfo,
  runInTestScope,
  skipFromCondition,
  TestInfoImpl,
} from "./test-info.js";

const registered: RegisteredTestCase = {
  name: "Cart > adds",
  titlePath: ["Cart", "adds"],
  file: "/p/specs/cart.spec.ts",
  line: 7,
  column: 3,
  suite: newSuite(),
  function: async () => {},
};

function infoIn(dir: string, retry = 0) {
  return new TestInfoImpl({
    test: registered,
    browserName: "firefox",
    workerIndex: 2,
    retry,
    settings: { baseURL: "http://shop.test", timeout: 5000 },
    resultDir: dir,
    outputDir: path.join(dir, "attachments", "firefox", "cart"),
  });
}

test("project.name is the group when the test runs for one, else the browser", () => {
  const forGroup = new TestInfoImpl({
    test: { ...registered, group: "phone" },
    browserName: "chrome",
    workerIndex: 0,
    retry: 0,
    settings: { baseURL: undefined, timeout: 5000 },
    resultDir: "/r",
    outputDir: "/r/a",
  });
  assert.deepEqual(forGroup.project, { name: "phone" });
  assert.deepEqual(infoIn("/r").project, { name: "firefox" });
});

test("a test's info carries its identity and the run's settings", () => {
  const info = infoIn("/r", 1);
  assert.equal(info.title, "adds");
  assert.deepEqual(info.titlePath, ["Cart", "adds"]);
  assert.equal(info.file, "/p/specs/cart.spec.ts");
  assert.equal(info.line, 7);
  assert.equal(info.column, 3);
  assert.equal(info.retry, 1);
  assert.equal(info.workerIndex, 2);
  assert.deepEqual(info.project, { name: "firefox" });
  assert.deepEqual(info.config, { baseURL: "http://shop.test", timeout: 5000 });
  assert.deepEqual(info.annotations, []);
  assert.equal(info.status, undefined);
  assert.equal(info.expectedStatus, "passed");
  assert.deepEqual(info.errors, []);
});

test("line and column are left out when the test has none", () => {
  const info = new TestInfoImpl({
    test: {
      ...registered,
      line: undefined as never,
      column: undefined as never,
    },
    browserName: "chrome",
    workerIndex: 0,
    retry: 0,
    settings: { baseURL: undefined, timeout: 1 },
    resultDir: "/r",
    outputDir: "/r/a",
  });
  assert.ok(!("line" in info) || info.line === undefined);
});

test("bodyDone sets the status and the errors, and fixes the duration", async () => {
  const passed = infoIn("/r");
  passed.bodyDone(undefined);
  assert.equal(passed.status, "passed");

  const failed = infoIn("/r");
  failed.bodyDone(new Error("boom"));
  assert.equal(failed.status, "failed");
  assert.equal(failed.errors[0]?.message, "boom");

  const skipped = infoIn("/r");
  skipped.bodyDone(new SkipSignal("skip", "no"));
  assert.equal(skipped.status, "skipped");
  assert.deepEqual(skipped.errors, []);

  const d = failed.duration;
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(failed.duration, d, "the duration stops with the body");
});

test("attach saves a text body, a buffer and a copied file, and lists them", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "samurai-attach-"));
  const source = path.join(dir, "src.json");
  writeFileSync(source, '{"a":1}');
  const info = infoIn(dir);
  await info.attach("notes", { body: "hello" });
  await info.attach("notes", { body: "again", contentType: "text/html" });
  await info.attach("blob", { body: Buffer.from([1, 2, 3]) });
  await info.attach("data", { path: source });
  assert.deepEqual(
    info.attachments.map((a) => [a.name, a.contentType, path.basename(a.path)]),
    [
      ["notes", "text/plain", "notes.txt"],
      ["notes", "text/html", "notes-2.html"],
      ["blob", "application/octet-stream", "blob.bin"],
      ["data", "application/json", "data.json"],
    ],
  );
  assert.equal(readFileSync(info.attachments[0]!.path, "utf8"), "hello");
  assert.equal(readFileSync(info.attachments[3]!.path, "utf8"), '{"a":1}');
  assert.ok(info.attachments[0]!.path.startsWith(info.outputDir));
  assert.deepEqual(info.reportExtras().attachments?.[0], {
    name: "notes",
    contentType: "text/plain",
    path: "attachments/firefox/cart/notes.txt",
  });
});

test("attach refuses neither or both of body and path", async () => {
  const info = infoIn("/nonexistent");
  await assert.rejects(info.attach("x", {}), {
    message: "attach(): give either body or path",
  });
  await assert.rejects(info.attach("x", { body: "a", path: "/b" }), {
    message: "attach(): give either body or path, not both",
  });
  await assert.rejects(info.attach("", { body: "a" }), {
    message: "attach(): name must not be empty",
  });
});

test("the report extras list annotations only when there are some", () => {
  const info = infoIn("/r");
  assert.deepEqual(info.reportExtras(), {});
  info.annotations.push({ type: "issue", description: "A-1" });
  assert.deepEqual(info.reportExtras().annotations, [
    { type: "issue", description: "A-1" },
  ]);
});

test("currentTestInfo is the info of the running scope and throws outside one", async () => {
  assert.throws(() => currentTestInfo(), {
    message: "info(): no test is running",
  });
  const info = infoIn("/r");
  const fixtures = {} as TestFixtures;
  await runInTestScope({ info, fixtures }, async () => {
    await Promise.resolve();
    assert.equal(currentTestInfo(), info);
  });
});

test("skipFromCondition: a boolean, or a function of the fixtures, skips when truthy", async () => {
  const info = infoIn("/r");
  const fixtures = { browserName: "firefox" } as TestFixtures;
  assert.doesNotThrow(() => skipFromCondition("skip", false, "r"));
  assert.throws(() => skipFromCondition("skip", true, "r"), SkipSignal);
  await runInTestScope({ info, fixtures }, async () => {
    assert.throws(
      () =>
        skipFromCondition(
          "skip",
          ({ browserName }) => browserName === "firefox",
          "not here",
        ),
      { name: "SkipSignal", reason: "not here", annotation: "skip" },
    );
    assert.doesNotThrow(() =>
      skipFromCondition("fixme", ({ browserName }) => browserName === "chrome"),
    );
    assert.throws(() => skipFromCondition("fixme", () => true), {
      annotation: "fixme",
    });
    assert.throws(
      () => skipFromCondition("skip", (async () => true) as never),
      { message: "test.skip(): the condition function must be synchronous" },
    );
  });
  assert.throws(() => skipFromCondition("skip", () => true), {
    message: "test.skip(): a condition function needs a running test",
  });
});
