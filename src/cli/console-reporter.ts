import { painter } from "./paint.js";
import type { RunEvent, TestResult, TestSummary } from "../runner/run.js";

export interface ConsoleReporterOptions {
  write: (text: string) => void;
  /** Colour with ANSI codes */
  color: boolean;
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/** What a result says about its retries: `passed on retry 2`, `failed after 2 retries`, or nothing */
function retried(result: TestResult): string | undefined {
  if (!("retry" in result) || !result.retry) return undefined;
  if (result.status === "success") return `passed on retry ${result.retry}`;
  return `failed after ${result.retry} ${result.retry === 1 ? "retry" : "retries"}`;
}

/** Prints a run for a person: one line per test as it ends, then every failure in full and a count */
export class ConsoleReporter {
  private readonly write: (text: string) => void;
  private readonly paint: (code: number, text: string) => string;
  /** Whether the run has more than one browser: only then is each test labelled with its browser */
  private labelled = false;

  constructor({ write, color }: ConsoleReporterOptions) {
    this.write = write;
    this.paint = painter(color);
  }

  public handle(event: RunEvent): void {
    switch (event.type) {
      case "run-start":
        this.labelled = event.browsers.length > 1;
        this.write(
          `Running ${event.total} ${event.total === 1 ? "test" : "tests"}${event.workers ? ` with ${event.workers} workers` : ""} against ${event.environment}${this.labelled ? ` in ${event.browsers.join(", ")}` : ""}\n`,
        );
        return;
      case "test-end":
        this.write(`  ${this.line(event.name, event.result, event.browser)}\n`);
        return;
      case "run-end":
        this.summary(event.summary);
        return;
      case "test-start":
        return;
    }
  }

  /** ` [chrome]` in a run with more than one browser, else nothing */
  private tag(browser: string): string {
    return this.labelled ? ` ${this.paint(90, `[${browser}]`)}` : "";
  }

  private line(name: string, result: TestResult, browser: string): string {
    const took =
      "duration" in result
        ? ` ${this.paint(90, `(${[seconds(result.duration), retried(result)].filter(Boolean).join(", ")})`)}`
        : "";
    if (result.status === "skipped")
      return this.paint(
        90,
        `- ${name}${this.tag(browser)} (${result.annotation === "fixme" ? "fixme" : "skipped"}${result.reason ? `: ${result.reason}` : ""})`,
      );
    return result.status === "success"
      ? `${this.paint(32, "✔")} ${name}${this.tag(browser)}${took}`
      : `${this.paint(31, "✖")} ${name}${this.tag(browser)}${took}`;
  }

  private summary(summary: TestSummary): void {
    const skipped = summary.tests.filter((test) => test.status === "skipped");
    const failed = summary.tests.filter(
      (test) => test.status !== "success" && test.status !== "skipped",
    );
    for (const test of failed) {
      if (!("name" in test)) continue;
      const message = "message" in test ? test.message : "did not finish";
      this.write(
        `\n${this.paint(31, `${test.name}`)}${"browser" in test ? this.tag(test.browser) : ""}\n`,
      );
      this.write(
        `${message
          .split("\n")
          .map((line) => `    ${line}`)
          .join("\n")}\n`,
      );
      if ("file" in test) this.write(`    ${this.paint(90, test.file)}\n`);
    }
    const passed = summary.tests.length - failed.length - skipped.length;
    const flaky = summary.tests.filter(
      (test) => "flaky" in test && test.flaky,
    ).length;
    const parts = [
      failed.length > 0 && this.paint(31, `${failed.length} failed`),
      this.paint(32, `${passed} passed${flaky > 0 ? ` (${flaky} flaky)` : ""}`),
      skipped.length > 0 && this.paint(90, `${skipped.length} skipped`),
    ].filter(Boolean);
    this.write(
      `\n${parts.join(", ")} ${this.paint(90, `(${seconds(summary.duration)})`)}\n`,
    );
  }
}
