import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Page from "../browser/page.js";
import {
  remote,
  stubConnector,
  type StubResponse,
} from "../testing/stub-connector.js";
import { BiDiError } from "../transport/bidi-error.js";
import { ActionTimeoutError } from "./action-timeout-error.js";
import Locator, {
  InvalidSelectorError,
  UnsupportedOperationError,
} from "./locator.js";
import { cssSelector, textSelector, xpathSelector } from "./selector.js";

type Sent = Array<{ method: string; params: unknown }>;
interface LocateParams {
  context: string;
  locator: unknown;
  maxNodeCount?: number;
  startNodes?: Array<{ sharedId: string }>;
}
const locateCommands = (sent: Sent) =>
  sent
    .filter(({ method }) => method === "browsingContext.locateNodes")
    .map(({ params }) => params as LocateParams);

const READY: StubResponse = remote({
  attached: true,
  visible: true,
  enabled: true,
  editable: true,
  box: { x: 0, y: 0, width: 10, height: 10 },
  hitTarget: "self",
});

function chainWith(
  steps: ConstructorParameters<typeof Locator>[0],
  ...responses: StubResponse[]
) {
  const stub = stubConnector(
    ...(responses.length ? responses : [remote(null)]),
  );
  return { locator: new Locator(steps, stub.connector, "ctx"), ...stub };
}

describe("chained locators", () => {
  it("search inside the previous step's matches, with scoped xpaths", async () => {
    const { locator, sent, nodeCounts } = chainWith("//form");
    nodeCounts(1, 2);
    const child = locator.locator("input").getByCss("span.x");
    assert.equal(child.selector, "//form >> .//input >> css=span.x");
    assert.equal(await child.count(), 2);
    const [first, second, third] = locateCommands(sent);
    assert.deepEqual(first!.locator, { type: "xpath", value: "//form" });
    assert.equal(first!.startNodes, undefined);
    assert.deepEqual(second!.locator, { type: "xpath", value: ".//input" });
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
      page.locator("h1").getByRole("link").selector,
      "//h1 >> role=link",
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
      undefined,
      "the step before nth must not be limited",
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
      ["//ul >> .//li >> nth=0", "//ul >> .//li >> nth=1"],
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

describe("text locators in a browser without the innerText locator", () => {
  const nodesOf = (...ids: string[]): StubResponse => ({
    type: "array",
    value: ids.map((sharedId) => ({ type: "node", sharedId }) as never),
  });

  it("try the native locator once, then search in the page", async () => {
    const { locator, unsupportedLocators, sent, calls } = chainWith(
      [textSelector("Sign in")],
      nodesOf("t1", "t2"),
    );
    unsupportedLocators("innerText");
    assert.equal(await locator.count(), 2);
    assert.equal(locateCommands(sent).length, 1, "the native attempt");
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]!.args, [[], "Sign in", "full", false]);
    assert.match(
      calls[0]!.functionDeclaration,
      /^\(starts, value, match, ignoreCase\) =>/,
    );
  });

  it("remember the answer for the connection, across locators", async () => {
    const stub = stubConnector(nodesOf("t1"));
    stub.unsupportedLocators("innerText");
    const page = new Page(stub.connector, "ctx");
    await page.getByText("a").count();
    await page.getByText("b", { match: "partial", ignoreCase: true }).count();
    assert.equal(
      locateCommands(stub.sent).length,
      1,
      "only the first locator asked the browser",
    );
    assert.deepEqual(stub.calls[1]!.args, [[], "b", "partial", true]);
  });

  it("pass the parent's matches as start nodes and honour the limit", async () => {
    const stub = stubConnector(nodesOf("t1", "t2", "t3"), remote("hello"));
    stub.unsupportedLocators("innerText");
    const parent = new Locator(
      [xpathSelector("//form"), textSelector("x")],
      stub.connector,
      "ctx",
    );
    assert.equal(await parent.textContent(), "hello");
    // the text step ran in the page with the form as its start node; only one element is needed
    assert.deepEqual(stub.calls[0]!.args[0], [{ sharedId: "stub-node-0" }]);
    assert.deepEqual(stub.calls[1]!.args[0], { sharedId: "t1" });
  });

  it("do not affect css, xpath or role locators", async () => {
    const stub = stubConnector(remote(null));
    stub.unsupportedLocators("innerText");
    const page = new Page(stub.connector, "ctx");
    await page.getByCss("a").count();
    await page.getByRole("button").count();
    assert.equal(locateCommands(stub.sent).length, 2);
    assert.equal(stub.calls.length, 0);
  });

  it("an unsupported role locator is reported, not searched for elsewhere", async () => {
    const stub = stubConnector(remote(null));
    stub.unsupportedLocators("accessibility");
    const page = new Page(stub.connector, "ctx");
    await assert.rejects(
      page.getByRole("button").count(),
      UnsupportedOperationError,
    );
  });

  it("a text search that throws in the page reads as a locate failure", async () => {
    const { locator, unsupportedLocators } = chainWith([textSelector("x")], {
      exception: "TypeError: boom",
    });
    unsupportedLocators("innerText");
    await assert.rejects(
      locator.count(),
      /Failed to locate element text="x"\. Details: TypeError: boom/,
    );
  });
});

describe("semantic locators", () => {
  it("getByTestId searches by data-testid; chained, it is scoped", async () => {
    const { locator, sent } = chainWith("//form");
    const child = locator.getByTestId("save");
    assert.equal(child.selector, '//form >> testid="save"');
    await child.count();
    assert.deepEqual(locateCommands(sent)[1]!.locator, {
      type: "css",
      value: '[data-testid="save"]',
    });
  });

  it("getByLabel searches in the page, inside the previous matches", async () => {
    const { locator, calls } = chainWith("//form", remote([]));
    assert.equal(
      await locator.getByLabel("Email", { match: "partial" }).count(),
      0,
    );
    assert.equal(
      locator.getByLabel("Email").selector,
      '//form >> label="Email"',
    );
    assert.match(
      calls[calls.length - 1]!.functionDeclaration,
      /aria-labelledby/,
    );
  });
});

describe("fallback locators", () => {
  function withStub(...responses: StubResponse[]) {
    const stub = stubConnector(
      ...(responses.length ? responses : [remote(null)]),
    );
    const make = (steps: ConstructorParameters<typeof Locator>[0]) =>
      new Locator(steps, stub.connector, "ctx");
    return { make, ...stub };
  }

  it("uses the primary when it matches, and says so", async () => {
    const { make, sent, nodeCounts } = withStub();
    nodeCounts(1);
    const locator = make([cssSelector("#a")]).withFallbacks(
      make([cssSelector("#b")]),
    );
    assert.equal(await locator.count(), 1);
    assert.equal(locateCommands(sent).length, 1);
    assert.deepEqual(locator.matchedBy, { index: 0, selector: "css=#a" });
  });

  it("tries the fallbacks in order when the primary matches nothing", async () => {
    const { make, sent, nodeCounts } = withStub();
    nodeCounts(0, 0, 2);
    const locator = make([cssSelector("#a")]).withFallbacks(
      make([cssSelector("#b")]),
      make([cssSelector("#c")]),
    );
    assert.equal(await locator.count(), 2);
    assert.deepEqual(
      locateCommands(sent).map(({ locator }) => locator),
      [
        { type: "css", value: "#a" },
        { type: "css", value: "#b" },
        { type: "css", value: "#c" },
      ],
    );
    assert.deepEqual(locator.matchedBy, { index: 2, selector: "css=#c" });
  });

  it("matches nothing when no alternative does, and names every one in errors", async () => {
    const { make, nodeCounts } = withStub();
    nodeCounts(0);
    const locator = make([cssSelector("#a")]).withFallbacks(
      make([cssSelector("#b")]),
    );
    assert.equal(await locator.count(), 0);
    assert.equal(locator.matchedBy, undefined);
    assert.equal(locator.selector, "css=#a or css=#b");
    await assert.rejects(locator.click({ timeout: 0 }), /css=#a or css=#b/);
  });

  it("chained steps apply to every alternative", async () => {
    const { make, sent, nodeCounts } = withStub();
    nodeCounts(0, 1, 1);
    const locator = make([cssSelector("#a")])
      .withFallbacks(make([cssSelector("#b")]))
      .getByCss("input");
    assert.equal(
      locator.selector,
      "css=#a >> css=input or css=#b >> css=input",
    );
    assert.equal(await locator.count(), 1);
    assert.deepEqual(locator.matchedBy, {
      index: 1,
      selector: "css=#b >> css=input",
    });
    assert.equal(locateCommands(sent).length, 3);
  });

  it("all() pins to the alternative that matches", async () => {
    const { make, nodeCounts } = withStub();
    nodeCounts(0, 2, 2, 2);
    const locator = make([cssSelector("#a")]).withFallbacks(
      make([cssSelector("#b")]),
    );
    const all = await locator.all();
    assert.deepEqual(
      all.map((one) => one.selector),
      ["css=#b >> nth=0", "css=#b >> nth=1"],
    );
  });
});
