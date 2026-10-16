import { randomUUID } from "node:crypto";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import logger from "../logger/index.js";
import type Page from "../browser/page.js";
import { addPreload, runInLoadedContexts } from "../script/preload.js";
import { callFunction } from "../script/call-function.js";
import { ChannelArg, fromRemoteValue, type Arg } from "../script/serialize.js";
import { ElementHandle } from "../script/element-handle.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";
import type { FileEntry, LocatorCall, LocatorSpec } from "../steps/model.js";
import { locatorFromSpec } from "../steps/build.js";
import {
  addVariable,
  cleanFileName,
  filesFolder,
  RECORD_LIMIT,
  setSecret,
  storeFile,
} from "../project/index.js";
import { humanSize } from "../steps/files.js";
import {
  CAPTURE_MUTE,
  CAPTURE_OFF,
  CAPTURE_SOURCE,
  CAPTURE_UNMUTE,
} from "./capture.js";
import { FILES_SANDBOX, filesCaptureSource } from "./files-capture.js";
import {
  disposeFilesCapture,
  readPageFile,
  releasePageFile,
} from "./files-reader.js";
import {
  Normaliser,
  type Observation,
  type RecorderEvent,
} from "./normalise.js";
import { rankLocator } from "./ranking.js";
import {
  ToolbarController,
  type ControllerDeps,
  type ControllerOptions,
} from "./toolbar/controller.js";
import { inspectElement } from "./toolbar/inspect.js";
import {
  TOOLBAR_KEY,
  TOOLBAR_SANDBOX,
  type ToolbarMessage,
} from "./toolbar/protocol.js";
import { TOOLBAR_SOURCE } from "./toolbar/source.js";

export type { RecorderEvent } from "./normalise.js";

/** The toolbar's settings: the recording's environment, and where its variables and secrets are written */
export type ToolbarOptions = ControllerOptions & {
  /** The project folder: `samurai.config.ts` and `.env.<environment>` */
  projectDir: string;
  /**
   * Called when the recording is paused or resumed, or the toolbar fails (or comes back) on a page.
   * There is no initial call: until the first one the recording is `{ state: "recording", toolbar: true }`
   */
  onStatus?: ControllerDeps["onStatus"];
  /** A secret was saved to `.env.<environment>` from the panel (before its value is typed) */
  onSecretAdded?: (name: string) => void;
  /**
   * The toolbar's Stop; the caller then stops the recording (`recorder.stop()`), as `recordSpec` does.
   * Without it, Stop runs `recorder.stop()` itself: the toolbar goes away and nothing more is recorded, but
   * nothing tells the `page.record()` caller, so pass `onStop` to learn of it.
   */
  onStop?: () => void;
};

/** Where uploads made while recording are stored */
export interface FileRecording {
  /** The project folder */
  projectDir: string;
  /** Relative to the project folder. @default "files" */
  filesDir?: string;
  /** A file that isn't stored (over 50 MB, or unreadable): its step points at `path`, which doesn't exist */
  onMissing?: (file: MissingFile) => void;
  /** @internal Tests only: also record events no person caused (`isTrusted` false) */
  trustSynthetic?: boolean;
}

export interface MissingFile {
  /** Project-relative, as the step has it */
  path: string;
  name: string;
  size: number;
  reason: "too-big" | "unreadable";
}

/** What the files capture script sends */
type FilesMessage =
  | { type: "picker" }
  | { type: "picker-cancel" }
  | {
      type: "files";
      via: "input" | "drop";
      target: ElementHandle;
      candidates: LocatorCall[];
      files: { id: number; name: string; type: string; size: number }[];
    };

export interface RecorderOptions {
  /** Called for every step the tester produces, in order. Steps get indexes from `at` on */
  onEvent: (event: RecorderEvent) => void;
  /**
   * Index the first recorded step gets: record from the middle of a test by passing the number of steps
   * before it. The page must already be in the state those steps lead to; replaying them is up to the caller.
   * @default 0
   */
  at?: number;
  /** Write the page the recording starts on as a `goto` step. Pass false when `at` > 0. @default true */
  initialGoto?: boolean;
  /** URLs inside it are written relative to it, as `page.goto` resolves them */
  baseURL?: string;
  /** Shows the recorder toolbar in the page (pause, assert, insert, wait, screenshot, stop). Without it, no toolbar */
  toolbar?: ToolbarOptions;
  /** Records uploads (file inputs and drops) into the project's files folder. Without it, uploads aren't recorded */
  files?: FileRecording;
}

/** The toolbar's hook in its sandbox */
const HOOK = `globalThis[Symbol.for(${JSON.stringify(TOOLBAR_KEY)})]`;

/** What the capture script sends */
interface PageMessage {
  type: "click" | "input" | "press" | "assert";
  target: ElementHandle;
  candidates: LocatorCall[];
  textEntry?: boolean;
  /** The key of a `press` message */
  pressed?: string;
  value?: string;
  secret?: boolean;
  secretName?: string;
  text?: string;
}

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
  private controller: ToolbarController | undefined;

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
  private readonly stored = new Set<string>();
  private readonly missing: MissingFile[] = [];

  /** Files stored or reused in the files folder by this recording, project-relative */
  public get storedFiles(): string[] {
    return [...this.stored];
  }

  /** Files whose steps point at a path that wasn't written */
  public get missingFiles(): MissingFile[] {
    return [...this.missing];
  }

  /** The context's `samurai-toolbar` sandbox realms, as last listed: the only realms toolbar messages are taken from */
  private toolbarRealms = new Set<string>();
  /** Toolbar messages waiting for a realm lookup, and those that arrived behind them (kept in order) */
  private toolbarBacklog: Promise<void> = Promise.resolve();
  private toolbarWaiting = 0;

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
    if (params.channel !== this.toolbarChannel || !this.controller) return;
    const realm = params.source.realm ?? "";
    if (this.toolbarWaiting === 0 && this.toolbarRealms.has(realm)) {
      this.fromToolbar(params.data);
      return;
    }
    // A sandbox not seen yet (a new document's toolbar): look it up, and keep later messages behind it
    this.toolbarWaiting++;
    this.toolbarBacklog = this.toolbarBacklog
      .then(async () => {
        if (!this.toolbarRealms.has(realm)) await this.listToolbarRealms();
        if (this.toolbarRealms.has(realm)) this.fromToolbar(params.data);
        else
          logger.warn(
            "Recorder ignored a toolbar message from outside the toolbar's sandbox",
          );
      })
      .catch((err: unknown) => {
        logger.debug("Could not check a toolbar message's realm", { err });
      })
      .finally(() => this.toolbarWaiting--);
  };

  private async listFilesRealms(): Promise<void> {
    const { realms } = await this.connector.send("script.getRealms", {
      context: this.context,
      type: "window",
    });
    this.filesRealms = new Set(
      realms
        .filter(
          (info) => info.type === "window" && info.sandbox === FILES_SANDBOX,
        )
        .map((info) => info.realm),
    );
  }

  private async listToolbarRealms(): Promise<void> {
    const { realms } = await this.connector.send("script.getRealms", {
      context: this.context,
      type: "window",
    });
    this.toolbarRealms = new Set(
      realms
        .filter(
          (info) => info.type === "window" && info.sandbox === TOOLBAR_SANDBOX,
        )
        .map((info) => info.realm),
    );
  }

  /** A message from the toolbar's own sandbox */
  private fromToolbar(data: unknown): void {
    const message = fromRemoteValue(
      data as Parameters<typeof fromRemoteValue>[0],
    ) as (ToolbarMessage & { target?: ElementHandle }) | { type: string };
    const controller = this.controller;
    if (!controller || message.type !== "toolbar" || !("action" in message))
      return;
    if (message.action === "ready") {
      // Not behind a slow insert: the ready watchdog is waiting for it
      void controller.handle(message);
    } else if (controller.accept(message)) {
      // Decided as it arrives: a double click's second copy would only run after the first had finished
      this.enqueue(async () => controller.handle(message));
    }
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
    if (toolbar) this.controller = this.createController(toolbar);
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
      if (this.controller) {
        this.toolbarPreload = await addPreload(this.connector, {
          source: TOOLBAR_SOURCE,
          sandbox: TOOLBAR_SANDBOX,
          contexts: [this.context],
          arguments: [new ChannelArg(this.toolbarChannel)],
          onRunError: "log",
        });
        // The document that is loaded now gets its state and its ready watchdog as a new one would
        this.controller.loaded();
      }
    } catch (err) {
      this.controller?.dispose();
      await this.release();
      throw err;
    }
  }

  private createController(toolbar: ToolbarOptions): ToolbarController {
    const { projectDir, environment, onStatus, onStop, onSecretAdded } =
      toolbar;
    return new ToolbarController(
      {
        push: (state) => this.callToolbar("update", [state]),
        reply: (id, result) => this.callToolbar("reply", [id, result]),
        currentUrl: () => this.page.url(),
        rank: (target, candidates) =>
          rankLocator(this.page, target, candidates),
        inspect: (target, locator, candidates) =>
          inspectElement(
            this.page,
            this.connector,
            this.context,
            target,
            locator,
            candidates,
          ),
        type: async (locator, value) => {
          await this.mute();
          try {
            await locatorFromSpec(this.page, locator).fill(value, {
              timeout: 5000,
            });
          } finally {
            await this.unmute();
          }
        },
        mute: () => this.mute(),
        unmute: () => this.unmute(),
        addVariable: (name, value) =>
          addVariable(projectDir, environment, name, value),
        setSecret: (name, value) =>
          setSecret(projectDir, environment, name, value),
        secretAdded: (name) => onSecretAdded?.(name),
        observe: (observation) =>
          this.emit(this.normaliser.observe(observation, Date.now())),
        stop: () => {
          if (onStop) onStop();
          else void this.stop();
        },
        onStatus: (status) => onStatus?.(status),
      },
      toolbar,
    );
  }

  /** Calls the toolbar hook's `method` in the loaded document; a document between loads has no toolbar yet */
  private callToolbar(method: "update" | "reply", args: unknown[]): void {
    callFunction(
      this.connector,
      this.context,
      `(...args) => { ${HOOK}?.${method}(...args); }`,
      args as Arg[],
      { sandbox: TOOLBAR_SANDBOX, awaitPromise: false },
    ).catch((err: unknown) =>
      logger.debug("Could not reach the recorder toolbar", { err }),
    );
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
    const key = message.target.sharedId;
    const observation: Observation =
      message.type === "click"
        ? { type: "click", key, locator, textEntry: message.textEntry === true }
        : message.type === "press"
          ? { type: "press", key, locator, pressed: message.pressed ?? "" }
          : message.type === "assert"
            ? {
                type: "assert",
                key,
                locator,
                text: message.text ?? "",
                ...(message.value !== undefined && { value: message.value }),
              }
            : {
                type: "input",
                key,
                locator,
                ...(message.value !== undefined && { value: message.value }),
                ...(message.secret && { secret: true }),
                ...(message.secretName !== undefined && {
                  secretName: message.secretName,
                }),
              };
    this.emit(this.normaliser.observe(observation, Date.now()));
  }

  private async fromFiles(message: FilesMessage): Promise<void> {
    const now = Date.now();
    if (message.type !== "files") {
      if (!this.controller?.paused)
        this.emit(this.normaliser.observe(message, now));
      return;
    }
    const release = () =>
      Promise.allSettled(
        message.files.map((file) =>
          releasePageFile(this.connector, this.context, file.id),
        ),
      );
    if (this.controller?.paused) return void (await release());
    const locator = await this.locatorFor(message);
    if (!locator) {
      logger.warn(
        "Recorder found no locator that matches only the element the files were %s; the upload was skipped",
        message.via === "drop" ? "dropped on" : "set on",
      );
      return void (await release());
    }
    const files: FileEntry[] = [];
    for (const file of message.files)
      files.push({ path: await this.storePageFile(file) });
    this.emit(
      this.normaliser.observe(
        { type: "files", via: message.via, locator, files },
        now,
      ),
    );
  }

  /** Saves one kept file to the files folder; returns the path its step gets */
  private async storePageFile(file: {
    id: number;
    name: string;
    size: number;
  }): Promise<string> {
    const recording = this.options.files!;
    const folder = filesFolder(recording.projectDir, recording.filesDir);
    const notSaved = (reason: MissingFile["reason"]) => {
      const missing: MissingFile = {
        path: `${folder.relative}/${cleanFileName(file.name)}`,
        name: file.name,
        size: file.size,
        reason,
      };
      this.missing.push(missing);
      recording.onMissing?.(missing);
      this.controller?.warn(missingFileText(missing, folder.relative));
      return missing.path;
    };
    if (file.size > RECORD_LIMIT) {
      await releasePageFile(this.connector, this.context, file.id).catch(
        () => undefined,
      );
      return notSaved("too-big");
    }
    this.controller?.saving(file.name);
    const temp = await mkdtemp(path.join(tmpdir(), "samurai-upload-"));
    try {
      const content = path.join(temp, "content");
      const out = await open(content, "w");
      try {
        await readPageFile(
          this.connector,
          this.context,
          file.id,
          file.size,
          (bytes) => out.write(bytes),
        );
      } finally {
        await out.close();
      }
      const stored = await storeFile({
        projectDir: recording.projectDir,
        ...(recording.filesDir !== undefined && {
          filesDir: recording.filesDir,
        }),
        name: file.name,
        content,
      });
      this.stored.add(stored.path);
      return stored.path;
    } catch (err) {
      logger.warn("Recorder could not save %s", file.name, { err });
      return notSaved("unreadable");
    } finally {
      this.controller?.saving(undefined);
      await rm(temp, { recursive: true, force: true }).catch(() => undefined);
      await releasePageFile(this.connector, this.context, file.id).catch(
        () => undefined,
      );
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
        source: `() => { ${HOOK}?.dispose(); }`,
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

/** The warning for a file that isn't saved, as the toolbar and the CLI show it */
export function missingFileText(file: MissingFile, folder: string): string {
  return file.reason === "too-big"
    ? `${file.name} is ${humanSize(file.size)}. Files over 50 MB aren't saved: add it to ${folder}/ yourself, or use a generated file.`
    : `${file.name} couldn't be read, so it isn't saved: add it to ${folder}/ yourself, or use a generated file.`;
}
