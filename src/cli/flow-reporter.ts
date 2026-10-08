import {
  nodeDef,
  type FlowFile,
  type FlowNodeModel,
} from "../flows/core/index.js";
import {
  maskSecrets as maskText,
  type FlowEvent,
  type FlowSummary,
  type NodeResult,
} from "../flows/run/index.js";

export interface FlowReporterOptions {
  flow: FlowFile;
  write: (text: string) => void;
  /** Colour with ANSI codes */
  color: boolean;
}

const took = (ms: number) =>
  ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;

const SKIPPED_BY_SHAPE = new Set(["start", "end"]);

/** Prints a flow run for a person: one line per node as it ends, then a count. Start and End are not listed. */
export class FlowReporter {
  private readonly write: (text: string) => void;
  private readonly paint: (code: number, text: string) => string;
  private readonly nodes: Map<string, FlowNodeModel>;
  private readonly flow: FlowFile;
  private started = Date.now();

  constructor({ flow, write, color }: FlowReporterOptions) {
    this.flow = flow;
    this.write = write;
    this.paint = (code, text) =>
      color ? `\u001b[${code}m${text}\u001b[0m` : text;
    this.nodes = new Map(flow.nodes.map((n) => [n.id, n]));
  }

  private shapeOf(node: FlowNodeModel): string | undefined {
    try {
      return nodeDef(node.kind).shape;
    } catch {
      return undefined;
    }
  }

  private listed(node: FlowNodeModel | undefined): node is FlowNodeModel {
    return !!node && !SKIPPED_BY_SHAPE.has(this.shapeOf(node) ?? "");
  }

  private nameOf(node: FlowNodeModel, result: NodeResult): string {
    let label: string;
    try {
      label = nodeDef(node.kind).label;
    } catch {
      label = node.kind;
    }
    const base = node.title || label;
    const wrote = result.wrote ? Object.keys(result.wrote) : [];
    return node.title || wrote.length === 0
      ? base
      : `${base} ${wrote.map((n) => `vars.${n}`).join(", ")}`;
  }

  handle(event: FlowEvent): void {
    if (event.type === "flow-start") {
      this.started = Date.now();
      this.write(`Flow "${this.flow.name}" against ${event.environment}\n`);
    } else if (event.type === "node-end") {
      const node = this.nodes.get(event.nodeId);
      if (this.listed(node)) this.line(node, event.result);
    } else if (event.type === "flow-end") {
      this.summary(event.summary);
    }
  }

  private line(node: FlowNodeModel, result: NodeResult): void {
    const name = this.nameOf(node, result);
    const time =
      result.durationMs === undefined
        ? ""
        : ` ${this.paint(90, `(${took(result.durationMs)})`)}`;
    if (result.status === "failed") {
      this.write(`  ${this.paint(31, "✖")} ${name}${time}\n`);
      if (result.error)
        this.write(
          `${maskText(result.error)
            .split("\n")
            .map((l) => `      ${l}`)
            .join("\n")}\n`,
        );
    } else if (result.status === "skipped") {
      this.write(
        `  ${this.paint(33, "⊘")} ${name} ${this.paint(90, `(skipped${result.note ? `: ${result.note}` : ""})`)}\n`,
      );
    } else if (result.branch !== undefined) {
      this.write(
        `  ${this.paint(36, "◇")} ${name} → ${result.branch}${time}\n`,
      );
    } else {
      this.write(`  ${this.paint(32, "✔")} ${name}${time}\n`);
      if (result.note) this.write(`      ${this.paint(90, result.note)}\n`);
    }
  }

  private summary(summary: FlowSummary): void {
    const counts = { failed: 0, passed: 0, skipped: 0, "not-run": 0 };
    for (const [id, result] of Object.entries(summary.nodes)) {
      if (this.listed(this.nodes.get(id))) counts[result.status]++;
    }
    if (summary.error)
      this.write(`\n${this.paint(31, maskText(summary.error))}\n`);
    if (summary.status === "cancelled") this.write(`\nCancelled\n`);
    const parts = [
      counts.failed > 0 && this.paint(31, `${counts.failed} failed`),
      this.paint(32, `${counts.passed} passed`),
      counts.skipped > 0 && this.paint(33, `${counts.skipped} skipped`),
      counts["not-run"] > 0 && `${counts["not-run"]} not run`,
    ].filter(Boolean);
    const total = Date.now() - this.started;
    this.write(`\n${parts.join(", ")} ${this.paint(90, `(${took(total)})`)}\n`);
  }
}
