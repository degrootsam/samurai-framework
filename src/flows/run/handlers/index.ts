import { STEP_HANDLERS } from "../../steps/catalog.js";
import { condition } from "./condition.js";
import { end } from "./end.js";
import { group } from "./group.js";
import { parallel } from "./parallel.js";
import { start } from "./start.js";
import type { Handler } from "./types.js";
import { test } from "./test.js";

export type { Handler, HandlerRun, Outcome } from "./types.js";

/** The kinds a run can execute, by kind: the closed ones and every built-in step */
export const HANDLERS: Readonly<Record<string, Handler>> = {
  start,
  end,
  test,
  group,
  condition,
  parallel,
  ...STEP_HANDLERS,
};
