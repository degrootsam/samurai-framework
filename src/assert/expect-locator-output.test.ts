import { test } from "node:test";
import assert from "node:assert/strict";
import { beginOutputs, endOutputs } from "../wait/output-sink.js";
import { expect, takePendingAssertions } from "./expect.js";
import { AssertionError } from "./assertion-error.js";
import { locatorWith, missing, text } from "../testing/expect-locator-setup.js";

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
