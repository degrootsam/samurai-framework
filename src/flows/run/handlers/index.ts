import { condition } from "./condition.js";
import { end } from "./end.js";
import { group } from "./group.js";
import { parallel } from "./parallel.js";
import { setVariable } from "./set-variable.js";
import { start } from "./start.js";
import type { Handler } from "./support.js";
import { test } from "./test.js";
import { wait } from "./wait.js";

export type { Handler, HandlerRun, Outcome } from "./support.js";

/** The kinds a run can execute, by kind */
export const HANDLERS: Readonly<Record<string, Handler>> = {
  start,
  end,
  test,
  group,
  condition,
  parallel,
  wait,
  "set-variable": setVariable,
};

/** Kinds that exist in `flows/core` and have no handler yet */
export const UNSUPPORTED: readonly string[] = [
  "api",
  "database",
  "email",
  "script",
];
