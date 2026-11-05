import type { RegisteredTestCase, Suite, SuiteMode } from "../types/test.js";
import { suiteChain } from "./suite.js";

/** Why a test of a serial block did not run: an earlier test of the block failed */
export const SERIAL_SKIP_REASON = "serial: an earlier test failed";

const MODES: SuiteMode[] = ["default", "parallel", "serial"];

/** `describe.configure(options)`: sets the mode of the suite the call is written in */
export function configureSuite(suite: Suite, options: unknown): void {
  if (typeof options !== "object" || options === null)
    throw new TypeError(
      "describe.configure(): expected an options object like { mode: 'serial' }",
    );
  const { mode, ...rest } = options as { mode?: unknown };
  const unknown = Object.keys(rest);
  if (unknown.length > 0)
    throw new TypeError(
      `describe.configure(): unknown option "${unknown[0]}" (only mode is supported)`,
    );
  if (!MODES.includes(mode as SuiteMode))
    throw new TypeError(
      `describe.configure(): mode must be "default", "parallel" or "serial", got ${JSON.stringify(mode)}`,
    );
  if (mode === "default") delete suite.mode;
  else suite.mode = mode as SuiteMode;
}

const groupSuffix = (test: RegisteredTestCase) =>
  test.group === undefined ? "" : `@${test.group}`;

/** A group of tests that run in order on one worker; if one fails, the rest of the block is skipped */
export interface SerialBlock {
  /** The file and the `describe` titles of the block's outermost serial suite; the same in every process */
  key: string;
  /** The outermost suite in serial mode */
  suite: Suite;
}

/** The serial block a test belongs to: the outermost suite around it in `"serial"` mode, else none */
export function serialBlockOf(
  test: RegisteredTestCase,
): SerialBlock | undefined {
  const suite = suiteChain(test.suite).find((s) => s.mode === "serial");
  if (!suite) return undefined;
  const titles = suiteChain(suite).flatMap((s) =>
    s.title === undefined ? [] : [s.title],
  );
  // The same block run for two groups is two blocks
  return {
    key: `serial:${test.file}::${titles.join(" > ")}${groupSuffix(test)}`,
    suite,
  };
}

/** The tests that must run one after the other on one worker, in the order they are listed */
export interface RunUnit {
  /** The same for every test of the unit, in every process */
  key: string;
  /** A serial block: a failure skips the rest and a retry runs the whole block again */
  serial: boolean;
}

/**
 * The unit a test runs in. A serial block is one. With `fullyParallel: false` every other test is in the unit of
 * its file, unless a suite around it is in `"parallel"` mode. Otherwise (`true`, or not set: the tests of a file
 * go to workers one by one) there is no unit.
 */
export function unitOf(
  test: RegisteredTestCase,
  fullyParallel: boolean | undefined,
): RunUnit | undefined {
  const block = serialBlockOf(test);
  if (block) return { key: block.key, serial: true };
  if (fullyParallel !== false) return undefined;
  const nearest = suiteChain(test.suite)
    .reverse()
    .find((s) => s.mode === "parallel");
  return nearest
    ? undefined
    : { key: `file:${test.file}${groupSuffix(test)}`, serial: false };
}

/** Tests that follow each other and belong to one serial block (`block`), or one test outside any block */
export interface Chunk {
  block?: SerialBlock;
  tests: RegisteredTestCase[];
}

/** Splits a list of tests into serial blocks and the free tests between them, keeping the order */
export function chunkBySerialBlock(tests: RegisteredTestCase[]): Chunk[] {
  const chunks: Chunk[] = [];
  for (const test of tests) {
    const block = serialBlockOf(test);
    const last = chunks[chunks.length - 1];
    if (block && last?.block?.key === block.key) last.tests.push(test);
    else chunks.push({ ...(block && { block }), tests: [test] });
  }
  return chunks;
}
