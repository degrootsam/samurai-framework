import assert from "node:assert/strict";
import { test } from "node:test";
import {
  any,
  anything,
  arrayContaining,
  equalsWith,
  objectContaining,
  stringContaining,
  stringMatching,
  subsetMatches,
} from "./asymmetric.js";

test("equalsWith is isDeepStrictEqual when no matcher is inside", () => {
  assert.equal(equalsWith({ a: [1] }, { a: [1] }), true);
  assert.equal(equalsWith({ a: undefined }, {}), false);
  assert.equal(equalsWith(new Map([[1, 2]]), new Map([[1, 2]])), true);
  assert.equal(equalsWith(NaN, NaN), true);
});

test("equalsWith checks matchers at any depth, keys and lengths stay strict", () => {
  assert.equal(
    equalsWith({ a: [1, "x"] }, { a: [any(Number), anything()] }),
    true,
  );
  assert.equal(equalsWith({ a: 1, b: 2 }, { a: any(Number) }), false);
  assert.equal(equalsWith([1, 2], [any(Number)]), false);
  assert.equal(equalsWith({ a: "x" }, { a: any(Number) }), false);
  assert.equal(equalsWith(new Date(0), any(Date)), true);
});

test("subsetMatches ignores extra keys but not array length", () => {
  assert.equal(subsetMatches({ a: 1, b: 2 }, { a: 1 }), true);
  assert.equal(subsetMatches({ a: [1, 2] }, { a: [1] }), false);
  assert.equal(
    subsetMatches({ a: { b: 1, c: 2 } }, { a: { b: any(Number) } }),
    true,
  );
  assert.equal(subsetMatches({ a: 1 }, { a: undefined }), false);
});

test("string matchers need a string", () => {
  assert.equal(stringContaining("a").asymmetricMatch(1), false);
  assert.equal(stringMatching(/a/).asymmetricMatch(null), false);
  assert.equal(stringMatching(/a/g).asymmetricMatch("a"), true);
  assert.equal(stringMatching(/a/g).asymmetricMatch("a"), true);
});

test("array and object matchers", () => {
  assert.equal(
    arrayContaining([{ a: any(Number) }]).asymmetricMatch([{ a: 1 }]),
    true,
  );
  assert.equal(objectContaining({ a: 1 }).asymmetricMatch(null), false);
  assert.equal(
    objectContaining({ a: 1 }).asymmetricMatch({ a: 1, z: 1 }),
    true,
  );
});

test("matchers describe themselves", () => {
  assert.equal(String(any(Number)), "Any<Number>");
  assert.equal(String(anything()), "Anything");
  assert.equal(String(stringContaining("x")), 'StringContaining "x"');
});
