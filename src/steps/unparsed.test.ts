import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSpec, parseSpecFile } from "./parse.js";

const summary = (source: string) => {
  const { tests, unparsed } = parseSpecFile(source);
  return {
    names: tests.map((t) => t.name),
    unparsed: unparsed.map(({ kind, reason }) => ({ kind, reason })),
  };
};

describe("parseSpecFile", () => {
  it("reports a template title with a substitution as a dynamic title", () => {
    assert.deepEqual(summary("test(`user ${i}`, async () => {});"), {
      names: [],
      unparsed: [{ kind: "test", reason: "dynamic-title" }],
    });
  });

  it("reports a variable title and a concatenated title as dynamic", () => {
    assert.deepEqual(summary("test(title, async () => {});").unparsed, [
      { kind: "test", reason: "dynamic-title" },
    ]);
    assert.deepEqual(summary('test("a" + b, async () => {});').unparsed, [
      { kind: "test", reason: "dynamic-title" },
    ]);
  });

  it("reports a callback that is not an inline block as not-inline", () => {
    assert.deepEqual(summary('test("x", runIt);'), {
      names: [],
      unparsed: [{ kind: "test", reason: "not-inline" }],
    });
    assert.deepEqual(summary('test("x", async () => doThing());'), {
      names: [],
      unparsed: [{ kind: "test", reason: "not-inline" }],
    });
  });

  it("reports an unreadable describe once and drops its inner tests", () => {
    assert.deepEqual(
      summary(
        'describe(`group ${n}`, () => { test("inner", async () => {}); });',
      ),
      { names: [], unparsed: [{ kind: "describe", reason: "dynamic-title" }] },
    );
    assert.deepEqual(summary('describe("d", setup);'), {
      names: [],
      unparsed: [{ kind: "describe", reason: "not-inline" }],
    });
  });

  it("leaves the in-body test.skip(condition, reason) alone", () => {
    const src = 'test("a", async () => {\n  test.skip(isCI, "slow");\n});';
    const { tests, unparsed } = parseSpecFile(src);
    assert.deepEqual(unparsed, []);
    assert.equal(tests[0]!.steps[0]!.step.kind, "custom");
  });

  it("reports test.skip with a literal title but a variable callback", () => {
    assert.deepEqual(summary('test.skip("x", runIt);').unparsed, [
      { kind: "test", reason: "not-inline" },
    ]);
  });

  it("reads a literal-titled test inside a for loop", () => {
    assert.deepEqual(
      summary('for (const u of users) test("logs in", async () => {});'),
      { names: ["logs in"], unparsed: [] },
    );
  });

  it("gives an unparsed test the range of its statement", () => {
    const src = "const a = 1;\n\ntest(title, async () => {});\n";
    const [entry] = parseSpecFile(src).unparsed;
    assert.equal(
      src.slice(entry!.start, entry!.end),
      "\n\ntest(title, async () => {});",
    );
  });

  it("makes parseSpec the tests of parseSpecFile", () => {
    const src = `describe.skip("Old", () => {
  test("a", async () => {});
});
test.only("b", async ({ page }) => {
  await page.goto("/b");
});
test.fixme("c", async () => {});
`;
    assert.deepEqual(parseSpec(src), parseSpecFile(src).tests);
  });
});
