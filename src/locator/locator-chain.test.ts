import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Page from "../browser/page.js";
import { remote, stubConnector } from "../testing/stub-connector.js";
import { BiDiError } from "../transport/bidi-error.js";
import { ActionTimeoutError } from "./action-timeout-error.js";
import { UnsupportedOperationError } from "../transport/unsupported.js";
import { InvalidSelectorError } from "./selector-errors.js";
import { cssSelector, textSelector, xpathSelector } from "./selector.js";
import {
  chainWith,
  locateCommands,
  READY,
} from "../testing/locator-chain-support.js";

describe("chained locators", () => {
  it("search inside the previous step's matches, with scoped xpaths and css", async () => {
    const { locator, sent, nodeCounts } = chainWith("//form");
    nodeCounts(1, 2);
    const child = locator.locator("./input").getByCss("span.x");
    assert.equal(child.selector, "//form >> ./input >> css=span.x");
    assert.equal(await child.count(), 2);
    const [first, second, third] = locateCommands(sent);
    assert.deepEqual(first!.locator, { type: "xpath", value: "//form" });
    assert.equal(first!.startNodes, undefined);
    assert.deepEqual(second!.locator, { type: "xpath", value: "./input" });
    assert.deepEqual(second!.startNodes, [{ sharedId: "stub-node-0" }]);
    assert.deepEqual(third!.locator, { type: "css", value: "span.x" });
    assert.deepEqual(third!.startNodes, [
      { sharedId: "stub-node-0" },
      { sharedId: "stub-node-1" },
    ]);
  });

  it("make // relative to the parent match", async () => {
    const { locator, sent } = chainWith("//form");
    await locator.locator("//input").count();
    assert.deepEqual(locateCommands(sent)[1]!.locator, {
      type: "xpath",
      value: ".//input",
    });
  });

  it("stop at the first empty step", async () => {
    const { locator, sent, nodeCounts } = chainWith("//form");
    nodeCounts(0);
    assert.equal(await locator.getByCss("input").count(), 0);
    assert.equal(locateCommands(sent).length, 1);
  });

  it("limit only the final step to one node when a single element is needed", async () => {
    const { locator, sent } = chainWith("//form", remote("x"));
    await locator.getByCss("input").textContent();
    const [first, second] = locateCommands(sent);
    assert.equal(first!.maxNodeCount, undefined);
    assert.equal(second!.maxNodeCount, 1);
  });

  it("send the element found last to the page function", async () => {
    const { locator, calls } = chainWith("//form", remote("x"));
    await locator.getByCss("input").textContent();
    assert.deepEqual(calls[0]!.args[0], { sharedId: "stub-node-0" });
  });
});

describe("selector kinds", () => {
  it("getByCss, getByText and getByRole send the matching BiDi locators", async () => {
    const stub = stubConnector(remote(null));
    const page = new Page(stub.connector, "ctx");
    await page.getByCss("form.login input").count();
    await page.getByText("Sign in").count();
    await page.getByText("in", { match: "partial", ignoreCase: true }).count();
    await page.getByRole("button", { name: "Submit" }).count();
    await page.getByRole("link").count();
    assert.deepEqual(
      locateCommands(stub.sent).map((command) => command.locator),
      [
        { type: "css", value: "form.login input" },
        {
          type: "innerText",
          value: "Sign in",
          matchType: "full",
          ignoreCase: false,
        },
        {
          type: "innerText",
          value: "in",
          matchType: "partial",
          ignoreCase: true,
        },
        { type: "accessibility", value: { role: "button", name: "Submit" } },
        { type: "accessibility", value: { role: "link" } },
      ],
    );
  });

  it("are described in messages", () => {
    const stub = stubConnector(remote(null));
    const page = new Page(stub.connector, "ctx");
    assert.equal(page.getByCss("a.b").selector, "css=a.b");
    assert.equal(page.getByText("Hi").selector, 'text="Hi"');
    assert.equal(
      page.getByRole("button", { name: "Go" }).selector,
      'role=button[name="Go"]',
    );
    assert.equal(
      page.locator("//h1").getByRole("link").selector,
      "//h1 >> role=link",
    );
    assert.equal(
      page.locator("h1").getByRole("link").selector,
      "css=h1 >> role=link",
    );
  });

  it("reject empty arguments when built", () => {
    const stub = stubConnector(remote(null));
    const page = new Page(stub.connector, "ctx");
    assert.throws(() => page.getByCss(""), TypeError);
    assert.throws(() => page.getByText(""), TypeError);
    assert.throws(() => page.getByRole(""), TypeError);
  });

  it("actions report the described selector when they time out", async () => {
    const { locator, nodeCounts } = chainWith([
      cssSelector("form"),
      textSelector("Save"),
    ]);
    nodeCounts(0);
    await assert.rejects(locator.click({ timeout: 100 }), (err) => {
      assert.ok(err instanceof ActionTimeoutError);
      assert.match(
        err.message,
        /click\(\): css=form >> text="Save" was not attached within 100ms/,
      );
      return true;
    });
  });
});

describe("all() on non-xpath locators", () => {
  it("returns n-th locators that re-resolve the whole chain", async () => {
    const { locator, nodeCounts, sent } = chainWith([cssSelector("li")], READY);
    nodeCounts(3);
    const items = await locator.all();
    assert.deepEqual(
      items.map((item) => item.selector),
      ["css=li >> nth=0", "css=li >> nth=1", "css=li >> nth=2"],
    );
    nodeCounts(3, 3);
    await items[2]!.isEnabled();
    const last = locateCommands(sent).pop()!;
    assert.deepEqual(last.locator, { type: "css", value: "li" });
    assert.equal(
      last.maxNodeCount,
      3,
      "the step before nth fetches only index + 1 matches",
    );
  });

  it("an n-th locator whose index no longer exists is not attached", async () => {
    const { locator, nodeCounts } = chainWith([cssSelector("li")], READY);
    nodeCounts(3);
    const items = await locator.all();
    nodeCounts(1);
    assert.equal(await items[2]!.isEnabled(), false);
  });

  it("chained xpath locators use n-th too, xpath-only ones keep positional xpaths", async () => {
    const { locator, nodeCounts } = chainWith("//ul");
    nodeCounts(1, 2);
    const items = await locator.locator("li").all();
    assert.deepEqual(
      items.map((item) => item.selector),
      ["//ul >> css=li >> nth=0", "//ul >> css=li >> nth=1"],
    );
  });
});

describe("elements that are not there", () => {
  it("reads answer null or false without running a script", async () => {
    const { locator, nodeCounts, expressions } = chainWith([cssSelector("p")]);
    nodeCounts(0);
    assert.equal(await locator.textContent(), null);
    assert.equal(await locator.inputValue(), null);
    assert.equal(await locator.getAttribute("href"), null);
    assert.equal(await locator.isVisible(), false);
    assert.equal(await locator.isEnabled(), false);
    assert.equal(await locator.isEditable(), false);
    assert.equal(await locator.count(), 0);
    assert.equal(expressions.length, 0);
  });

  it("getBoundingClientRect and focus need the element", async () => {
    const { locator, nodeCounts } = chainWith([cssSelector("p")]);
    nodeCounts(0);
    await assert.rejects(
      locator.getBoundingClientRect(),
      /Failed to locate element css=p/,
    );
    await assert.rejects(
      locator.focus({ force: true, timeout: 50 }),
      ActionTimeoutError,
    );
  });

  it("a node that went away between the search and the read counts as missing", async () => {
    const { locator } = chainWith([cssSelector("p")], {
      error: "no such node",
    });
    assert.equal(await locator.textContent(), null);
    assert.equal(await locator.isVisible(), false);
  });

  it("a node that went away between the search and the probe is not attached", async () => {
    const { locator } = chainWith([cssSelector("p")], {
      error: "no such node",
    });
    assert.equal(await locator.isEnabled(), false);
  });

  it("other script errors from a read still surface", async () => {
    const { locator } = chainWith([cssSelector("p")], {
      error: "unknown error",
    });
    await assert.rejects(locator.textContent(), BiDiError);
  });
});

describe("locate errors", () => {
  it("an invalid selector is thrown immediately with the selector in the message", async () => {
    const { locator, failLocate, sent } = chainWith([cssSelector("a[")]);
    failLocate(
      new BiDiError(
        "browsingContext.locateNodes",
        "invalid selector",
        "bad css",
      ),
    );
    await assert.rejects(locator.click({ timeout: 2000 }), (err) => {
      assert.ok(err instanceof InvalidSelectorError);
      assert.equal(err.selector, "css=a[");
      assert.match(err.message, /Invalid selector css=a\[: .*bad css/);
      return true;
    });
    assert.equal(locateCommands(sent).length, 1, "not retried");
  });

  it("an unsupported locator type says so", async () => {
    const { locator, failLocate } = chainWith([xpathSelector("//a")]);
    failLocate(
      new BiDiError(
        "browsingContext.locateNodes",
        "unsupported operation",
        "no accessibility",
      ),
    );
    await assert.rejects(locator.count(), UnsupportedOperationError);
  });

  it("other locate failures are rethrown as they are", async () => {
    const { locator, failLocate } = chainWith("//a");
    failLocate(
      new BiDiError("browsingContext.locateNodes", "no such frame", "gone"),
    );
    await assert.rejects(locator.count(), { code: "no such frame" });
  });

  it("expect-style reads rethrow an invalid selector without waiting for the timeout", async () => {
    const { locator, failLocate } = chainWith([cssSelector("a[")]);
    failLocate(
      new BiDiError(
        "browsingContext.locateNodes",
        "invalid selector",
        "bad css",
      ),
    );
    const started = Date.now();
    await assert.rejects(
      locator.waitFor({ timeout: 3000 }),
      InvalidSelectorError,
    );
    assert.ok(Date.now() - started < 1000);
  });
});
