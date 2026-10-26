import { captured, textCheck } from "../assert/text-match.js";
import { readEventually } from "../assert/locator-assertions.js";
import { track } from "../assert/pending-assertions.js";
import { isPassthroughKey } from "../config/variables.js";
import { isIoName } from "../flows/core/steps.js";
import type Locator from "../locator/locator.js";
import type { TestError, TestOptions, TestOutputs } from "../types/test.js";
import type { OutputSink } from "../wait/output-sink.js";

function checkName(call: string, kind: string, name: unknown): void {
  if (typeof name !== "string" || !isIoName(name))
    throw new Error(`${call}(): ${kind} ${quoted(name)} is not a valid name`);
}

const has = (object: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(object, key);

/** A name in a message: strings quoted, anything else as written */
function quoted(name: unknown): string {
  return typeof name === "string" ? JSON.stringify(name) : String(name);
}

/**
 * Checks the `inputs` and `outputs` of a `test()` options object and returns them, leaving out an empty or absent
 * list. `call` is the form used (`test`, `test.only`, ...), named in the error.
 */
export function validateTestIO(
  call: string,
  options: TestOptions,
): { inputs?: Record<string, string>; outputs?: string[] } {
  const { inputs, outputs } = options;
  const result: { inputs?: Record<string, string>; outputs?: string[] } = {};
  if (inputs !== undefined) {
    if (typeof inputs !== "object" || inputs === null || Array.isArray(inputs))
      throw new Error(
        `${call}(): inputs must be an object of names and defaults`,
      );
    for (const [name, value] of Object.entries(inputs)) {
      checkName(call, "input", name);
      if (typeof value !== "string")
        throw new Error(`${call}(): input "${name}" needs a string default`);
    }
    if (Object.keys(inputs).length > 0) result.inputs = { ...inputs };
  }
  if (outputs !== undefined) {
    if (!Array.isArray(outputs))
      throw new Error(`${call}(): outputs must be an array of names`);
    const seen = new Set<string>();
    for (const name of outputs) {
      checkName(call, "output", name);
      if (seen.has(name))
        throw new Error(`${call}(): output "${name}" is listed twice`);
      seen.add(name);
    }
    if (outputs.length > 0) result.outputs = [...outputs];
  }
  return result;
}

/**
 * The `inputs` fixture: each declared input with the value the run supplies, else its default. Reading a
 * name the test did not declare throws.
 */
export function createInputsFixture(
  declared: Record<string, string> | undefined,
  supplied: Record<string, string> | undefined,
): Readonly<Record<string, string>> {
  return new Proxy(Object.freeze(resolveInputs(declared, supplied)), {
    get(target, key, receiver) {
      if (isPassthroughKey(target, key) || has(target, key))
        return Reflect.get(target, key, receiver);
      throw new Error(
        `inputs.${String(key)}: not declared, add it to the test's inputs`,
      );
    },
  });
}

/** Each declared input with the supplied value, else its default; names the test does not declare are left out */
function resolveInputs(
  declared: Record<string, string> | undefined,
  supplied: Record<string, string> | undefined,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(declared ?? {}).map(([name, value]) => [
      name,
      supplied && has(supplied, name) ? supplied[name]! : value,
    ]),
  );
}

/**
 * The `outputs` fixture of one attempt: `save` waits for the element's text (non-empty, or matching the pattern), as
 * `toHaveText` reads it, and keeps it in `sink`. It keeps to its own attempt's sink, so a late value never lands in a later test.
 */
export function createOutputsFixture(sink: OutputSink): TestOutputs {
  return {
    save: (name, locator, pattern) =>
      track("outputs.save()", saveText(sink, name, locator, pattern)),
  };
}

async function saveText(
  sink: OutputSink,
  name: string,
  locator: Locator,
  pattern?: RegExp,
): Promise<void> {
  if (!sink.declares(name))
    throw new Error(
      `outputs.save(): output ${JSON.stringify(name)} is not declared`,
    );
  const matches = pattern ? textCheck(pattern, "exact") : undefined;
  const text = await readEventually({
    name: "toHaveText",
    locator,
    expected: pattern ?? "an element with text",
    read: () => locator.textContent(),
    // Without a pattern, an element that has not rendered its value yet (no text) is waited for
    check: (actual) =>
      actual !== null && (matches ? matches(actual) : actual !== ""),
    call: `outputs.save(${JSON.stringify(name)})`,
  });
  sink.set(name, pattern ? captured(pattern, text!) : text!);
}

/** The failure of a passing attempt that did not save every output it declared */
export function missingOutputs(
  declared: readonly string[] | undefined,
  sink: OutputSink,
): TestError | undefined {
  const saved = sink.values();
  const missing = (declared ?? []).filter((name) => !has(saved, name));
  if (missing.length === 0) return undefined;
  return {
    message: missing
      .map((name) => `output ${JSON.stringify(name)} was never saved`)
      .join("\n"),
    type: "assertion",
  };
}

/** What an attempt's result lists: its inputs when it declares any, its outputs so far when it declares any */
export function ioOfAttempt(
  test: { inputs?: Record<string, string>; outputs?: string[] },
  supplied: Record<string, string> | undefined,
  sink: OutputSink,
): { inputs?: Record<string, string>; outputs?: Record<string, string> } {
  return {
    ...(test.inputs && { inputs: resolveInputs(test.inputs, supplied) }),
    ...(test.outputs && { outputs: sink.values() }),
  };
}
