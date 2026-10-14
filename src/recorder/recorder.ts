import { randomUUID } from "node:crypto";
import logger from "../logger/index.js";
import type Page from "../browser/page.js";
import { addPreload, runInLoadedContexts } from "../script/preload.js";
import { callFunction } from "../script/call-function.js";
import { ChannelArg, fromRemoteValue, type Arg } from "../script/serialize.js";
import { ElementHandle } from "../script/element-handle.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";
import type { LocatorCall, LocatorSpec } from "../steps/model.js";
import { locatorFromSpec } from "../steps/build.js";
import { addVariable, setSecret } from "../project/index.js";
import {
  CAPTURE_MUTE,
  CAPTURE_OFF,
  CAPTURE_SOURCE,
  CAPTURE_UNMUTE,
} from "./capture.js";
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
  /** Called when the recording is paused or resumed, or the toolbar fails (or comes back) on a page */
  onStatus?: ControllerDeps["onStatus"];
  /** A secret was saved to `.env.<environment>` from the panel (before its value is typed) */
  onSecretAdded?: (name: string) => void;
  /** The toolbar's Stop. Without it, Stop stops the recorder */
  onStop?: () => void;
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
  private stopping: Promise<void> | undefined;
  private controller: ToolbarController | undefined;

  private constructor(
    private readonly page: Page,
    private readonly connector: BiDiConnector,
    private readonly context: string,
    private readonly normaliser: Normaliser,
    private readonly options: RecorderOptions,
    private readonly channel: string,
  ) {}

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
      `samurai-recorder-${randomUUID()}`,
    );
    await recorder.begin(options.initialGoto ?? true);
    return recorder;
  }

  private readonly onMessage = (params: {
    channel: string;
    data: unknown;
    source: { context?: string };
  }) => {
    if (
      params.channel !== this.channel ||
      params.source.context !== this.context
    )
      return;
    const message = fromRemoteValue(
      params.data as Parameters<typeof fromRemoteValue>[0],
    ) as PageMessage | (ToolbarMessage & { target?: ElementHandle });
    const controller = this.controller;
    if (message.type !== "toolbar") {
      this.enqueue(async () => this.handle(message));
    } else if (controller && message.action === "ready") {
      // Not behind a slow insert: the ready watchdog is waiting for it
      void controller.handle(message);
    } else if (controller?.accept(message)) {
      // Decided as it arrives: a double click's second copy would only run after the first had finished
      this.enqueue(async () => controller.handle(message));
    }
  };

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
      if (this.controller) {
        this.toolbarPreload = await addPreload(this.connector, {
          source: TOOLBAR_SOURCE,
          sandbox: TOOLBAR_SANDBOX,
          contexts: [this.context],
          arguments: [new ChannelArg(this.channel)],
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
    }
  }

  private async locatorFor(
    message: PageMessage,
  ): Promise<LocatorSpec | undefined> {
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
    this.stopped = true;
    await this.release();
  }
}
