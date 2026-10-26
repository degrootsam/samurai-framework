import assert from "node:assert/strict";
import { test } from "node:test";
import { validateTestIO } from "./test-io.js";

test("valid inputs and outputs come back as given", () => {
  assert.deepEqual(
    validateTestIO("test", { inputs: { a: "1" }, outputs: ["o", "p"] }),
    { inputs: { a: "1" }, outputs: ["o", "p"] },
  );
});

test("nothing declared returns no keys", () => {
  const result = validateTestIO("test", {});
  assert.ok(!("inputs" in result) && !("outputs" in result));
  const empty = validateTestIO("test", { inputs: {}, outputs: [] });
  assert.ok(!("inputs" in empty) && !("outputs" in empty));
});

test("a name may be both an input and an output", () => {
  assert.deepEqual(
    validateTestIO("test", { inputs: { a: "1" }, outputs: ["a"] }),
    { inputs: { a: "1" }, outputs: ["a"] },
  );
});

test("an invalid output name throws with the call name", () => {
  assert.throws(() => validateTestIO("test.only", { outputs: ["1x"] }), {
    message: 'test.only(): output "1x" is not a valid name',
  });
  assert.throws(() => validateTestIO("test", { outputs: ["a-b"] }), {
    message: 'test(): output "a-b" is not a valid name',
  });
});

test("an invalid input name throws", () => {
  assert.throws(() => validateTestIO("test.skip", { inputs: { "a b": "x" } }), {
    message: 'test.skip(): input "a b" is not a valid name',
  });
});

test("a reserved name throws", () => {
  for (const name of ["status", "durationMs", "error"])
    assert.throws(() => validateTestIO("test", { outputs: [name] }), {
      message: `test(): output "${name}" is not a valid name`,
    });
});

test("a duplicate output throws", () => {
  assert.throws(() => validateTestIO("test.fixme", { outputs: ["o", "o"] }), {
    message: 'test.fixme(): output "o" is listed twice',
  });
});

test("a non-string default throws", () => {
  assert.throws(
    () => validateTestIO("test", { inputs: { a: 1 as unknown as string } }),
    { message: 'test(): input "a" needs a string default' },
  );
});

test("outputs must be an array of strings and inputs an object", () => {
  assert.throws(
    () => validateTestIO("test", { outputs: "o" as unknown as string[] }),
    { message: "test(): outputs must be an array of names" },
  );
  assert.throws(
    () => validateTestIO("test", { outputs: [1 as unknown as string] }),
    { message: "test(): output 1 is not a valid name" },
  );
  assert.throws(
    () => validateTestIO("test", { inputs: ["a"] as unknown as {} }),
    { message: "test(): inputs must be an object of names and defaults" },
  );
});
