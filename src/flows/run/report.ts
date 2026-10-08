import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { maskDeep, maskText } from "../../config/mask.js";
import type { RunEvent } from "../../runner/reporter.js";
import type { TestResult } from "../../types/test.js";
import type { FlowEvent, FlowSummary, NodeResult } from "./events.js";

/** One test a Test or Group node ran, as the runner reported it */
export type FlowTestResult = { nodeId: string } & TestResult;

/** `result/flows/<id>.json`: what a flow run did, for a CI log or an archive */
export interface FlowReport {
  flow: string;
  name: string;
  environment: string;
  status: FlowSummary["status"];
  startedAt: string;
  durationMs: number;
  nodes: Record<string, NodeResult>;
  vars: Record<string, unknown>;
  tests: FlowTestResult[];
  /** The flow couldn't be walked at all */
  error?: string;
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

  finish(summary: FlowSummary, environment = this.environment): FlowReport {
    return {
      flow: this.flow.id,
      name: this.flow.name,
      environment,
      status: summary.status,
      startedAt: this.startedAt,
      durationMs: Date.now() - this.started,
      nodes: summary.nodes,
      vars: summary.vars,
      tests: this.tests,
      ...(summary.error ? { error: summary.error } : {}),
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
