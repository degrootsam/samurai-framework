import path from "node:path";
import { projectDir } from "../config/config.js";
import {
  Normaliser,
  type Observation,
  type RecorderEvent,
} from "../recorder/normalise.js";
import { prepareSpec, readSpec, SpecWriter } from "../recorder/spec-source.js";
import { stepToSource } from "../steps/emit.js";

export interface StepRecorderOptions {
  /** The spec file, absolute or relative to the project folder */
  file: string;
  /** Add a test with this title (and create the file) */
  create?: string | undefined;
  /** The existing test to write into, as for `recordSpec` */
  test?: string | number | undefined;
  /** Relative URLs are written against this */
  baseURL?: string | undefined;
  /** Called after each event is written, with the statement it produced and the file's new content */
  onStep?: (
    event: RecorderEvent,
    code: string | undefined,
    source: string,
  ) => void;
}

/** The statement an event wrote, `undefined` for a removal */
function codeOf(event: RecorderEvent): string | undefined {
  return event.op === "remove" ? undefined : stepToSource(event.step);
}

/** What a tool tells the model about the steps it wrote */
export function writtenText(events: readonly RecorderEvent[]): string {
  const codes = events.flatMap((event) => codeOf(event) ?? []);
  return codes.length > 0 ? ` Step written: ${codes.join(" ")}` : "";
}

/**
 * Writes the agent's steps the way a recording does: an observation goes through the recorder's normaliser and
 * `SpecWriter`, so the file is a valid spec after every call and holds only typed steps.
 */
export class StepRecorder {
  private readonly normaliser: Normaliser;
  private readonly writer: SpecWriter;

  constructor(private readonly options: StepRecorderOptions) {
    const file = path.resolve(projectDir(), options.file);
    const spec = prepareSpec(file, readSpec(file, options), options);
    this.writer = new SpecWriter(spec.source, file, spec.testIndex);
    this.normaliser = new Normaliser({
      at: spec.at,
      ...(options.baseURL !== undefined && { baseURL: options.baseURL }),
    });
  }

  /** Writes what `observation` makes of the spec and returns the events, which hold the statements */
  public observe(observation: Observation): RecorderEvent[] {
    const events = this.normaliser.observe(observation, Date.now());
    for (const event of events) {
      const source = this.writer.write(event);
      this.options.onStep?.(event, codeOf(event), source);
    }
    return events;
  }
}
