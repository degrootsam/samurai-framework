import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { maskDeep, maskText } from "../../config/mask.js";
import type { RunEvent } from "../../runner/reporter.js";
import type { TestResult } from "../../types/test.js";
import type { FlowBrowserRun, FlowEvent, FlowRunResult } from "./events.js";

/** One test a Test or Group node ran, as the runner reported it */
export type FlowTestResult = { nodeId: string } & TestResult;

/** `result/flows/<id>.json`: what a flow run did, for a CI log or an archive */
export interface FlowReport {
  flow: string;
  name: string;
  environment: string;
  /** Across the browsers: see `FlowRunResult` */
  status: FlowRunResult["status"];
  startedAt: string;
  durationMs: number;
  /** Every test of every run; each names its browser */
  tests: FlowTestResult[];
  /** One entry per browser the flow ran in, in order: its nodes, variables and error */
  runs: FlowBrowserRun[];
}

/** Follows a run's events and builds its report once it ends (or `finish` is given what is known) */
export class FlowReportBuilder {
  private environment = "";
  private readonly tests: FlowTestResult[] = [];
  private readonly started = Date.now();
  private readonly startedAt = new Date(this.started).toISOString();

  constructor(private readonly flow: { id: string; name: string }) {}

  handle(event: FlowEvent): void {
    if (event.type === "flow-start") this.environment = event.environment;
    if (event.type === "test") this.collect(event.nodeId, event.event);
  }

  private collect(nodeId: string, event: RunEvent): void {
    if (event.type === "test-end")
      this.tests.push({ nodeId, ...event.result } as FlowTestResult);
  }

  finish(result: FlowRunResult, environment = this.environment): FlowReport {
    return {
      flow: this.flow.id,
      name: this.flow.name,
      environment,
      status: result.status,
      startedAt: this.startedAt,
      durationMs: Date.now() - this.started,
      tests: this.tests,
      runs: result.runs,
    };
  }
}

/** Writes `<projectDir>/result/flows/<id>.json` with the registered secrets masked, as `report.json` is. Returns the path */
export async function writeFlowReport(
  projectDir: string,
  report: FlowReport,
): Promise<string> {
  const file = path.join(
    path.resolve(projectDir),
    "result",
    "flows",
    `${report.flow}.json`,
  );
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(maskDeep(report), null, 2), "utf8");
  return file;
}

/** Hides the registered secrets in a line of output (a node's error) */
export const maskSecrets = (text: string): string => maskText(text);
