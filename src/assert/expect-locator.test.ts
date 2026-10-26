import { test } from "node:test";
import assert from "node:assert/strict";
import Locator from "../locator/locator.js";
import {
  remote,
  stubConnector,
  type StubResponse,
} from "../testing/stub-connector.js";
import { beginOutputs, endOutputs } from "../wait/output-sink.js";
import { expect, takePendingAssertions } from "./expect.js";
import { AssertionError } from "./assertion-error.js";

function locatorWith(xpath: string, ...responses: StubResponse[]) {
  const { connector, expressions, nodeCounts, calls } = stubConnector(
    ...responses,
  );
  return {
    locator: new Locator(xpath, connector, "ctx"),
    expressions,
    nodeCounts,
    calls,
  };
}

const text = (value: string): StubResponse => ({ type: "string", value });
const missing: StubResponse = { type: "null" };
/** The element state the visibility probe answers: `visible` or not */
const bool = (visible: boolean): StubResponse =>
  remote({
    attached: true,
    visible,
    enabled: true,
    editable: true,
    box: visible ? { x: 0, y: 0, width: 10, height: 10 } : null,
    hitTarget: null,
  });

test("toHaveText retries until the text matches", async () => {
  const { locator, expressions } = locatorWith(
    "h1",
    missing,
    missing,
    text("Contact"),
  );
  await expect(locator).toHaveText("Contact", { timeout: 2000 });
  assert.equal(expressions.length, 3);
});

test("times out with the last received value", async () => {
  const { locator } = locatorWith("h1", text("Loading"), text("Home"));
  const start = Date.now();
  await assert.rejects(
    expect(locator).toHaveText("Contact", { timeout: 250 }),
    (err) => {
      assert.ok(err instanceof AssertionError);
      assert.equal(err.matcher, "toHaveText");
      assert.equal(err.expected, "Contact");
      assert.equal(err.actual, "Home");
      assert.equal(err.locator, "//h1");
      return true;
    },
  );
  const elapsed = Date.now() - start;
  assert.ok(elapsed >= 245 && elapsed < 1000, `elapsed ${elapsed}ms`);
});

test("timeout 0 reads exactly once", async () => {
  const { locator, expressions } = locatorWith("h1", text("Home"));
  await assert.rejects(
    expect(locator).toHaveText("Contact", { timeout: 0 }),
    AssertionError,
  );
  assert.equal(expressions.length, 1);
});

test("read errors are rethrown without retrying", async () => {
  const { locator, expressions } = locatorWith("h1[", {
    exception: "SyntaxError",
  });
  await assert.rejects(
    expect(locator).toBeVisible({ timeout: 2000 }),
    (err) => {
      assert.ok(!(err instanceof AssertionError));
      assert.match((err as Error).message, /Failed to locate element/);
      return true;
    },
  );
  assert.equal(expressions.length, 1);
});

test("not.toBeVisible waits until the element is hidden", async () => {
  const { locator, expressions } = locatorWith("div", bool(true), bool(false));
  await expect(locator).not.toBeVisible({ timeout: 2000 });
  assert.equal(expressions.length, 2);
});

test("negated failure is named not.<matcher>", async () => {
  const { locator } = locatorWith("h1", text("Contact"));
  await assert.rejects(
    expect(locator).not.toHaveText("Contact", { timeout: 0 }),
    (err) => {
      assert.ok(err instanceof AssertionError);
      assert.equal(err.matcher, "not.toHaveText");
      return true;
    },
  );
});

test("toHaveText is exact, toContainText is a substring, both accept regexps", async () => {
  const { locator } = locatorWith("p", text("Hello world"));
  await assert.rejects(
    expect(locator).toHaveText("Hello", { timeout: 0 }),
    AssertionError,
  );
  await expect(locator).toContainText("Hello", { timeout: 0 });
  await expect(locator).toHaveText(/world$/, { timeout: 0 });
  await expect(locator).toContainText(/WORLD/i, { timeout: 0 });
});

test("a missing element never matches text", async () => {
  const { locator } = locatorWith("p", missing);
  await assert.rejects(
    expect(locator).toContainText("", { timeout: 0 }),
    (err) => {
      assert.ok(err instanceof AssertionError);
      assert.equal(err.actual, null);
      return true;
    },
  );
});

test("toHaveValue, toHaveAttribute and toHaveCount", async () => {
  await expect(locatorWith("input", text("test")).locator).toHaveValue("test", {
    timeout: 0,
  });
  await expect(locatorWith("a", text("/home")).locator).toHaveAttribute(
    "href",
    /home/,
    { timeout: 0 },
  );
  const three = locatorWith("li", missing);
  three.nodeCounts(3);
  await expect(three.locator).toHaveCount(3, { timeout: 0 });
  const two = locatorWith("li", missing);
  two.nodeCounts(2);
  await assert.rejects(
    expect(two.locator).toHaveCount(3, { timeout: 0 }),
    AssertionError,
  );
});

test("expect(value) still returns value matchers", () => {
  expect(1).toBe(1);
  assert.throws(() => expect("a").toBe("b"), AssertionError);
});

test("takePendingAssertions lists assertions that were not awaited", async () => {
  takePendingAssertions();
  const { locator } = locatorWith("div", bool(false));
  const pending = expect(locator).not.toBeVisible({ timeout: 200 });
  const failing = expect(locator).toBeVisible({ timeout: 200 });
  assert.deepEqual(takePendingAssertions(), [
    "expect(locator).not.toBeVisible()",
    "expect(locator).toBeVisible()",
  ]);
  assert.deepEqual(takePendingAssertions(), []);
  await pending;
  await assert.rejects(failing, AssertionError);
});

test("awaited assertions are not pending", async () => {
  takePendingAssertions();
  await expect(locatorWith("div", bool(true)).locator).toBeVisible({
    timeout: 0,
  });
  await assert.rejects(
    expect(locatorWith("div", bool(false)).locator).toBeVisible({ timeout: 0 }),
    AssertionError,
  );
  assert.deepEqual(takePendingAssertions(), []);
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test("an un-awaited assertion that already failed is still reported", async () => {
  takePendingAssertions();
  const { locator } = locatorWith("div", bool(false));
  expect(locator).toBeVisible({ timeout: 0 });
  // Let the single read finish and the assertion reject
  await settle();
  assert.deepEqual(takePendingAssertions(), ["expect(locator).toBeVisible()"]);
});

test("an un-awaited assertion that already passed is not reported", async () => {
  takePendingAssertions();
  const { locator } = locatorWith("div", bool(true));
  expect(locator).toBeVisible({ timeout: 0 });
  await settle();
  assert.deepEqual(takePendingAssertions(), []);
});

test("a failing assertion awaited through assert.rejects is not reported", async () => {
  takePendingAssertions();
  const failing = expect(locatorWith("div", bool(false)).locator).toBeVisible({
    timeout: 0,
  });
  await settle();
  await assert.rejects(failing, AssertionError);
  assert.deepEqual(takePendingAssertions(), []);
});

test("a failing assertion handled with .catch() is not reported", async () => {
  takePendingAssertions();
  let caught: unknown;
  expect(locatorWith("div", bool(false)).locator)
    .toBeVisible({ timeout: 0 })
    .catch((err) => {
      caught = err;
    });
  await settle();
  assert.ok(caught instanceof AssertionError);
  assert.deepEqual(takePendingAssertions(), []);
});

test("assertions handled with await, .then, .finally and Promise.all are not reported", async () => {
  takePendingAssertions();
  const pass = () =>
    expect(locatorWith("div", bool(true)).locator).toBeVisible({ timeout: 0 });
  const fail = () =>
    expect(locatorWith("div", bool(false)).locator).toBeVisible({ timeout: 0 });
  const failing = fail();
  await settle();
  try {
    await failing;
    assert.fail("expected a rejection");
  } catch (err) {
    assert.ok(err instanceof AssertionError);
  }
  await new Promise<void>((resolve) => {
    fail().then(undefined, () => resolve());
  });
  await assert.rejects(
    fail().finally(() => {}),
    AssertionError,
  );
  await Promise.all([pass(), pass()]);
  await assert.rejects(Promise.all([pass(), fail()]), AssertionError);
  assert.deepEqual(takePendingAssertions(), []);
});

const hang: StubResponse = { hang: true };
/** Fails a regression instead of hanging the suite */
const bounded = { timeout: 3000 };

test(
  "a read that never answers fails at the timeout with the last received value",
  bounded,
  async () => {
    const { locator, expressions } = locatorWith("h1", text("Home"), hang);
    const start = Date.now();
    await assert.rejects(
      expect(locator).toHaveText("Contact", { timeout: 200 }),
      (err) => {
        assert.ok(err instanceof AssertionError);
        assert.equal(err.matcher, "toHaveText");
        assert.equal(err.expected, "Contact");
        assert.equal(err.actual, "Home");
        assert.equal(err.locator, "//h1");
        return true;
      },
    );
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 195 && elapsed < 500, `elapsed ${elapsed}ms`);
    assert.equal(expressions.length, 2);
  },
);

test(
  "a first read that never answers fails at the timeout with a plain error",
  bounded,
  async () => {
    const { locator } = locatorWith("h1", hang);
    const start = Date.now();
    await assert.rejects(
      expect(locator).not.toBeVisible({ timeout: 200 }),
      (err) => {
        assert.ok(!(err instanceof AssertionError));
        assert.equal(
          (err as Error).message,
          "expect(locator).not.toBeVisible: could not read //h1 within 200ms",
        );
        return true;
      },
    );
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 195 && elapsed < 500, `elapsed ${elapsed}ms`);
  },
);

/** The element state the probe answers, with the given visibility and enabled flags */
const probed = (visible: boolean, enabled: boolean): StubResponse =>
  remote({
    attached: true,
    visible,
    enabled,
    editable: enabled,
    box: visible ? { x: 0, y: 0, width: 10, height: 10 } : null,
    hitTarget: null,
  });
const detached: StubResponse = remote({
  attached: false,
  visible: false,
  enabled: false,
  editable: false,
  box: null,
  hitTarget: null,
});
const flag = (value: boolean): StubResponse => remote(value);

test("toBeHidden passes on a missing and on a not visible element", async () => {
  await expect(locatorWith("div", detached).locator).toBeHidden({ timeout: 0 });
  await expect(locatorWith("div", probed(false, true)).locator).toBeHidden({
    timeout: 0,
  });
  await assert.rejects(
    expect(locatorWith("div", probed(true, true)).locator).toBeHidden({
      timeout: 0,
    }),
    (err) => {
      assert.ok(err instanceof AssertionError);
      assert.equal(err.matcher, "toBeHidden");
      return true;
    },
  );
});

test("not.toBeHidden retries until the element is visible", async () => {
  const { locator, expressions } = locatorWith(
    "div",
    detached,
    probed(false, true),
    probed(true, true),
  );
  await expect(locator).not.toBeHidden({ timeout: 2000 });
  assert.equal(expressions.length, 3);
});

test("toBeEnabled retries until the probe says enabled", async () => {
  const { locator, expressions } = locatorWith(
    "button",
    probed(true, false),
    probed(true, false),
    probed(true, true),
  );
  await expect(locator).toBeEnabled({ timeout: 2000 });
  assert.equal(expressions.length, 3);
});

test("not.toBeEnabled waits for a disabled element and fails as not.toBeEnabled", async () => {
  await expect(
    locatorWith("button", probed(true, true), probed(true, false)).locator,
  ).not.toBeEnabled({ timeout: 2000 });
  await assert.rejects(
    expect(locatorWith("button", probed(true, true)).locator).not.toBeEnabled({
      timeout: 0,
    }),
    (err) => {
      assert.ok(err instanceof AssertionError);
      assert.equal(err.matcher, "not.toBeEnabled");
      assert.equal(err.actual, true);
      return true;
    },
  );
});

test("toBeChecked and not.toBeChecked read the checked state", async () => {
  await expect(
    locatorWith("input", flag(false), flag(true)).locator,
  ).toBeChecked({ timeout: 2000 });
  await expect(locatorWith("input", flag(false)).locator).not.toBeChecked({
    timeout: 0,
  });
  await assert.rejects(
    expect(locatorWith("input", flag(false)).locator).toBeChecked({
      timeout: 0,
    }),
    (err) => {
      assert.ok(err instanceof AssertionError);
      assert.equal(err.matcher, "toBeChecked");
      assert.equal(err.actual, false);
      return true;
    },
  );
});

test("a missing element never satisfies toBeEnabled, toBeChecked, toHaveClass or toHaveCSS, even negated", async () => {
  const run = async (
    matcher: string,
    response: StubResponse,
    call: (assertions: any) => Promise<void>,
  ) => {
    for (const negated of [false, true]) {
      const { locator } = locatorWith("div", response);
      const assertions: any = expect(locator);
      await assert.rejects(
        call(negated ? assertions.not : assertions),
        (err) => {
          assert.ok(!(err instanceof AssertionError), matcher);
          assert.match(
            (err as Error).message,
            new RegExp(
              `expect\\(locator\\)\\.${negated ? "not\\." : ""}${matcher}: could not read .* within`,
            ),
          );
          return true;
        },
      );
    }
  };
  await run("toBeEnabled", detached, (a) => a.toBeEnabled({ timeout: 50 }));
  await run("toBeChecked", missing, (a) => a.toBeChecked({ timeout: 50 }));
  await run("toHaveClass", missing, (a) => a.toHaveClass("a", { timeout: 50 }));
  await run("toHaveCSS", missing, (a) =>
    a.toHaveCSS("color", "red", { timeout: 50 }),
  );
});

test("toHaveClass compares strings with whitespace collapsed and trimmed, regexps on the raw attribute", async () => {
  const { locator } = locatorWith("div", text(" a  b"));
  await expect(locator).toHaveClass("a  b ", { timeout: 0 });
  await expect(locator).toHaveClass("a b", { timeout: 0 });
  await expect(locator).not.toHaveClass("a", { timeout: 0 });
  await expect(locator).toHaveClass(/^ a {2}b$/, { timeout: 0 });
  await assert.rejects(
    expect(locator).toHaveClass(/^a/, { timeout: 0 }),
    (err) => {
      assert.ok(err instanceof AssertionError);
      assert.equal(err.matcher, "toHaveClass");
      assert.equal(err.actual, " a  b");
      return true;
    },
  );
});

test("toHaveCSS reads the kebab-case property of a camelCase name", async () => {
  const { locator, calls } = locatorWith("div", text("rgb(0, 0, 0)"));
  await expect(locator).toHaveCSS("backgroundColor", "rgb(0, 0, 0)", {
    timeout: 0,
  });
  await expect(locator).toHaveCSS("--Brand", /^rgb/, { timeout: 0 });
  await expect(locator).not.toHaveCSS("color", "red", { timeout: 0 });
  const names = calls
    .flatMap((call) => call.args)
    .filter((arg) => typeof arg === "string");
  assert.deepEqual(names, ["background-color", "--Brand", "color"]);
  await assert.rejects(
    expect(locator).toHaveCSS("color", "red", { timeout: 0 }),
    (err) => {
      assert.ok(err instanceof AssertionError);
      assert.equal(err.expected, "red");
      assert.equal(err.actual, "rgb(0, 0, 0)");
      return true;
    },
  );
});

/** Opens a sink for the test body and returns it with a cleanup */
function withSink(declared: string[]) {
  const sink = beginOutputs(declared);
  return { sink, done: () => endOutputs() };
}

test("toHaveText with output saves the first group, else the whole match", async () => {
  const { sink, done } = withSink(["o", "p", "q"]);
  try {
    await expect(locatorWith("p", text("Order #12345")).locator).toHaveText(
      /Order #(\d+)/,
      { timeout: 0, output: "o" },
    );
    await expect(locatorWith("p", text("Order #77")).locator).toHaveText(
      /Order #\d+/g,
      { timeout: 0, output: "p" },
    );
    await expect(locatorWith("p", text("Done")).locator).toHaveText("Done", {
      timeout: 0,
      output: "q",
    });
    assert.deepEqual(sink.values(), { o: "12345", p: "Order #77", q: "Done" });
  } finally {
    done();
  }
});

test("toContainText with a string saves the whole text", async () => {
  const { sink, done } = withSink(["o"]);
  try {
    await expect(locatorWith("p", text("Order placed")).locator).toContainText(
      "Order",
      { timeout: 0, output: "o" },
    );
    assert.deepEqual(sink.values(), { o: "Order placed" });
  } finally {
    done();
  }
});

test("toHaveValue and toHaveAttribute save the value that passed", async () => {
  const { sink, done } = withSink(["v", "a"]);
  try {
    await expect(
      locatorWith("input", missing, text("abc-42")).locator,
    ).toHaveValue(/abc-(\d+)/, { timeout: 1000, output: "v" });
    await expect(locatorWith("a", text("/home")).locator).toHaveAttribute(
      "href",
      "/home",
      { timeout: 0, output: "a" },
    );
    assert.deepEqual(sink.values(), { v: "42", a: "/home" });
  } finally {
    done();
  }
});

test("a failed check saves nothing", async () => {
  const { sink, done } = withSink(["o"]);
  try {
    await assert.rejects(
      expect(locatorWith("p", text("x")).locator).toHaveText("y", {
        timeout: 0,
        output: "o",
      }),
      AssertionError,
    );
    assert.deepEqual(sink.values(), {});
  } finally {
    done();
  }
});

test("output on a negated check throws", () => {
  const { done } = withSink(["o"]);
  try {
    assert.throws(
      () =>
        expect(locatorWith("p", text("x")).locator).not.toHaveText("a", {
          output: "o",
        }),
      {
        message:
          "expect(locator).not.toHaveText: output can't be saved from a negated check",
      },
    );
  } finally {
    done();
  }
});

test("output without a running test, or for an undeclared name, throws", () => {
  endOutputs();
  const { locator } = locatorWith("p", text("x"));
  assert.throws(() => expect(locator).toHaveText("x", { output: "o" }), {
    message:
      "expect(locator).toHaveText: output can only be saved inside a test",
  });
  const { done } = withSink(["o"]);
  try {
    assert.throws(() => expect(locator).toHaveValue("x", { output: "z" }), {
      message: 'expect(locator).toHaveValue: output "z" is not declared',
    });
  } finally {
    done();
  }
  assert.deepEqual(takePendingAssertions(), []);
});
