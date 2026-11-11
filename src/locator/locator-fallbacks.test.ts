import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Page from "../browser/page.js";
import {
  remote,
  stubConnector,
  type StubResponse,
} from "../testing/stub-connector.js";
import Locator from "./locator.js";
import { UnsupportedOperationError } from "../transport/unsupported.js";
import { cssSelector, textSelector, xpathSelector } from "./selector.js";
import { chainWith, locateCommands } from "../testing/locator-chain-support.js";

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

describe("page-side text matching", () => {
  it("a RegExp text and the attribute locators run in the page, not as a BiDi locator", async () => {
    const stub = stubConnector(remote([]));
    const page = new Page(stub.connector, "ctx");
    assert.equal(await page.getByText(/go/i).count(), 0);
    assert.equal(await page.getByPlaceholder("Name").count(), 0);
    assert.equal(await page.getByAltText(/logo/).count(), 0);
    assert.equal(await page.getByTitle("Close", { exact: false }).count(), 0);
    assert.equal(locateCommands(stub.sent).length, 0);
    assert.equal(stub.calls.length, 4);
    assert.match(
      stub.calls[1]!.functionDeclaration,
      /querySelectorAll\("\[" \+ attribute/,
    );
    assert.equal(page.getByPlaceholder("Name").selector, 'placeholder="Name"');
  });

  it("exact:false text still goes to the browser's innerText locator, as a partial case-insensitive match", async () => {
    const stub = stubConnector(remote(null));
    const page = new Page(stub.connector, "ctx");
    await page.getByText("go", { exact: false }).count();
    assert.deepEqual(locateCommands(stub.sent)[0]!.locator, {
      type: "innerText",
      value: "go",
      matchType: "partial",
      ignoreCase: true,
    });
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
