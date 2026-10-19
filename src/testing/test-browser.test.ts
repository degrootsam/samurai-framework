import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  browserConfig,
  browserTests,
  testBrowser,
  type TestRegistrar,
} from "./test-browser.js";

describe("testBrowser", () => {
  it("is Firefox unless SAMURAI_TEST_BROWSER says otherwise", () => {
    assert.equal(testBrowser({}), "firefox");
    assert.equal(testBrowser({ SAMURAI_TEST_BROWSER: "chrome" }), "chrome");
    assert.equal(testBrowser({ SAMURAI_TEST_BROWSER: "firefox" }), "firefox");
  });

  it("refuses an unknown browser", () => {
    assert.throws(
      () => testBrowser({ SAMURAI_TEST_BROWSER: "edge" }),
      /Unknown SAMURAI_TEST_BROWSER "edge"\. Choose firefox or chrome\./,
    );
  });

  it("browserConfig puts it into a project config", () => {
    assert.deepEqual(browserConfig("chrome"), { browsers: ["chrome"] });
  });
});

function fake(current: "firefox" | "chrome") {
  const calls: Array<{ kind: "run" | "skip"; name: string; args: number }> = [];
  const registrar = Object.assign(
    (name: string, ...body: unknown[]) =>
      calls.push({ kind: "run", name, args: body.length }),
    {
      skip: (name: string, ...body: unknown[]) =>
        calls.push({ kind: "skip", name, args: body.length }),
    },
  ) as unknown as TestRegistrar;
  return { calls, ...browserTests(registrar, current) };
}

describe("onlyOn / skipOn", () => {
  it("onlyOn runs on its browser", () => {
    const { calls, onlyOn } = fake("firefox");
    onlyOn("firefox", "why", "a", () => {});
    assert.deepEqual(calls, [{ kind: "run", name: "a", args: 1 }]);
  });

  it("onlyOn is reported as skipped, with the reason, on the other browser", () => {
    const { calls, onlyOn } = fake("chrome");
    onlyOn("firefox", "Firefox limit", "a", () => {});
    assert.deepEqual(calls, [
      { kind: "skip", name: "a (skipped on chrome: Firefox limit)", args: 1 },
    ]);
  });

  it("skipOn runs everywhere but on its browser, where it is skipped with the reason", () => {
    const onFirefox = fake("firefox");
    onFirefox.skipOn("chrome", "needs X", "b", () => {});
    const onChrome = fake("chrome");
    onChrome.skipOn("chrome", "needs X", "b", () => {});
    assert.deepEqual(onFirefox.calls, [{ kind: "run", name: "b", args: 1 }]);
    assert.deepEqual(onChrome.calls, [
      { kind: "skip", name: "b (skipped on chrome: needs X)", args: 1 },
    ]);
  });

  it("passes node:test options through", () => {
    const { calls, onlyOn } = fake("firefox");
    onlyOn("firefox", "why", "a", { timeout: 5 }, () => {});
    assert.equal(calls[0]!.args, 2);
  });
});
