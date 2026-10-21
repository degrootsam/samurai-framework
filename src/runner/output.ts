import path from "node:path";
import type { RunnerOptions } from "./options.js";

/** Where a run writes: the folder its screenshots go in, and its report (`false`: none) */
export function runOutput(
  options: Pick<RunnerOptions, "outputDir" | "reportPath">,
  projectDir: string,
): { resultDir: string; report: string | false } {
  const { outputDir, reportPath } = options;
  const resultDir =
    outputDir !== undefined
      ? path.resolve(projectDir, outputDir)
      : typeof reportPath === "string"
        ? path.dirname(reportPath)
        : path.join(projectDir, "result");
  return {
    resultDir,
    report: reportPath ?? path.join(resultDir, "report.json"),
  };
}
