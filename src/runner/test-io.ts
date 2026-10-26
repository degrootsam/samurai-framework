import { RESERVED_OUTPUTS } from "../flows/core/steps.js";
import type { TestOptions } from "../types/test.js";

const NAME = /^[A-Za-z_]\w*$/;

function checkName(call: string, kind: string, name: unknown): void {
  if (
    typeof name !== "string" ||
    !NAME.test(name) ||
    RESERVED_OUTPUTS.includes(name)
  )
    throw new Error(`${call}(): ${kind} ${quoted(name)} is not a valid name`);
}

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
