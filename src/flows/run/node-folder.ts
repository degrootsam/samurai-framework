import { cleanName } from "../../browser/evidence.js";
import type { RunEvent } from "../../runner/reporter.js";
import type { SupportedBrowser } from "../../types/browser.js";
import type { TestResult } from "../../types/test.js";

/**
 * The folder a flow node writes to in one browser's run, relative to `runFlowInProject`'s `outputDir`, with `/`
 * separators: the browser, `nodes/` and the node id cleaned for a file name. A node's screenshot paths already
 * start with it (they are relative to `outputDir`), so an app needs this only to show or open the folder.
 */
export function nodeFolder(nodeId: string, browser: SupportedBrowser): string {
  return `${browser}/nodes/${cleanName(nodeId)}`;
}

const withFolder = (result: TestResult, folder: string): TestResult =>
  "screenshots" in result && result.screenshots
    ? {
        ...result,
        screenshots: result.screenshots.map((s) => ({
          ...s,
          path: `${folder}/${s.path}`,
        })),
      }
    : result;

/** A node's test event with its screenshot paths (relative to the node's folder) made relative to `outputDir` */
export function inNodeFolder(event: RunEvent, folder: string): RunEvent {
  if (event.type === "test-end")
    return { ...event, result: withFolder(event.result, folder) };
  if (event.type === "run-end")
    return {
      ...event,
      summary: {
        ...event.summary,
        tests: event.summary.tests.map((t) => withFolder(t, folder)),
      },
    };
  return event;
}
