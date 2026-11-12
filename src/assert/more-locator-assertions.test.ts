import assert from "node:assert/strict";
import { test } from "node:test";
import Locator from "../locator/locator.js";
import { xpathSelector } from "../locator/selector.js";
import {
  remote,
  stubConnector,
  type StubResponse,
} from "../testing/stub-connector.js";
import { AssertionError } from "./assertion-error.js";
import { expect, takePendingAssertions } from "./expect.js";

function locatorWith(...responses: StubResponse[]) {
  const stub = stubConnector(...responses);
  return {
    locator: new Locator([xpathSelector("div")], stub.connector, "ctx"),
    ...stub,
  };
}

const NOW = { timeout: 0 };
const missing: StubResponse = { type: "null" };
const state = (enabled: boolean, editable = enabled): StubResponse =>
  remote({
    attached: true,
    visible: true,
    enabled,
    editable,
    box: { x: 0, y: 0, width: 10, height: 10 },
    hitTarget: null,
  });

/** The assertion fails with an AssertionError of this matcher */
async function fails(promise: Promise<void>, matcher: string) {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof AssertionError, String(err));
    assert.equal(err.matcher, matcher);
    return true;
  });
}

test("toBeFocused passes, fails, negates and needs the element", async () => {
  await expect(locatorWith(remote(true)).locator).toBeFocused(NOW);
  await fails(
    expect(locatorWith(remote(false)).locator).toBeFocused(NOW),
    "toBeFocused",
  );
  await expect(locatorWith(remote(false)).locator).not.toBeFocused(NOW);
  await fails(
    expect(locatorWith(remote(true)).locator).not.toBeFocused(NOW),
    "not.toBeFocused",
  );
  await assert.rejects(
    expect(locatorWith(missing).locator).not.toBeFocused(NOW),
    /could not read/,
  );
});

test("toBeFocused retries until the element has the focus", async () => {
  const { locator, expressions } = locatorWith(
    remote(false),
    remote(false),
    remote(true),
  );
  await expect(locator).toBeFocused({ timeout: 2000 });
  assert.equal(expressions.length, 3);
});

test("toHaveJSProperty compares primitives and objects deeply", async () => {
  await expect(locatorWith(remote({ value: 3 })).locator).toHaveJSProperty(
    "count",
    3,
    NOW,
  );
  await expect(
    locatorWith(remote({ value: { a: [1, 2] } })).locator,
  ).toHaveJSProperty("data", { a: [1, 2] }, NOW);
  await expect(locatorWith(remote({ value: 3 })).locator).not.toHaveJSProperty(
    "count",
    4,
    NOW,
  );
  await assert.rejects(
    expect(locatorWith(remote({ value: 3 })).locator).toHaveJSProperty(
      "count",
      4,
      NOW,
    ),
    (err) => {
      assert.ok(err instanceof AssertionError);
      assert.equal(err.matcher, "toHaveJSProperty");
      assert.equal(err.expected, 4);
      assert.equal(err.actual, 3);
      return true;
    },
  );
});

test("toHaveJSProperty passes the property name to the page and needs the element", async () => {
  const { locator, calls } = locatorWith(remote({ value: true }));
  await expect(locator).toHaveJSProperty("hidden", true, NOW);
  assert.equal(calls[0]!.args[1], "hidden");
  await assert.rejects(
    expect(locatorWith(missing).locator).toHaveJSProperty("x", 1, NOW),
    /could not read/,
  );
});

test("toBeInViewport reads the intersection ratio", async () => {
  await expect(locatorWith(remote(1)).locator).toBeInViewport(NOW);
  await expect(locatorWith(remote(0.2)).locator).toBeInViewport(NOW);
  await fails(
    expect(locatorWith(remote(0)).locator).toBeInViewport(NOW),
    "toBeInViewport",
  );
  await expect(locatorWith(remote(0)).locator).not.toBeInViewport(NOW);
  await expect(locatorWith(remote(0.6)).locator).toBeInViewport({
    ratio: 0.5,
    timeout: 0,
  });
  await fails(
    expect(locatorWith(remote(0.3)).locator).toBeInViewport({
      ratio: 0.5,
      timeout: 0,
    }),
    "toBeInViewport",
  );
  await expect(locatorWith(remote(1)).locator).toBeInViewport({
    ratio: 1,
    timeout: 0,
  });
  await assert.rejects(
    expect(locatorWith(missing).locator).toBeInViewport(NOW),
    /could not read/,
  );
});

test("toBeAttached counts matches; not is detached", async () => {
  const one = locatorWith(remote(null));
  await expect(one.locator).toBeAttached(NOW);
  await expect(one.locator).toBeAttached({ attached: true, timeout: 0 });
  const none = locatorWith(remote(null));
  none.nodeCounts(0);
  await fails(expect(none.locator).toBeAttached(NOW), "toBeAttached");
  await expect(none.locator).not.toBeAttached(NOW);
  await expect(none.locator).toBeAttached({ attached: false, timeout: 0 });
  await fails(
    expect(one.locator).toBeAttached({ attached: false, timeout: 0 }),
    "toBeAttached",
  );
});

test("toBeAttached waits for the element to appear", async () => {
  const stub = locatorWith(remote(null));
  stub.nodeCounts(0, 0, 1);
  await expect(stub.locator).toBeAttached({ timeout: 2000 });
});

test("toBeDisabled and toBeEnabled({ enabled })", async () => {
  await expect(locatorWith(state(false)).locator).toBeDisabled(NOW);
  await fails(
    expect(locatorWith(state(true)).locator).toBeDisabled(NOW),
    "toBeDisabled",
  );
  await expect(locatorWith(state(true)).locator).not.toBeDisabled(NOW);
  await expect(locatorWith(state(false)).locator).toBeEnabled({
    enabled: false,
    timeout: 0,
  });
  await fails(
    expect(locatorWith(state(true)).locator).toBeEnabled({
      enabled: false,
      timeout: 0,
    }),
    "toBeEnabled",
  );
  await expect(locatorWith(state(true)).locator).toBeEnabled({
    enabled: true,
    timeout: 0,
  });
});

test("toBeDisabled needs the element, even with not", async () => {
  const detached = remote({
    attached: false,
    visible: false,
    enabled: false,
    editable: false,
    box: null,
    hitTarget: null,
  });
  await assert.rejects(
    expect(locatorWith(detached).locator).toBeDisabled(NOW),
    /could not read/,
  );
  await assert.rejects(
    expect(locatorWith(detached).locator).not.toBeDisabled(NOW),
    /could not read/,
  );
});

test("toBeEditable uses the editable state", async () => {
  await expect(locatorWith(state(true)).locator).toBeEditable(NOW);
  await fails(
    expect(locatorWith(state(true, false)).locator).toBeEditable(NOW),
    "toBeEditable",
  );
  await expect(locatorWith(state(true, false)).locator).not.toBeEditable(NOW);
  await expect(locatorWith(state(true, false)).locator).toBeEditable({
    editable: false,
    timeout: 0,
  });
  const none = locatorWith(state(true));
  none.nodeCounts(0);
  await assert.rejects(
    expect(none.locator).toBeEditable(NOW),
    /could not read/,
  );
});

test("toHaveId equals a string or matches a RegExp", async () => {
  await expect(locatorWith(remote("main")).locator).toHaveId("main", NOW);
  await expect(locatorWith(remote("main-1")).locator).toHaveId(/^main/, NOW);
  await expect(locatorWith(remote("main")).locator).not.toHaveId("other", NOW);
  await fails(
    expect(locatorWith(remote("main")).locator).toHaveId("other", NOW),
    "toHaveId",
  );
  await fails(
    expect(locatorWith(remote("")).locator).toHaveId("main", NOW),
    "toHaveId",
  );
  await expect(locatorWith(remote("")).locator).toHaveId("", NOW);
  await assert.rejects(
    expect(locatorWith(missing).locator).toHaveId("main", NOW),
    /could not read/,
  );
});

test("toBeEmpty reads the page's answer and needs the element", async () => {
  await expect(locatorWith(remote(true)).locator).toBeEmpty(NOW);
  await fails(
    expect(locatorWith(remote(false)).locator).toBeEmpty(NOW),
    "toBeEmpty",
  );
  await expect(locatorWith(remote(false)).locator).not.toBeEmpty(NOW);
  await assert.rejects(
    expect(locatorWith(missing).locator).not.toBeEmpty(NOW),
    /could not read/,
  );
});

test("toHaveAttribute with one argument checks that the attribute exists", async () => {
  await expect(locatorWith(remote("")).locator).toHaveAttribute("hidden", NOW);
  await expect(locatorWith(remote("x")).locator).toHaveAttribute("href", NOW);
  await fails(
    expect(locatorWith(missing).locator).toHaveAttribute("href", NOW),
    "toHaveAttribute",
  );
  await expect(locatorWith(missing).locator).not.toHaveAttribute("href", NOW);
  await fails(
    expect(locatorWith(remote("")).locator).not.toHaveAttribute("hidden", NOW),
    "not.toHaveAttribute",
  );
  // The two-argument form is unchanged
  await expect(locatorWith(remote("/home")).locator).toHaveAttribute(
    "href",
    "/home",
    NOW,
  );
});

test("toBeChecked({ checked }) accepts true, false and mixed", async () => {
  await expect(locatorWith(remote(true)).locator).toBeChecked({
    checked: true,
    timeout: 0,
  });
  await expect(locatorWith(remote(false)).locator).toBeChecked({
    checked: false,
    timeout: 0,
  });
  await fails(
    expect(locatorWith(remote(true)).locator).toBeChecked({
      checked: false,
      timeout: 0,
    }),
    "toBeChecked",
  );
  await expect(locatorWith(remote("mixed")).locator).toBeChecked({
    checked: "mixed",
    timeout: 0,
  });
  await expect(locatorWith(remote("mixed")).locator).toBeChecked({
    indeterminate: true,
    timeout: 0,
  });
  await expect(locatorWith(remote(false)).locator).not.toBeChecked({
    checked: true,
    timeout: 0,
  });
  await fails(
    expect(locatorWith(remote(true)).locator).toBeChecked({
      checked: "mixed",
      timeout: 0,
    }),
    "toBeChecked",
  );
  await assert.rejects(
    expect(locatorWith(missing).locator).toBeChecked({
      checked: false,
      timeout: 0,
    }),
    /could not read/,
  );
});

test("toBeVisible({ visible: false }) behaves like toBeHidden", async () => {
  const detached = remote({
    attached: false,
    visible: false,
    enabled: false,
    editable: false,
    box: null,
    hitTarget: null,
  });
  await expect(locatorWith(detached).locator).toBeVisible({
    visible: false,
    timeout: 0,
  });
  await expect(locatorWith(state(true)).locator).toBeVisible({
    visible: true,
    timeout: 0,
  });
  await fails(
    expect(locatorWith(state(true)).locator).toBeVisible({
      visible: false,
      timeout: 0,
    }),
    "toBeVisible",
  );
});

test("toHaveText and toContainText collapse whitespace in a string", async () => {
  const body = remote("Hello \n  big   world");
  await expect(locatorWith(body).locator).toHaveText("Hello big world", NOW);
  await expect(locatorWith(body).locator).toHaveText("  Hello big world ", NOW);
  await expect(locatorWith(body).locator).toContainText("big world", NOW);
  await expect(locatorWith(body).locator).toContainText("Hello  big", NOW);
  await expect(locatorWith(body).locator).not.toHaveText("Hello big", NOW);
  // A RegExp still tests the text as the page has it (trimmed)
  await expect(locatorWith(body).locator).toHaveText(/Hello \n {2}big/, NOW);
});

test("toHaveText with an array compares one entry per element, in order", async () => {
  const items = remote([" One ", "Two\n words", "Three"]);
  await expect(locatorWith(items).locator).toHaveText(
    ["One", "Two words", /^Th/],
    NOW,
  );
  await fails(
    expect(locatorWith(items).locator).toHaveText(["One", "Two"], NOW),
    "toHaveText",
  );
  await fails(
    expect(locatorWith(items).locator).toHaveText(
      ["One", "Two words", "Four"],
      NOW,
    ),
    "toHaveText",
  );
  await expect(locatorWith(items).locator).not.toHaveText(["One", "Two"], NOW);
  await expect(locatorWith(remote([])).locator).toHaveText([], NOW);
  await assert.rejects(
    expect(locatorWith(remote([])).locator).toHaveText(["One"], NOW),
    (err) => {
      assert.ok(err instanceof AssertionError);
      assert.deepEqual(err.actual, []);
      return true;
    },
  );
});

test("toContainText with an array finds the entries in order among the elements", async () => {
  const items = remote(["Text 1", "Text 2", "Text 3", "Text 4"]);
  await expect(locatorWith(items).locator).toContainText(
    ["Text 1", "Text 3", "Text 4"],
    NOW,
  );
  await expect(locatorWith(items).locator).toContainText(["xt 2", /3$/], NOW);
  await fails(
    expect(locatorWith(items).locator).toContainText(["Text 3", "Text 1"], NOW),
    "toContainText",
  );
  await expect(locatorWith(items).locator).not.toContainText(
    ["Text 3", "Text 1"],
    NOW,
  );
});

test("an array of text can't save an output", () => {
  assert.throws(
    () =>
      expect(locatorWith(remote(["a"])).locator).toHaveText(["a"], {
        output: "x",
      }),
    /output can’t be saved/,
  );
});

test("the new matchers are tracked until awaited", async () => {
  takePendingAssertions();
  const pending = expect(locatorWith(remote(true)).locator).toBeFocused({
    timeout: 500,
  });
  const arrayed = expect(locatorWith(remote(["a"])).locator).toHaveText(["a"], {
    timeout: 500,
  });
  assert.deepEqual(takePendingAssertions(), [
    "expect(locator).toBeFocused()",
    "expect(locator).toHaveText()",
  ]);
  await pending;
  await arrayed;
});
