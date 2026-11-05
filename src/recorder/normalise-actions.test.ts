import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ElementHandle } from "../script/element-handle.js";
import type { LocatorSpec } from "../steps/model.js";
import { Normaliser, type Observation } from "./normalise.js";
import { observationFor, type PageMessage } from "./page-messages.js";

const loc = (testId: string): LocatorSpec => ({
  chain: [{ method: "getByTestId", testId }],
  fallbacks: [],
});

const click = (key: string, checked?: boolean): Observation => ({
  type: "click",
  key,
  locator: loc(key),
  textEntry: false,
  ...(checked !== undefined && { checked }),
});

const select = (
  key: string,
  option: Extract<Observation, { type: "select" }>["option"],
): Observation => ({ type: "select", key, locator: loc(key), option });

describe("Normaliser: check, uncheck and selectOption", () => {
  it("records a click that checks as check and one that unchecks as uncheck", () => {
    const n = new Normaliser({ at: 0 });
    assert.deepEqual(n.observe(click("box", true), 0), [
      { op: "insert", index: 0, step: { kind: "check", locator: loc("box") } },
    ]);
    assert.deepEqual(n.observe(click("box", false), 10), [
      {
        op: "insert",
        index: 1,
        step: { kind: "uncheck", locator: loc("box") },
      },
    ]);
  });

  it("records a click without a state as a click, as before", () => {
    const n = new Normaliser({ at: 0 });
    assert.deepEqual(n.observe(click("btn"), 0), [
      { op: "insert", index: 0, step: { kind: "click", locator: loc("btn") } },
    ]);
  });

  it("treats a navigation right after a check as its consequence", () => {
    const n = new Normaliser({ at: 0 });
    n.observe(click("box", true), 0);
    assert.deepEqual(n.navigated("http://x/y", 100), [
      { op: "insert", index: 1, step: { kind: "waitForNetworkIdle" } },
    ]);
  });

  it("records a select change as selectOption", () => {
    const n = new Normaliser({ at: 0 });
    assert.deepEqual(n.observe(select("country", { value: "nl" }), 0), [
      {
        op: "insert",
        index: 0,
        step: {
          kind: "selectOption",
          locator: loc("country"),
          option: { value: "nl" },
        },
      },
    ]);
  });

  it("folds the click that opened the select into the selectOption", () => {
    const n = new Normaliser({ at: 0 });
    n.observe(click("country"), 0);
    assert.deepEqual(n.observe(select("country", { label: "Belgium" }), 50), [
      {
        op: "replace",
        index: 0,
        step: {
          kind: "selectOption",
          locator: loc("country"),
          option: { label: "Belgium" },
        },
      },
    ]);
    assert.equal(n.nextIndex, 1);
  });

  it("keeps a click on another element, or an earlier one, when a select changes", () => {
    const other = new Normaliser({ at: 0 });
    other.observe(click("menu"), 0);
    assert.equal(
      other.observe(select("country", { index: 2 }), 50)[0]!.op,
      "insert",
    );
    const earlier = new Normaliser({ at: 0 });
    earlier.observe(click("country"), 0);
    earlier.observe(click("save"), 10);
    assert.equal(
      earlier.observe(select("country", { index: 2 }), 50)[0]!.op,
      "insert",
    );
  });

  it("does not fold the same click twice", () => {
    const n = new Normaliser({ at: 0 });
    n.observe(click("country"), 0);
    n.observe(select("country", { value: "a" }), 10);
    assert.equal(
      n.observe(select("country", { value: "b" }), 20)[0]!.op,
      "insert",
    );
  });
});

describe("page messages for the action steps", () => {
  const target = { sharedId: "node-1" } as ElementHandle;
  const message = (extra: Partial<PageMessage>): PageMessage => ({
    type: "click",
    target,
    candidates: [],
    ...extra,
  });

  it("carries the state a click leaves a checkbox in", () => {
    assert.deepEqual(observationFor(message({ checked: false }), loc("a")), {
      type: "click",
      key: "node-1",
      locator: loc("a"),
      textEntry: false,
      checked: false,
    });
    assert.equal("checked" in observationFor(message({}), loc("a")), false);
  });

  it("turns a select message into a select observation", () => {
    assert.deepEqual(
      observationFor(
        message({ type: "select", option: { value: "nl" } }),
        loc("a"),
      ),
      {
        type: "select",
        key: "node-1",
        locator: loc("a"),
        option: { value: "nl" },
      },
    );
  });
});
