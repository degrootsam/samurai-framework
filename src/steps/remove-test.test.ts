import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyEdit } from "./edit.js";
import { parseSpec } from "./parse.js";

const spec = `import { describe, test } from "@itmetsam/samurai-framework";

// Signs in first
test("logs in", async ({ page }) => {
  await page.goto("/login");
});

describe("cart", () => {
  test("adds an item", async ({ page }) => {
    await page.goto("/shop");
  });

  test("removes an item", async ({ page }) => {
    await page.goto("/cart");
  });
});

test("logs out", async ({ page }) => {
  await page.goto("/logout");
});
`;

/** Removes the named tests, from the highest index to the lowest so the indexes stay valid */
function removeTests(source: string, names: string[]): string {
  const indexes = names
    .map((name) => parseSpec(source).findIndex((t) => t.name === name))
    .sort((a, b) => b - a);
  return indexes.reduce(
    (next, test) => applyEdit(next, { op: "remove-test", test }),
    source,
  );
}

describe("remove-test", () => {
  it("removes a test with the comment above it, leaving the rest byte for byte", () => {
    assert.equal(
      removeTests(spec, ["logs in"]),
      spec.replace(
        `\n\n// Signs in first
test("logs in", async ({ page }) => {
  await page.goto("/login");
});`,
        "",
      ),
    );
  });

  it("removes several tests, inside and outside a describe", () => {
    const source = removeTests(spec, ["cart > removes an item", "logs out"]);
    assert.ok(!source.includes("removes an item"));
    assert.ok(!source.includes("logs out"));
    assert.ok(
      source.includes(`  test("adds an item", async ({ page }) => {
    await page.goto("/shop");
  });
});
`),
    );
    assert.ok(source.includes('test("logs in"'));
  });

  it("removes skipped and fixme tests, with or without a reason", () => {
    const marked = `import { test } from "@itmetsam/samurai-framework";

test.skip("old flow", async ({ page }) => {
  await page.goto("/old");
});

test.fixme("broken", { reason: "flaky on CI" }, async ({ page }) => {
  await page.goto("/broken");
});

test("kept", async ({ page }) => {
  await page.goto("/");
});
`;
    assert.equal(
      removeTests(marked, ["old flow", "broken"]),
      `import { test } from "@itmetsam/samurai-framework";

test("kept", async ({ page }) => {
  await page.goto("/");
});
`,
    );
  });

  it("removes the first test right after the imports", () => {
    const source = `import { test } from "samurai";
test("a", async ({ page }) => {
  await page.goto("/a");
});
test("b", async ({ page }) => {
  await page.goto("/b");
});
`;
    const [a] = parseSpec(source);
    const next = removeTests(source, ["a"]);
    assert.equal(next, source.slice(0, a!.start) + source.slice(a!.end));
    assert.deepEqual(
      parseSpec(next).map((t) => t.name),
      ["b"],
    );
  });

  it("removes the last test of a file without a trailing newline", () => {
    const source = `import { test } from "samurai";

test("a", async ({ page }) => {
  await page.goto("/a");
});

test("b", async ({ page }) => {
  await page.goto("/b");
});`;
    const b = parseSpec(source)[1]!;
    const next = removeTests(source, ["b"]);
    assert.equal(next, source.slice(0, b.start) + source.slice(b.end));
    assert.deepEqual(
      parseSpec(next).map((t) => t.name),
      ["a"],
    );
  });

  it("start and end cover the whole statement", () => {
    const t = parseSpec(spec).find((x) => x.name === "logs in")!;
    const text = spec.slice(t.start, t.end);
    assert.ok(text.startsWith('\n\n// Signs in first\ntest("'));
    assert.ok(text.endsWith("});"));
  });

  it("an unknown test index throws RangeError", () => {
    assert.throws(
      () => applyEdit(spec, { op: "remove-test", test: 99 }),
      RangeError,
    );
  });

  it("marks a normal test as removable", () => {
    assert.ok(parseSpec(spec).every((t) => t.removable));
  });

  const notStatements: [string, string][] = [
    [
      "a loop body without braces",
      'for (const u of users) test("logs in", async () => {});',
    ],
    [
      "an if body without braces",
      'if (process.env.SLOW) test("slow", async () => {});',
    ],
    [
      "an arrow's expression body",
      '["a"].forEach(() => test("each", async () => {}));',
    ],
  ];
  for (const [label, source] of notStatements) {
    it(`refuses to remove a test that is ${label}`, () => {
      const [found, ...rest] = parseSpec(source);
      assert.equal(rest.length, 0);
      assert.equal(found!.removable, false);
      assert.throws(
        () => applyEdit(source, { op: "remove-test", test: 0 }),
        (error: Error) =>
          !(error instanceof RangeError) &&
          error.message.includes(found!.name) &&
          error.message.includes("not a statement of its own"),
      );
    });
  }

  it("removes a test inside a braced loop body", () => {
    const source =
      'for (const u of users) {\n  test("logs in", async () => {});\n}\n';
    const [found] = parseSpec(source);
    assert.equal(found!.removable, true);
    assert.equal(
      applyEdit(source, { op: "remove-test", test: 0 }),
      "for (const u of users) {\n}\n",
    );
  });
});
