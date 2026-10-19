import { recordSpec } from "../recorder/index.js";
import { stepToSource } from "../steps/index.js";
import {
  parseRunnerFlags,
  parseRunOverrides,
  type ParsedCommandLine,
} from "./args.js";
import type { Io } from "./io.js";

type RecordOptions = Parameters<typeof recordSpec>[0];
type RecordResult = Awaited<ReturnType<typeof recordSpec>>;

/** Prints a recording for a person, or as JSON lines, while it happens; counts the steps written */
function recordingPrinter(io: Io, json: boolean) {
  let count = 0;
  let state: "recording" | "paused" = "recording";
  let toolbarWarned = false;
  const handlers: Pick<
    RecordOptions,
    "onStarted" | "onStatus" | "onMissingFile" | "onEvent"
  > = {
    onStarted: () => {
      if (!json)
        io.out(
          "Recording. Alt+click an element to assert on it. Press Stop in the toolbar, Ctrl+C or close the window to stop.\n",
        );
    },
    onStatus: (status) => {
      if (json) return;
      if (!status.toolbar && !toolbarWarned) {
        toolbarWarned = true;
        io.out(
          "The toolbar couldn't load on this page. Alt+click still records assertions.\n",
        );
      }
      if (status.state !== state) {
        state = status.state;
        io.out(state === "paused" ? "Paused\n" : "Recording\n");
      }
    },
    onMissingFile: (_file, text) => {
      if (!json) io.out(`${text}\n`);
    },
    onEvent: (event) => {
      if (json) return void io.out(`${JSON.stringify(event)}\n`);
      if (event.op === "remove") {
        count--;
        return void io.out(
          `  - step ${event.index + 1} (the click that opened the file picker)\n`,
        );
      }
      io.out(
        `  ${event.op === "insert" ? "+" : "~"} ${stepToSource(event.step)}\n`,
      );
      if (event.op === "insert") count++;
    },
  };
  return { handlers, steps: () => count };
}

/** What is left to do after a recording: the steps written, secrets to set, files to add, notes on the files folder */
function summarise(io: Io, result: RecordResult, steps: number): void {
  io.out(
    `\nRecorded ${steps} ${steps === 1 ? "step" : "steps"} into "${result.test}" in ${result.file}\n`,
  );
  if (result.unsetSecrets.length > 0) {
    io.out(
      `Set ${result.unsetSecrets.map((name) => `SAMURAI_SECRET_${name}`).join(", ")} (environment variable or .env.<environment>) before running it.\n`,
    );
  }
  if (result.missingFiles.length > 0) {
    io.out(
      `Add ${result.missingFiles.map((f) => f.path).join(", ")} before running it (or use generatedFile).\n`,
    );
  }
  const hasFiles = result.files.length + result.missingFiles.length > 0;
  const folder = result.filesFolder === "" ? "." : result.filesFolder;
  if (hasFiles && result.filesIgnored)
    io.out(`${folder}/ is ignored by git; CI won't have these files.\n`);
  if (hasFiles && result.firstFiles)
    io.out(
      `Recorded files are stored in ${folder}/ and committed with your tests.\n`,
    );
}

/** `samurai record <spec>`: records into a spec file and prints what happened. Returns the exit code */
export async function recordCommand(
  { values, positionals }: ParsedCommandLine,
  io: Io,
): Promise<number> {
  const file = positionals[0];
  if (!file)
    throw new Error("Which spec? Usage: samurai record <spec> [--new <title>]");
  const at = values.at === undefined ? undefined : Number(values.at);
  if (at !== undefined && (!Number.isInteger(at) || at < 0))
    throw new Error(`--at must be a step number, got "${values.at}"`);
  const flags = parseRunnerFlags(values);
  if (flags.browsers && flags.browsers.length > 1)
    throw new Error("--browser: a recording uses one browser");
  const test =
    values.test === undefined
      ? undefined
      : /^\d+$/.test(values.test)
        ? Number(values.test)
        : values.test;
  const printer = recordingPrinter(io, values.json === true);
  const result = await recordSpec({
    ...parseRunOverrides(values, io.env),
    file,
    ...(test !== undefined && { test }),
    ...(values.new !== undefined && { create: values.new }),
    ...(at !== undefined && { at }),
    ...(values.url !== undefined && { url: values.url }),
    ...(flags.headless !== undefined && { headless: flags.headless }),
    ...(flags.port !== undefined && { port: flags.port }),
    ...(flags.browsers && { browser: flags.browsers[0]! }),
    ...(io.signal && { signal: io.signal }),
    ...printer.handlers,
  });
  if (!values.json) summarise(io, result, printer.steps());
  return 0;
}
