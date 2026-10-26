import { readEventually } from "../assert/locator-assertions.js";
import { track } from "../assert/pending-assertions.js";
import { isPassthroughKey } from "../config/variables.js";
import { RESERVED_OUTPUTS } from "../flows/core/steps.js";
import type Locator from "../locator/locator.js";
import type { TestError, TestOptions, TestOutputs } from "../types/test.js";

const NAME = /^[A-Za-z_]\w*$/;

function checkName(call: string, kind: string, name: unknown): void {
  if (
    typeof name !== "string" ||
    !NAME.test(name) ||
    RESERVED_OUTPUTS.includes(name)
  )
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
 * Where one attempt of a test keeps the outputs it saves. Once closed it ignores what still arrives, so a
 * capture that outlives its test (it timed out, or nobody awaited it) never lands in the next one.
 */
export interface OutputSink {
  /** Whether the test declared `name` */
  declares(name: string): boolean;
  /** Keeps `value` under `name`; throws for a name the test did not declare, ignores it once closed */
  set(name: string, value: string): void;
  /** What was saved so far */
  values(): Record<string, string>;
}

class Sink implements OutputSink {
  private readonly saved: Record<string, string> = {};
  public closed = false;

  constructor(private readonly declared: readonly string[]) {}

  declares(name: string): boolean {
    return this.declared.includes(name);
  }

  set(name: string, value: string): void {
    if (this.closed) return;
    if (!this.declares(name))
      throw new Error(`output ${JSON.stringify(name)} is not declared`);
    this.saved[name] = value;
  }

  values(): Record<string, string> {
    return { ...this.saved };
  }
}

/** The sink of the attempt that is running; one at a time, like the pending assertions */
let current: Sink | undefined;

/** Opens the sink of an attempt that declared `declared`, closing any one still open */
export function beginOutputs(declared: readonly string[]): OutputSink {
  if (current) current.closed = true;
  current = new Sink(declared);
  return current;
}

/** The open sink, or none outside a test. A capture takes it when it starts and saves into that one */
export function currentOutputSink(): OutputSink | undefined {
  return current;
}

/** Closes the open sink and returns what it holds */
export function endOutputs(): Record<string, string> {
  const sink = current;
  current = undefined;
  if (!sink) return {};
  sink.closed = true;
  return sink.values();
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

/** The `outputs` fixture: `save` waits for the element's text, as `toHaveText` reads it, and keeps it */
export function createOutputsFixture(): TestOutputs {
  return {
    save: (name, locator, pattern) =>
      track("outputs.save()", saveText(name, locator, pattern)),
  };
}

async function saveText(
  name: string,
  locator: Locator,
  pattern?: RegExp,
): Promise<void> {
  // Bound when the call starts: a value that arrives after this test ended goes to its own closed sink
  const sink = current;
  if (!sink)
    throw new Error("outputs.save(): output can only be saved inside a test");
  if (!sink.declares(name))
    throw new Error(
      `outputs.save(): output ${JSON.stringify(name)} is not declared`,
    );
  const text = await readEventually({
    name: "toHaveText",
    locator,
    expected: pattern ?? "an element with text",
    read: () => locator.textContent(),
    check: (actual) =>
      actual !== null && (!pattern || actual.search(pattern) !== -1),
    call: `outputs.save(${JSON.stringify(name)})`,
  });
  const match = pattern ? text!.match(pattern) : null;
  sink.set(name, match ? (match[1] ?? match[0]) : text!);
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
