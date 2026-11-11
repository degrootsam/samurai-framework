import { test } from "node:test";
import assert from "node:assert/strict";
import { remote, type StubResponse } from "../testing/stub-connector.js";
import { expect } from "./expect.js";
import { AssertionError } from "./assertion-error.js";
import { locatorWith, missing, text } from "../testing/expect-locator-setup.js";

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

test("toHaveAccessibleName and toHaveAccessibleDescription compare normalised strings and RegExps as written", async () => {
  const { locator } = locatorWith("button", text(" Save   draft "));
  await expect(locator).toHaveAccessibleName("Save draft", { timeout: 0 });
  await expect(locator).toHaveAccessibleName(/^ Save {3}draft $/, {
    timeout: 0,
  });
  await expect(locator).not.toHaveAccessibleName("Save", { timeout: 0 });
  await expect(locator).toHaveAccessibleDescription("Save draft", {
    timeout: 0,
  });
  await assert.rejects(
    expect(locator).toHaveAccessibleName("Other", { timeout: 0 }),
    (err) => {
      assert.ok(err instanceof AssertionError);
      assert.equal(err.matcher, "toHaveAccessibleName");
      assert.equal(err.expected, "Other");
      assert.equal(err.actual, " Save   draft ");
      return true;
    },
  );
});

test("a missing element never satisfies toHaveAccessibleName or toHaveAccessibleDescription, even negated", async () => {
  for (const matcher of [
    "toHaveAccessibleName",
    "toHaveAccessibleDescription",
  ]) {
    for (const negated of [false, true]) {
      const { locator } = locatorWith("div", missing);
      const assertions: any = expect(locator);
      await assert.rejects(
        (negated ? assertions.not : assertions)[matcher]("x", { timeout: 50 }),
        (err) => {
          assert.ok(!(err instanceof AssertionError), matcher);
          assert.match((err as Error).message, /could not read .* within/);
          return true;
        },
      );
    }
  }
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
