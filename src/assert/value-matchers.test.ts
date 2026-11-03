import assert from "node:assert/strict";
import { test } from "node:test";
import { AssertionError } from "./assertion-error.js";
import { expect } from "./expect.js";

function fails(fn: () => void, matcher: string) {
  assert.throws(fn, (err) => {
    assert.ok(err instanceof AssertionError, String(err));
    assert.equal(err.matcher, matcher);
    return true;
  });
}

test("toBeNull, toBeUndefined, toBeDefined", () => {
  expect(null).toBeNull();
  fails(() => expect(undefined).toBeNull(), "toBeNull");
  expect(1).not.toBeNull();
  expect(undefined).toBeUndefined();
  fails(() => expect(null).toBeUndefined(), "toBeUndefined");
  expect(0).toBeDefined();
  expect(null).toBeDefined();
  fails(() => expect(undefined).toBeDefined(), "toBeDefined");
  expect(undefined).not.toBeDefined();
  fails(() => expect(1).not.toBeDefined(), "not.toBeDefined");
});

test("toHaveLength reads length of strings, arrays and array-likes", () => {
  expect([1, 2]).toHaveLength(2);
  expect("abc").toHaveLength(3);
  expect({ length: 1 }).toHaveLength(1);
  expect([1]).not.toHaveLength(2);
  assert.throws(
    () => expect([1, 2]).toHaveLength(3),
    (err) => {
      assert.ok(err instanceof AssertionError);
      assert.equal(err.expected, 3);
      assert.equal(err.actual, 2);
      return true;
    },
  );
  assert.throws(() => expect(5).toHaveLength(1), TypeError);
  assert.throws(() => expect(null).toHaveLength(1), TypeError);
});

test("toBeCloseTo uses two digits by default", () => {
  expect(0.1 + 0.2).toBeCloseTo(0.3);
  expect(1.004).toBeCloseTo(1);
  fails(() => expect(1.006).toBeCloseTo(1), "toBeCloseTo");
  expect(1.04).toBeCloseTo(1, 1);
  fails(() => expect(1.06).toBeCloseTo(1, 1), "toBeCloseTo");
  expect(1.06).not.toBeCloseTo(1, 1);
  expect(Infinity).toBeCloseTo(Infinity);
  expect(5).toBeCloseTo(5, 0);
  assert.throws(() => expect("1").toBeCloseTo(1), TypeError);
});

test("toBeInstanceOf", () => {
  class A {}
  class B extends A {}
  expect(new B()).toBeInstanceOf(A);
  expect([]).toBeInstanceOf(Array);
  fails(() => expect(new A()).toBeInstanceOf(B), "toBeInstanceOf");
  expect(new A()).not.toBeInstanceOf(B);
  assert.throws(() => expect(1).toBeInstanceOf(1 as never), TypeError);
});

test("toThrow matches nothing, a message, a RegExp, a class or an error", () => {
  const boom = () => {
    throw new RangeError("bad value 42");
  };
  expect(boom).toThrow();
  expect(boom).toThrow("bad value");
  expect(boom).toThrow(/value \d+/);
  expect(boom).toThrow(RangeError);
  expect(boom).toThrow(Error);
  expect(boom).toThrow(new RangeError("bad value 42"));
  fails(() => expect(boom).toThrow("other"), "toThrow");
  fails(() => expect(boom).toThrow(TypeError), "toThrow");
  fails(() => expect(boom).toThrow(/nope/), "toThrow");
  fails(() => expect(() => 1).toThrow(), "toThrow");
  expect(() => 1).not.toThrow();
  expect(boom).not.toThrow(TypeError);
  expect(boom).not.toThrow("other");
  fails(() => expect(boom).not.toThrow(), "not.toThrow");
  fails(() => expect(boom).not.toThrow(RangeError), "not.toThrow");
  assert.throws(() => expect(1).toThrow(), TypeError);
});

test("toThrow accepts a thrown non-error", () => {
  expect(() => {
    throw "text";
  }).toThrow("text");
});

test("toMatchObject compares a subset, recursively", () => {
  expect({ a: 1, b: { c: 2, d: 3 }, e: [1, 2] }).toMatchObject({
    a: 1,
    b: { c: 2 },
  });
  expect({ e: [{ x: 1, y: 2 }] }).toMatchObject({ e: [{ x: 1 }] });
  fails(() => expect({ a: 1 }).toMatchObject({ a: 2 }), "toMatchObject");
  fails(() => expect({ a: 1 }).toMatchObject({ b: 1 }), "toMatchObject");
  fails(
    () => expect({ e: [1, 2, 3] }).toMatchObject({ e: [1, 2] }),
    "toMatchObject",
  );
  expect({ a: 1 }).not.toMatchObject({ a: 2 });
  expect([{ a: 1, b: 2 }, { c: 3 }]).toMatchObject([{ a: 1 }, { c: 3 }]);
  assert.throws(() => expect(1).toMatchObject({}), TypeError);
  assert.throws(() => expect({}).toMatchObject(1 as never), TypeError);
});

test("toContainEqual finds an equal item in an array", () => {
  expect([{ a: 1 }, { a: 2 }]).toContainEqual({ a: 2 });
  fails(() => expect([{ a: 1 }]).toContainEqual({ a: 2 }), "toContainEqual");
  expect([{ a: 1 }]).not.toContainEqual({ a: 2 });
  assert.throws(() => expect("abc").toContainEqual("a"), TypeError);
});

test("toEqual keeps its strict meaning for undefined properties", () => {
  fails(() => expect({ a: 1, b: undefined }).toEqual({ a: 1 }), "toEqual");
});

test("asymmetric matchers inside toEqual", () => {
  expect({ id: 7, name: "Sam", tags: ["a", "b"] }).toEqual({
    id: expect.any(Number),
    name: expect.stringContaining("Sa"),
    tags: expect.arrayContaining(["b"]),
  });
  expect([1, "x"]).toEqual([expect.anything(), expect.any(String)]);
  fails(
    () => expect({ id: "7" }).toEqual({ id: expect.any(Number) }),
    "toEqual",
  );
  fails(
    () => expect({ id: 1, extra: 2 }).toEqual({ id: expect.any(Number) }),
    "toEqual",
  );
  expect({ id: "7" }).not.toEqual({ id: expect.any(Number) });
  expect({ a: 1, b: 2 }).toEqual(expect.objectContaining({ a: 1 }));
  expect("hello").toEqual(expect.stringMatching(/ell/));
  expect("hello").toEqual(expect.stringMatching("^he"));
});

test("asymmetric matchers inside toMatchObject and toContainEqual", () => {
  expect({ id: 7, nested: { n: "x", m: 1 } }).toMatchObject({
    id: expect.any(Number),
    nested: expect.objectContaining({ n: "x" }),
  });
  expect([{ id: 1 }, { id: 2 }]).toContainEqual({ id: expect.any(Number) });
  fails(
    () => expect([{ id: "1" }]).toContainEqual({ id: expect.any(Number) }),
    "toContainEqual",
  );
});

test("expect.any follows Jest for primitives, Object and Function", () => {
  expect("s").toEqual(expect.any(String));
  expect(new String("s")).toEqual(expect.any(String));
  expect(1).toEqual(expect.any(Number));
  expect(1n).toEqual(expect.any(BigInt));
  expect(true).toEqual(expect.any(Boolean));
  expect(Symbol("x")).toEqual(expect.any(Symbol));
  expect(() => 1).toEqual(expect.any(Function));
  expect({}).toEqual(expect.any(Object));
  expect([]).toEqual(expect.any(Array));
  expect(new Date()).toEqual(expect.any(Date));
  fails(() => expect(null).toEqual(expect.any(Object)), "toEqual");
  fails(() => expect(undefined).toEqual(expect.anything()), "toEqual");
  expect(0).toEqual(expect.anything());
});

test("arrayContaining and objectContaining", () => {
  expect([1, 2, 3]).toEqual(expect.arrayContaining([3, 1]));
  fails(() => expect([1]).toEqual(expect.arrayContaining([2])), "toEqual");
  fails(() => expect("no").toEqual(expect.arrayContaining([])), "toEqual");
  expect({ a: { b: 1, c: 2 } }).toEqual({
    a: expect.objectContaining({ b: 1 }),
  });
  fails(
    () => expect({ a: 1 }).toEqual(expect.objectContaining({ b: undefined })),
    "toEqual",
  );
});

test("asymmetric matchers print readably in a failure", () => {
  assert.throws(
    () => expect({ id: "x" }).toEqual({ id: expect.any(Number) }),
    (err) => {
      assert.ok(err instanceof AssertionError);
      assert.match(err.message, /Any<Number>/);
      return true;
    },
  );
});
