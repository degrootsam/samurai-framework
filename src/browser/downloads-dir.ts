import { mkdirSync, rmdirSync } from "node:fs";
import path from "node:path";
import logger from "../logger/index.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";
import { BiDiError } from "../transport/bidi-error.js";

let counter = 0;

/**
 * Makes downloads land in a folder of their own, so a test knows where to look and runs do not mix: a new folder
 * below `baseDir` is created and the browser told to save there. Returns it, or undefined when the browser cannot be told.
 */
export async function prepareDownloadsDir(connector: BiDiConnector, baseDir: string): Promise<string | undefined> {
  const dir = path.join(path.resolve(baseDir), `dl-${Date.now().toString(36)}-${process.pid}-${counter++}`);
  mkdirSync(dir, { recursive: true });
  try {
    await connector.send("browser.setDownloadBehavior", {
      downloadBehavior: { type: "allowed", destinationFolder: dir },
    });
  } catch (err) {
    removeIfEmpty(dir);
    if (err instanceof BiDiError && (err.code === "unknown command" || err.code === "unsupported operation")) {
      logger.warn("The browser cannot be told where to save downloads; they go to its own folder");
      return undefined;
    }
    throw err;
  }
  return dir;
}

/** Removes `dir` when nothing was downloaded into it. Never throws */
export function removeIfEmpty(dir: string | undefined): void {
  if (!dir) return;
  try {
    rmdirSync(dir);
  } catch {
    // Not empty, or already gone: leave it
  }
}
