import type EventEmitter from "node:events";
import type { BiDiConnector } from "../transport/bidi-connection.js";
import type { BrowsingContext } from "../types/bidi-modules/browsing-context.js";
import type { TreeSource } from "./dialog-handling.js";
import { Download, DownloadTracker } from "./download.js";
import { FileChooser, FileChooserTracker } from "./file-chooser.js";
import { Lazy } from "./lazy.js";
import type { PageEventName, PageEvents, WaitOptions } from "./page-events.js";
import type { PageConfig } from "./page-settings.js";
import {
  DownloadWaitTimeoutError,
  FileChooserTimeoutError,
} from "./page-wait.js";

/** What `PageTransfers` takes from the page around it */
export interface PageTransfersDeps {
  config: PageConfig;
  tree: TreeSource;
  /** Where `download` and `filechooser` are emitted */
  emitter: EventEmitter;
  /** Resolves with the first event of a kind that `matches` accepts (the page's `waitForPageEvent`) */
  waitForEvent: <E extends PageEventName>(
    event: E,
    matches: (item: PageEvents[E][0]) => boolean,
    options: WaitOptions,
    onTimeout: (timeout: number) => Error,
  ) => Promise<PageEvents[E][0]>;
}

/** What goes between a page and the disk: downloads it starts and file pickers it opens */
export class PageTransfers {
  private lazyDownloads = new Lazy<DownloadTracker>();
  private lazyFileChoosers = new Lazy<FileChooserTracker>();

  constructor(
    private connector: BiDiConnector,
    private contextId: BrowsingContext,
    private deps: PageTransfersDeps,
  ) {}

  /** Starts following downloads; the browser does this when it opens a page, `page.on("download")` and `waitForDownload` when needed */
  public async startDownloadTracking(): Promise<void> {
    await this.lazyDownloads.get(async () => {
      const timeout = await this.deps.config.navigationTimeout();
      const tracker = await DownloadTracker.start(
        this.connector,
        await this.deps.tree.ensure(),
        this.contextId,
        { timeout },
      );
      tracker.on("download", (download) =>
        this.deps.emitter.emit("download", download),
      );
      return tracker;
    });
  }

  /** Starts following file pickers; the browser does this when it opens a page, `page.on("filechooser")` and `waitForFileChooser` when needed */
  public async startFileChooserTracking(): Promise<void> {
    await this.lazyFileChoosers.get(async () => {
      const tracker = await FileChooserTracker.start(
        this.connector,
        await this.deps.tree.ensure(),
        this.contextId,
      );
      tracker.on("filechooser", (chooser) =>
        this.deps.emitter.emit("filechooser", chooser),
      );
      return tracker;
    });
  }

  /** Resolves with the next download (that `accepts`, when given) the page starts */
  public async waitForDownload(
    options: WaitOptions = {},
    accepts: (download: Download) => boolean = () => true,
  ): Promise<Download> {
    await this.startDownloadTracking();
    return this.deps.waitForEvent(
      "download",
      accepts,
      options,
      (timeout) => new DownloadWaitTimeoutError(timeout),
    );
  }

  /** Resolves with the next file picker (that `accepts`, when given) the page opens */
  public async waitForFileChooser(
    options: WaitOptions = {},
    accepts: (chooser: FileChooser) => boolean = () => true,
  ): Promise<FileChooser> {
    await this.startFileChooserTracking();
    return this.deps.waitForEvent(
      "filechooser",
      accepts,
      options,
      (timeout) => new FileChooserTimeoutError(timeout),
    );
  }

  /** Releases both trackers */
  public dispose(): (Promise<void> | undefined)[] {
    const downloads = this.lazyDownloads.take();
    const fileChoosers = this.lazyFileChoosers.take();
    return [
      downloads?.then((resolved) => resolved.dispose()),
      fileChoosers?.then((resolved) => resolved.dispose()),
    ];
  }
}
