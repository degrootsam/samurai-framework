import assert from "node:assert/strict";
import { test } from "node:test";
import { requestedBy } from "./fixture-args.js";

const names = (fn: (...args: never[]) => unknown) => {
  const r = requestedBy(fn);
  return r.kind === "names" ? r.names : "opaque";
};

test("reads the destructured names of arrows, functions and methods", () => {
  assert.deepEqual(
    names(async ({ page, user }: any) => [page, user]),
    ["page", "user"],
  );
  assert.deepEqual(
    names(async function ({ a }: any) {
      return a;
    }),
    ["a"],
  );
  const o = {
    async m({ x, y }: any, use: any) {
      return [x, y, use];
    },
  };
  assert.deepEqual(names(o.m), ["x", "y"]);
  assert.deepEqual(
    names(async ({}: any, use: any) => use),
    [],
  );
  assert.deepEqual(
    names(() => 1),
    [],
  );
});

test("handles renames, defaults, quoted keys and nested patterns", () => {
  assert.deepEqual(
    names(
      async ({ a: b, c = { d: 1, e: [2, 3] }, "f-g": h, i: { j } }: any) => [
        b,
        c,
        h,
        j,
      ],
    ),
    ["a", "c", "f-g", "i"],
  );
});

test("a rest entry asks for everything, a bare parameter for nothing", () => {
  const rest = requestedBy(async ({ a, ...others }: any) => [a, others]);
  assert.deepEqual(rest, { kind: "names", names: ["a"], rest: true });
  assert.equal(requestedBy(async (fixtures: any) => fixtures).kind, "opaque");
  assert.equal(requestedBy((fixtures: any) => fixtures).kind, "opaque");
  assert.equal(requestedBy(((x: number) => x) as any).kind, "opaque");
});
