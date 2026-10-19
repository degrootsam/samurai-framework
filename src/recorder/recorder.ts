import { randomUUID } from "node:crypto";
import logger from "../logger/index.js";
import type Page from "../browser/page.js";
import { addPreload, runInLoadedContexts } from "../script/preload.js";
import { ChannelArg, fromRemoteValue } from "../script/serialize.js";
import type { ElementHandle } from "../script/element-handle.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";
import type { FileEntry, LocatorCall, LocatorSpec } from "../steps/model.js";
import {
  CAPTURE_MUTE,
  CAPTURE_OFF,
  CAPTURE_SOURCE,
  CAPTURE_UNMUTE,
} from "./capture.js";
import { FILES_SANDBOX, filesCaptureSource } from "./files-capture.js";
import { disposeFilesCapture, releasePageFile } from "./files-reader.js";
import { FilesRecorder, missingFileText } from "./files-recorder.js";
import { Normaliser, type RecorderEvent } from "./normalise.js";
import type {
  MissingFile,
  RecorderOptions,
  ToolbarOptions,
} from "./options.js";
import {
  observationFor,
  type FilesMessage,
  type PageMessage,
} from "./page-messages.js";
import { listSandboxRealms } from "./realms.js";
import { rankLocator } from "./ranking.js";
import { TOOLBAR_HOOK, ToolbarBridge } from "./toolbar-bridge.js";
import type { ToolbarController } from "./toolbar/controller.js";
import { TOOLBAR_SANDBOX } from "./toolbar/protocol.js";
import { TOOLBAR_SOURCE } from "./toolbar/source.js";

export type { RecorderEvent } from "./normalise.js";
export type {
  FileRecording,
  MissingFile,
  RecorderOptions,
  ToolbarOptions,
} from "./options.js";
export { missingFileText };

/**
 * Watches the tester use the page and reports steps as they happen. A preload script reports clicks,
 * typing and Alt+click assertions over a `script.message` channel; each element is given locators that
 * were checked against the page; the normaliser turns the stream into steps.
 */
export class Recorder {
  private readonly queue: { tail: Promise<void> } = { tail: Promise.resolve() };
  private readonly known = new Map<string, LocatorSpec | undefined>();
  private stopped = false;
  /** Set when stopping begins: files messages after it are not taken */
  private ending = false;
  private stopping: Promise<void> | undefined;
  private toolbar: ToolbarBridge | undefined;
  private files: FilesRecorder | undefined;

  private constructor(
    private readonly page: Page,
    private readonly connector: BiDiConnector,
    private readonly context: string,
    private readonly normaliser: Normaliser,
    private readonly options: RecorderOptions,
    /** The capture script's channel: page messages only */
    private readonly channel: string,
    /** The toolbar's channel, handed only to the toolbar's sandbox: toolbar messages only */
    private readonly toolbarChannel: string,
  ) {}

  /** The files capture script's channel, handed only to its sandbox */
  private readonly filesChannel = `samurai-files-${randomUUID()}`;
  private filesPreload: { dispose(): Promise<void> } | undefined;
  private filesRealms = new Set<string>();

  /** The toolbar's controller, when the recording has a toolbar */
  private get controller(): ToolbarController | undefined {
    return this.toolbar?.controller;
  }

  /** Files stored or reused in the files folder by this recording, project-relative */
  public get storedFiles(): string[] {
    return this.files?.storedFiles ?? [];
  }

  /** Files whose steps point at a path that wasn't written */
  public get missingFiles(): MissingFile[] {
    return this.files?.missingFiles ?? [];
  }

  public static async start(
    target: { page: Page; connector: BiDiConnector; context: string },
    options: RecorderOptions,
  ): Promise<Recorder> {
    const at = options.at ?? 0;
    const normaliser = new Normaliser({
      at,
      ...(options.baseURL !== undefined && { baseURL: options.baseURL }),
    });
    const recorder = new Recorder(
      target.page,
      target.connector,
      target.context,
      normaliser,
      options,
      // The connector's debug log leaves out the data of these channels' messages (it knows them by prefix)
      `samurai-recorder-${randomUUID()}`,
      `samurai-toolbar-${randomUUID()}`,
    );
    await recorder.begin(options.initialGoto ?? true);
    return recorder;
  }

  /**
   * Page messages come only on the capture channel; toolbar messages only on the toolbar channel and
   * only from the toolbar's sandbox realm. Neither channel is reachable from page script (each stays in
   * its script's closure, and the toolbar's in a sandbox the page cannot see); the realm check also
   * holds if a page realm ever got the toolbar's channel.
   */
  private readonly onMessage = (params: {
    channel: string;
    data: unknown;
    source: { context?: string; realm?: string };
  }) => {
    if (params.source.context !== this.context) return;
    if (params.channel === this.channel) {
      const message = fromRemoteValue(
        params.data as Parameters<typeof fromRemoteValue>[0],
      ) as PageMessage | { type: "toolbar" };
      if (message.type !== "toolbar")
        this.enqueue(async () => this.handle(message));
      return;
    }
    if (params.channel === this.filesChannel) {
      if (this.ending) return;
      const realm = params.source.realm ?? "";
      const data = params.data;
      // In order with the page's messages: a picker follows the click that opened it
      this.enqueue(async () => {
        if (!this.filesRealms.has(realm)) await this.listFilesRealms();
        if (!this.filesRealms.has(realm)) {
          logger.warn(
            "Recorder ignored a files message from outside the files sandbox",
          );
          return;
        }
        await this.fromFiles(
          fromRemoteValue(
            data as Parameters<typeof fromRemoteValue>[0],
          ) as FilesMessage,
        );
      });
      return;
    }
    if (params.channel !== this.toolbarChannel || !this.toolbar) return;
    this.toolbar.receive(params.source.realm ?? "", params.data);
  };

  private async listFilesRealms(): Promise<void> {
    this.filesRealms = await listSandboxRealms(
      this.connector,
      this.context,
      FILES_SANDBOX,
    );
  }

  private readonly onLoad = (params: { context: string; url: string }) => {
    if (params.context === this.context && params.url !== "about:blank")
      this.controller?.loaded();
  };

  private readonly onNavigation = (params: {
    context: string;
    url: string;
  }) => {
    if (params.context !== this.context || params.url === "about:blank") return;
    this.controller?.navigating();
    this.known.clear();
    this.enqueue(async () => {
      // Paused: navigations are not recorded either
      if (this.controller?.paused) return;
      this.emit(this.normaliser.navigated(params.url, Date.now()));
    });
  };

  private subscription: { unsubscribe(): Promise<void> } | undefined;
  private preload: { dispose(): Promise<void> } | undefined;
  private toolbarPreload: { dispose(): Promise<void> } | undefined;

  private async begin(initialGoto: boolean): Promise<void> {
    const toolbar = this.options.toolbar;
    if (toolbar) this.toolbar = this.createToolbar(toolbar);
    this.files = this.createFiles();
    this.connector.onEvent("script.message", this.onMessage);
    this.connector.onEvent(
      "browsingContext.navigationStarted",
      this.onNavigation,
    );
    if (toolbar) this.connector.onEvent("browsingContext.load", this.onLoad);
    try {
      this.subscription = await this.connector.subscribe([
        "script.message",
        "browsingContext.navigationStarted",
        ...(toolbar ? (["browsingContext.load"] as const) : []),
      ]);
      if (initialGoto) {
        const url = await this.page.url();
        if (url !== "about:blank") this.emit(this.normaliser.initialGoto(url));
      }
      this.preload = await addPreload(this.connector, {
        source: CAPTURE_SOURCE,
        contexts: [this.context],
        arguments: [new ChannelArg(this.channel)],
        onRunError: "log",
      });
      if (this.options.files) {
        this.filesPreload = await addPreload(this.connector, {
          source: filesCaptureSource({
            trustSynthetic: this.options.files.trustSynthetic === true,
          }),
          sandbox: FILES_SANDBOX,
          contexts: [this.context],
          arguments: [new ChannelArg(this.filesChannel)],
          onRunError: "log",
        });
      }
      if (this.toolbar) {
        this.toolbarPreload = await addPreload(this.connector, {
          source: TOOLBAR_SOURCE,
          sandbox: TOOLBAR_SANDBOX,
          contexts: [this.context],
          arguments: [new ChannelArg(this.toolbarChannel)],
          onRunError: "log",
        });
        // The document that is loaded now gets its state and its ready watchdog as a new one would
        this.toolbar.controller.loaded();
      }
    } catch (err) {
      this.controller?.dispose();
      await this.release();
      throw err;
    }
  }

  private createToolbar(toolbar: ToolbarOptions): ToolbarBridge {
    return new ToolbarBridge(
      {
        page: this.page,
        connector: this.connector,
        context: this.context,
        mute: () => this.mute(),
        unmute: () => this.unmute(),
        observe: (observation) =>
          this.emit(this.normaliser.observe(observation, Date.now())),
        stop: () => void this.stop(),
        enqueue: (work) => this.enqueue(work),
      },
      toolbar,
    );
  }

  private createFiles(): FilesRecorder | undefined {
    const recording = this.options.files;
    if (!recording) return undefined;
    return new FilesRecorder(this.connector, this.context, recording, {
      warn: (text) => this.controller?.warn(text),
      saving: (name) => this.controller?.saving(name),
    });
  }

  private enqueue(work: () => Promise<void>): void {
    this.queue.tail = this.queue.tail.then(work).catch((err: unknown) => {
      logger.warn("Recorder could not process an event", { err });
    });
  }

  private emit(events: RecorderEvent[]): void {
    if (this.stopped) return;
    for (const event of events) {
      this.options.onEvent(event);
      if (event.op === "insert") this.controller?.stepAdded(event.step);
      else if (event.op === "remove") this.controller?.stepRemoved();
    }
  }

  private async locatorFor(message: {
    target: ElementHandle;
    candidates: LocatorCall[];
  }): Promise<LocatorSpec | undefined> {
    const { sharedId } = message.target;
    if (this.known.has(sharedId)) return this.known.get(sharedId);
    const spec = await rankLocator(
      this.page,
      message.target,
      message.candidates,
    );
    this.known.set(sharedId, spec);
    return spec;
  }

  private async handle(message: PageMessage): Promise<void> {
    // Paused: what the capture script still reports (before a new document is muted) is dropped
    if (this.controller?.paused) return;
    const locator = await this.locatorFor(message);
    if (!locator) {
      logger.warn(
        "Recorder found no locator that matches only the element the tester used; the %s was skipped",
        message.type,
      );
      return;
    }
    const observation = observationFor(message, locator);
    this.emit(this.normaliser.observe(observation, Date.now()));
  }

  private async fromFiles(message: FilesMessage): Promise<void> {
    const now = Date.now();
    if (message.type !== "files") {
      if (!this.controller?.paused)
        this.emit(this.normaliser.observe(message, now));
      return;
    }
    const release = (from: number) =>
      Promise.allSettled(
        message.files
          .slice(from)
          .map((file) =>
            releasePageFile(this.connector, this.context, file.id),
          ),
      );
    if (this.controller?.paused) return void (await release(0));
    // storePageFile releases its own file; whatever it never reached is released here, on any exit
    let started = 0;
    try {
      const locator = await this.locatorFor(message);
      if (!locator) {
        logger.warn(
          "Recorder found no locator that matches only the element the files were %s; the upload was skipped",
          message.via === "drop" ? "dropped on" : "set on",
        );
        return;
      }
      const files: FileEntry[] = [];
      for (const file of message.files) {
        started++;
        files.push({ path: await this.files!.store(file) });
      }
      this.emit(
        this.normaliser.observe(
          { type: "files", via: message.via, locator, files },
          now,
        ),
      );
    } finally {
      await release(started);
    }
  }

  private async release(): Promise<void> {
    this.connector.offEvent("script.message", this.onMessage);
    this.connector.offEvent(
      "browsingContext.navigationStarted",
      this.onNavigation,
    );
    this.connector.offEvent("browsingContext.load", this.onLoad);
    await Promise.allSettled([
      this.subscription?.unsubscribe(),
      this.preload?.dispose(),
      this.toolbarPreload?.dispose(),
      this.filesPreload?.dispose(),
    ]);
  }

  /**
   * Pauses capture in the loaded document: clicks and typing are not reported until `unmute`.
   * @internal
   */
  public async mute(): Promise<void> {
    await this.setMuted(CAPTURE_MUTE);
  }

  /** @internal */
  public async unmute(): Promise<void> {
    await this.setMuted(CAPTURE_UNMUTE);
  }

  private async setMuted(source: string): Promise<void> {
    await runInLoadedContexts(this.connector, {
      source,
      contexts: [this.context],
      onRunError: "log",
    });
  }

  /** Stops recording. Events already received are still processed and reported first */
  public stop(): Promise<void> {
    this.stopping ??= this.end();
    return this.stopping;
  }

  private async end(): Promise<void> {
    if (this.stopped) return;
    this.ending = true;
    this.controller?.dispose();
    await runInLoadedContexts(this.connector, {
      source: CAPTURE_OFF,
      contexts: [this.context],
      onRunError: "log",
    }).catch(() => undefined);
    // A later recording of this document must not start muted
    if (this.controller?.paused) await this.unmute().catch(() => undefined);
    if (this.toolbarPreload) {
      // The window may stay open: take the toolbar and its listeners off the page
      await runInLoadedContexts(this.connector, {
        source: `() => { ${TOOLBAR_HOOK}?.dispose(); }`,
        contexts: [this.context],
        sandbox: TOOLBAR_SANDBOX,
        onRunError: "log",
      }).catch(() => undefined);
    }
    await this.queue.tail;
    // Only now: started and queued transfers need the kept Files
    if (this.filesPreload)
      await disposeFilesCapture(this.connector, this.context).catch(
        () => undefined,
      );
    this.stopped = true;
    await this.release();
  }
}
