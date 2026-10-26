import assert from "node:assert/strict";
import { test } from "node:test";
import { takePendingAssertions } from "../assert/pending-assertions.js";
import type Locator from "../locator/locator.js";
import {
  beginOutputs,
  createInputsFixture,
  createOutputsFixture,
  currentOutputSink,
  endOutputs,
  ioOfAttempt,
  missingOutputs,
  validateTestIO,
} from "./test-io.js";

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

/** A locator stand-in whose text reads answer from `texts` in turn, the last one repeating */
function textLocator(...texts: (string | null | Promise<string | null>)[]) {
  let at = 0;
  return {
    selector: "//p",
    textContent: async () => texts[Math.min(at++, texts.length - 1)] ?? null,
  } as unknown as Locator;
}

test("inputs returns the run's value, else the default", () => {
  const inputs = createInputsFixture({ a: "1", b: "2" }, { a: "x", z: "9" });
  assert.equal(inputs.a, "x");
  assert.equal(inputs.b, "2");
});

test("reading an undeclared input throws", () => {
  const inputs = createInputsFixture({ a: "1" }, { z: "9" });
  assert.throws(() => inputs.z, {
    message: "inputs.z: not declared, add it to the test's inputs",
  });
  assert.throws(() => createInputsFixture(undefined, undefined).a, {
    message: "inputs.a: not declared, add it to the test's inputs",
  });
  // Probes of await, JSON and inspect do not throw
  assert.equal((inputs as { then?: unknown }).then, undefined);
  assert.equal(JSON.stringify(inputs), '{"a":"1"}');
});

test("save stores the element's text in the open sink", async () => {
  beginOutputs(["o"]);
  await createOutputsFixture().save("o", textLocator(null, "Hello"));
  assert.deepEqual(endOutputs(), { o: "Hello" });
});

test("save with a pattern keeps the first group, else the whole match", async () => {
  beginOutputs(["o", "p"]);
  const { save } = createOutputsFixture();
  await save("o", textLocator("Order #12345 placed"), /Order #(\d+)/);
  await save("p", textLocator("Wait", "Order #77 placed"), /Order #\d+/);
  assert.deepEqual(endOutputs(), { o: "12345", p: "Order #77" });
});

test("save on an undeclared name throws", async () => {
  beginOutputs(["o"]);
  await assert.rejects(createOutputsFixture().save("x", textLocator("a")), {
    message: 'outputs.save(): output "x" is not declared',
  });
  endOutputs();
});

test("save outside a test throws", async () => {
  endOutputs();
  await assert.rejects(createOutputsFixture().save("o", textLocator("a")), {
    message: "outputs.save(): output can only be saved inside a test",
  });
});

test("a sink set on an undeclared name throws; after endOutputs it ignores sets", () => {
  const sink = beginOutputs(["o"]);
  assert.equal(currentOutputSink(), sink);
  assert.throws(() => sink.set("x", "1"), {
    message: 'output "x" is not declared',
  });
  sink.set("o", "1");
  assert.deepEqual(endOutputs(), { o: "1" });
  assert.equal(currentOutputSink(), undefined);
  sink.set("o", "2");
  assert.deepEqual(sink.values(), { o: "1" });
});

test("a save whose text arrives after its test ended does not land in the next test", async () => {
  let release: (text: string) => void = () => {};
  const late = new Promise<string>((resolve) => (release = resolve));
  beginOutputs(["o"]);
  const saving = createOutputsFixture().save("o", textLocator(late));
  endOutputs();
  const next = beginOutputs(["o"]);
  release("late");
  await saving;
  next.set("o", "own");
  assert.deepEqual(endOutputs(), { o: "own" });
});

test("an un-awaited save is reported as outputs.save()", async () => {
  takePendingAssertions();
  endOutputs();
  void createOutputsFixture().save("o", textLocator("a"));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(takePendingAssertions(), ["outputs.save()"]);
});

test("a declared output that was never saved is an assertion failure", () => {
  const sink = beginOutputs(["o", "p", "q"]);
  sink.set("p", "1");
  assert.deepEqual(missingOutputs(["o", "p", "q"], sink), {
    message: 'output "o" was never saved\noutput "q" was never saved',
    type: "assertion",
  });
  assert.equal(missingOutputs(["p"], sink), undefined);
  assert.equal(missingOutputs(undefined, sink), undefined);
  endOutputs();
});

test("a result carries inputs (defaults included) and outputs only when declared", () => {
  const sink = beginOutputs(["o"]);
  sink.set("o", "v");
  assert.deepEqual(
    ioOfAttempt(
      { inputs: { a: "1", b: "2" }, outputs: ["o"] },
      { a: "x" },
      sink,
    ),
    { inputs: { a: "x", b: "2" }, outputs: { o: "v" } },
  );
  assert.deepEqual(ioOfAttempt({}, { a: "x" }, sink), {});
  endOutputs();
});
