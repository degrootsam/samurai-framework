import { applyEdit } from "../steps/edit.js";
import type { RecorderEvent } from "./normalise.js";

/** Writes a recorder event into the spec source, as an edit of test number `test` */
export function applyRecorderEvent(
  source: string,
  test: number,
  event: RecorderEvent,
): string {
  return applyEdit(source, {
    op: event.op,
    test,
    index: event.index,
    step: event.step,
  });
}
