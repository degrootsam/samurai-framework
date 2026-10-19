import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseSpec } from "../steps/parse.js";
import { applyRecorderEvent } from "./apply.js";
import type { RecorderEvent } from "./normalise.js";

const NEW_SPEC_HEADER = `import { expect, test } from "@itmetsam/samurai-framework";\n\n`;

/** `source` with an empty test called `title` added (a new file gets the import line first) */
export function addTest(source: string, title: string): string {
  const header =
    source.trim() === ""
      ? NEW_SPEC_HEADER
      : `${source.replace(/\s*$/, "")}\n\n`;
  return `${header}test(${JSON.stringify(title)}, async ({ page }) => {\n});\n`;
}

/** The index of the test `selector` names (see `RecordSpecOptions.test`) */
export function pickTest(
  tests: readonly { name: string }[],
  selector: string | number | undefined,
): number {
  if (tests.length === 0)
    throw new Error(
      "The file has no tests; give a title with --new to add one",
    );
  if (selector === undefined) {
    if (tests.length === 1) return 0;
    throw new Error(
      `The file has ${tests.length} tests; choose one with --test:\n${tests.map((t) => `  ${t.name}`).join("\n")}`,
    );
  }
  if (typeof selector === "number") {
    if (
      !Number.isInteger(selector) ||
      selector < 0 ||
      selector >= tests.length
    ) {
      throw new Error(
        `There is no test ${selector}; the file has ${tests.length}`,
      );
    }
    return selector;
  }
  const exact = tests.findIndex((t) => t.name === selector);
  if (exact !== -1) return exact;
  const partial = tests.flatMap((t, index) =>
    t.name.includes(selector) ? [index] : [],
  );
  if (partial.length === 1) return partial[0]!;
  throw new Error(
    partial.length === 0
      ? `No test matches "${selector}". Tests:\n${tests.map((t) => `  ${t.name}`).join("\n")}`
      : `"${selector}" matches ${partial.length} tests; use the full name`,
  );
}

/** The spec a recording writes into: its text, the test chosen, and where the first new step goes */
export interface RecordingSpec {
  source: string;
  testIndex: number;
  /** Full name of the test the steps go into */
  testName: string;
  at: number;
}

/** The spec's text, `undefined` when the file is not there yet; throws when it must exist (no `create`) */
export function readSpec(
  file: string,
  options: { file: string; create?: string | undefined },
): string | undefined {
  const source = existsSync(file) ? readFileSync(file, "utf8") : undefined;
  if (source === undefined && options.create === undefined) {
    throw new Error(
      `${options.file} does not exist; give a title with --new to create it`,
    );
  }
  return source;
}

/**
 * Adds the test called `create` to the spec when it is not there yet (writing the file), and picks the test and the
 * step index to record from. Throws before writing anything when the test or `at` is wrong.
 */
export function prepareSpec(
  file: string,
  existing: string | undefined,
  options: {
    create?: string | undefined;
    test?: string | number | undefined;
    at?: number | undefined;
  },
): RecordingSpec {
  let source = existing ?? "";
  if (
    options.create !== undefined &&
    !parseSpec(source).some((t) => t.name === options.create)
  ) {
    source = addTest(source, options.create);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, source);
  }
  const tests = parseSpec(source);
  const testIndex = pickTest(tests, options.create ?? options.test);
  const test = tests[testIndex]!;
  const at = options.at ?? test.steps.length;
  if (!Number.isInteger(at) || at < 0 || at > test.steps.length) {
    throw new RangeError(
      `--at must be between 0 and ${test.steps.length} (the test has ${test.steps.length} steps)`,
    );
  }
  return { source, testIndex, testName: test.name, at };
}

/** Writes each recorded step into the spec file as a minimal edit and keeps the events */
export class SpecWriter {
  public readonly events: RecorderEvent[] = [];

  constructor(
    private source: string,
    private readonly file: string,
    private readonly testIndex: number,
  ) {}

  /** Applies the event, writes the file and returns the file's new content */
  public write(event: RecorderEvent): string {
    this.source = applyRecorderEvent(this.source, this.testIndex, event);
    writeFileSync(this.file, this.source);
    this.events.push(event);
    return this.source;
  }
}
