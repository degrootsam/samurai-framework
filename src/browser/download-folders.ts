import { existsSync, mkdirSync, renameSync } from "node:fs";
import path from "node:path";
import logger from "../logger/index.js";
import { removeIfEmpty } from "./downloads-dir.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";
import type { Subscription } from "../transport/subscriptions.js";
import type { DownloadEndParams } from "../types/bidi-modules/browsing-context.js";

/** `report.csv` becomes `report(1).csv`, `report(2).csv`, … (the names Firefox gives) until a name is free in `dir` */
export function uniqueName(dir: string, name: string): string {
  if (!existsSync(path.join(dir, name))) return name;
  const { name: stem, ext } = path.parse(name);
  for (let n = 1; ; n++) {
    const candidate = `${stem}(${n})${ext}`;
    if (!existsSync(path.join(dir, candidate))) return candidate;
  }
}

/**
 * Chrome saves a download under its suggested name and replaces a file that has it already, where Firefox picks a
 * free name. This gives every download a folder of its own while it is written (the next folder is set when a download
 * begins) and moves the finished file into the downloads folder under a free name, so no download replaces another.
 * Must be started before the download trackers: it rewrites `filepath` of `downloadEnd` for them.
 */
export class ChromeDownloadFolders {
  private subscription: Subscription | undefined;
  private staging: string | undefined;
  private counter = 0;
  private disposed = false;

  constructor(
    private connector: BiDiConnector,
    private dir: string,
  ) {}

  public async start(): Promise<void> {
    this.connector.onEvent("browsingContext.downloadWillBegin", this.onBegin);
    this.connector.onEvent("browsingContext.downloadEnd", this.onEnd);
    try {
      this.subscription = await this.connector.subscribe([
        "browsingContext.downloadWillBegin",
        "browsingContext.downloadEnd",
      ]);
      await this.rotate();
    } catch (err) {
      await this.dispose();
      throw err;
    }
  }

  /** Idempotent */
  public async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.connector.offEvent("browsingContext.downloadWillBegin", this.onBegin);
    this.connector.offEvent("browsingContext.downloadEnd", this.onEnd);
    await this.subscription?.unsubscribe().catch(() => undefined);
    if (this.staging) removeIfEmpty(this.staging);
    removeIfEmpty(this.stagingRoot());
  }

  private stagingRoot() {
    return path.join(this.dir, ".staging");
  }

  /** Points the browser at a new, empty folder for the download after this one */
  private async rotate(): Promise<void> {
    const previous = this.staging;
    this.staging = path.join(this.stagingRoot(), String(this.counter++));
    mkdirSync(this.staging, { recursive: true });
    await this.connector.send("browser.setDownloadBehavior", {
      downloadBehavior: { type: "allowed", destinationFolder: this.staging },
    });
    if (previous) removeIfEmpty(previous);
  }

  private onBegin = () => {
    if (this.disposed) return;
    this.rotate().catch((err) =>
      logger.error("Could not set a new download folder", { err }),
    );
  };

  private onEnd = (params: DownloadEndParams) => {
    if (this.disposed || params.status !== "complete") return;
    try {
      const from = params.filepath;
      const to = path.join(this.dir, uniqueName(this.dir, path.basename(from)));
      renameSync(from, to);
      params.filepath = to;
      removeIfEmpty(path.dirname(from));
    } catch (err) {
      logger.error("Could not move a finished download", { err });
    }
  };
}
