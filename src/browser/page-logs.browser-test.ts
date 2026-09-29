import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { judgePageLogs } from "../runner/page-logs-report.js";
import { callFunction } from "../script/call-function.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";
import { Browser } from "./browser.js";
import type { ConsoleMessage, PageError } from "./page-logs.js";
import type Page from "./page.js";

let browser: Browser;
let page: Page;

before(async () => {
  ({ browser, page } = await Browser.launch("firefox", { port: 9240, headless: true }));
  await page.navigateTo("about:blank");
});

after(async () => {
  await page.dispose();
  await browser?.close();
});

const OPTIONS = { timeout: 30000 };
const run = (source: string) =>
  callFunction((page as unknown as { biDiConnector: BiDiConnector }).biDiConnector, page.contextId, source, [], {
    awaitPromise: false,
  });

test("console calls arrive with method, text and plain arguments", OPTIONS, async () => {
  page.clearLogs();
  const seen: ConsoleMessage[] = [];
  const onConsole = (message: ConsoleMessage) => seen.push(message);
  page.on("console", onConsole);
  await page.startLogging();
  await run(`() => {
    console.log("hello", 42, { a: [1, 2], b: "x" });
    console.warn("careful");
    console.error("bad but handled");
    console.info("fyi");
    console.debug("details");
  }`);
  await page.syncLogs();
  page.off("console", onConsole);

  assert.deepEqual(seen.map((message) => message.type()), ["log", "warn", "error", "info", "debug"]);
  assert.match(seen[0]!.text(), /^hello 42 Object/, "the browser's own rendering of the call");
  assert.deepEqual(seen[0]!.args, ["hello", 42, { a: [1, 2], b: "x" }]);
  assert.equal(seen[1]!.level, "warn");
  assert.equal(seen[2]!.level, "error");
  assert.ok(seen[0]!.location(), "a location is reported");
  assert.deepEqual(page.getLogs().map((log) => [log.type, log.method]), [
    ["console", "log"], ["console", "warn"], ["console", "error"], ["console", "info"], ["console", "debug"],
  ]);
  assert.equal(page.pageErrors().length, 0, "console.error is not an uncaught exception");
});

test("an uncaught exception is a page error with a stack", OPTIONS, async () => {
  page.clearLogs();
  const errors: PageError[] = [];
  const onError = (error: PageError) => errors.push(error);
  page.on("pageerror", onError);
  await run(`() => { setTimeout(function explode() { throw new TypeError("boom from the page"); }, 0); }`);
  await new Promise((resolve) => setTimeout(resolve, 200));
  await page.syncLogs();
  page.off("pageerror", onError);

  assert.equal(errors.length, 1);
  assert.match(errors[0]!.message, /TypeError: boom from the page/);
  assert.match(errors[0]!.stack ?? "", /explode/);
  assert.equal(page.pageErrors().length, 1);
  assert.deepEqual(page.getLogs().map((log) => [log.type, log.level]), [["javascript", "error"]]);
});

test("an unhandled promise rejection is reported as a page error too (Firefox)", OPTIONS, async () => {
  page.clearLogs();
  await run(`() => { Promise.reject(new Error("nobody catches me")); }`);
  await new Promise((resolve) => setTimeout(resolve, 200));
  await page.syncLogs();
  assert.deepEqual(page.pageErrors().map((error) => error.message), ["Error: nobody catches me"]);
});

test("logs of an iframe belong to the page", OPTIONS, async () => {
  page.clearLogs();
  await run(`() => {
    const frame = document.body.appendChild(document.createElement("iframe"));
    frame.src = "about:blank";
    frame.addEventListener("load", () => frame.contentWindow.console.log("from the frame"), { once: true });
  }`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  await page.syncLogs();
  assert.deepEqual(page.getLogs().map((log) => log.text), ["from the frame"]);
});

test("the first log of a new document is not lost", OPTIONS, async () => {
  page.clearLogs();
  await page.navigateTo(`data:text/html,<script>console.log("very early")</script>`);
  await page.syncLogs();
  assert.ok(page.getLogs().some((log) => log.text === "very early"), JSON.stringify(page.getLogs()));
});

test("what the runner would do with these logs", OPTIONS, async () => {
  page.clearLogs();
  await run(`() => { console.log("context"); setTimeout(() => { throw new Error("uncaught in test"); }, 0); }`);
  await new Promise((resolve) => setTimeout(resolve, 200));
  await page.syncLogs();

  const input = {
    entries: page.getLogs(),
    errors: page.pageErrors(),
    dropped: page.logsDropped,
    testFailed: false,
    allowPageErrors: page.pageErrorsAllowed,
  };
  const verdict = judgePageLogs({ ...input, config: { failOnPageError: true } });
  assert.match(verdict.error!.message, /^1 uncaught page error\(s\): .*uncaught in test/);
  assert.deepEqual(verdict.logs!.map((log) => log.text.replace(/^.*(context|uncaught in test).*$/, "$1")), ["context", "uncaught in test"]);
  assert.equal(judgePageLogs({ ...input, config: { failOnPageError: true, ignoreErrors: ["uncaught in test"] } }).error, undefined);
  assert.equal(judgePageLogs({ ...input, config: {} }).error, undefined);
});
