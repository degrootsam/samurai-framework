import { parseSpec } from "../steps/parse.js";

/** A spec file with one test whose body is `lines`, the shape the step codec tests edit */
export const wrap = (...lines: string[]) =>
  `import { expect, test } from "samurai";\n\ntest("t", async ({ page, env, secrets }) => {\n${lines.map((l) => `  ${l}\n`).join("")}});\n`;

/** The steps of the first test in `source` */
export const stepsOf = (source: string) =>
  parseSpec(source)[0]!.steps.map(({ step }) => step);
