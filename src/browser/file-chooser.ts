import EventEmitter from "node:events";
import logger from "../logger/index.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";
import type { Subscription } from "../transport/subscriptions.js";
import type { FileDialogInfo } from "../types/bidi-modules/input.js";
import type { ContextTree } from "./context-tree.js";
import { assertIsFile, resolveFiles } from "./file-paths.js";

/**
 * A native file picker the page asked for (a click on an `<input type=file>` or its label). Nothing appears on screen:
 * answer it with `setFiles()`.
 */
export class FileChooser {
  constructor(
    private connector: BiDiConnector,
    private info: FileDialogInfo,
  ) {}

  /** Whether the input lets the user pick several files */
  public isMultiple(): boolean {
    return this.info.multiple;
  }

  /**
   * Picks the files (an empty list picks none). Paths resolve against the working directory and must exist on the
   * machine the browser runs on.
   */
  public async setFiles(files: string | string[]): Promise<void> {
    const sharedId = (this.info.element as { sharedId?: string } | undefined)?.sharedId;
    if (!sharedId) throw new Error("file chooser has no element reference");
    const paths = resolveFiles(files);
    for (const file of paths) await assertIsFile(file, "setFiles");
    if (paths.length > 1 && !this.info.multiple) {
      throw new Error("file chooser does not accept multiple files");
    }
    await this.connector.send("input.setFiles", {
      context: this.info.context,
      element: { sharedId },
      files: paths,
    });
  }
}

interface EventMap {
  filechooser: [FileChooser];
}

/** Follows the file pickers of one page (frames included) */
export class FileChooserTracker {
  private events = new EventEmitter();
  private subscription: Subscription | undefined;
  private disposed = false;

  private constructor(
    private connector: BiDiConnector,
    private tree: ContextTree,
    private contextId: string,
  ) {}

  public static async start(connector: BiDiConnector, tree: ContextTree, contextId: string): Promise<FileChooserTracker> {
    const tracker = new FileChooserTracker(connector, tree, contextId);
    connector.onEvent("input.fileDialogOpened", tracker.onOpened);
    try {
      tracker.subscription = await connector.subscribe(["input.fileDialogOpened"]);
    } catch (err) {
      connector.offEvent("input.fileDialogOpened", tracker.onOpened);
      throw err;
    }
    return tracker;
  }

  public on(event: "filechooser", listener: (...args: EventMap["filechooser"]) => void): void {
    this.events.on(event, listener as (...args: unknown[]) => void);
  }

  public off(event: "filechooser", listener: (...args: EventMap["filechooser"]) => void): void {
    this.events.off(event, listener as (...args: unknown[]) => void);
  }

  /** Idempotent */
  public async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.connector.offEvent("input.fileDialogOpened", this.onOpened);
    await this.subscription?.unsubscribe();
  }

  private onOpened = (params: FileDialogInfo) => {
    if (!this.tree.isWithin(params.context, this.contextId)) return;
    const chooser = new FileChooser(this.connector, params);
    for (const listener of this.events.rawListeners("filechooser")) {
      try {
        listener(chooser);
      } catch (err) {
        logger.error("A filechooser listener threw", { err });
      }
    }
  };
}
