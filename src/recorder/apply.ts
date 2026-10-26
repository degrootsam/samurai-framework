import { applyEdit } from "../steps/edit.js";
import { parseSpec } from "../steps/parse.js";
import type { RecorderEvent } from "./normalise.js";

/** Writes a recorder event into the spec source, as an edit of test number `test` */
export function applyRecorderEvent(
  source: string,
  test: number,
  event: RecorderEvent,
): string {
  if (event.op === "remove")
    return applyEdit(source, { op: "remove", test, index: event.index });
  const { declare } = event.op === "insert" ? event : {};
  const inputs = parseSpec(source)[test]?.inputs ?? [];
  const declared =
    declare && !inputs.some((input) => input.name === declare.name)
      ? applyEdit(source, {
          op: "declare",
          test,
          inputs: [...inputs, declare],
        })
      : source;
  return applyEdit(declared, {
    op: event.op,
    test,
    index: event.index,
    step: event.step,
  });
}
