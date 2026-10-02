import { randomUUID } from "node:crypto";
import logger from "../logger/index.js";
import type Page from "../browser/page.js";
import { addPreload, runInLoadedContexts } from "../script/preload.js";
import { ChannelArg, fromRemoteValue } from "../script/serialize.js";
import { ElementHandle } from "../script/element-handle.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";
import type { LocatorCall, LocatorSpec } from "../steps/model.js";
import { CAPTURE_OFF, CAPTURE_SOURCE } from "./capture.js";
import {
  Normaliser,
  type Observation,
  type RecorderEvent,
} from "./normalise.js";
import { rankLocator } from "./ranking.js";

export type { RecorderEvent } from "./normalise.js";

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
}

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
    ) as PageMessage;
    this.enqueue(async () => this.handle(message));
  };

  private readonly onNavigation = (params: {
    context: string;
    url: string;
  }) => {
    if (params.context !== this.context || params.url === "about:blank") return;
    this.known.clear();
    this.enqueue(async () =>
      this.emit(this.normaliser.navigated(params.url, Date.now())),
    );
  };

  private subscription: { unsubscribe(): Promise<void> } | undefined;
  private preload: { dispose(): Promise<void> } | undefined;

  private async begin(initialGoto: boolean): Promise<void> {
    this.connector.onEvent("script.message", this.onMessage);
    this.connector.onEvent(
      "browsingContext.navigationStarted",
      this.onNavigation,
    );
    try {
      this.subscription = await this.connector.subscribe([
        "script.message",
        "browsingContext.navigationStarted",
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
    } catch (err) {
      await this.release();
      throw err;
    }
  }

  private enqueue(work: () => Promise<void>): void {
    this.queue.tail = this.queue.tail.then(work).catch((err: unknown) => {
      logger.warn("Recorder could not process an event", { err });
    });
  }

  private emit(events: RecorderEvent[]): void {
    if (this.stopped) return;
    for (const event of events) this.options.onEvent(event);
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
    await Promise.allSettled([
      this.subscription?.unsubscribe(),
      this.preload?.dispose(),
    ]);
  }

  /** Stops recording. Events already received are still processed and reported first */
  public async stop(): Promise<void> {
    if (this.stopped) return;
    await runInLoadedContexts(this.connector, {
      source: CAPTURE_OFF,
      contexts: [this.context],
      onRunError: "log",
    }).catch(() => undefined);
    await this.queue.tail;
    this.stopped = true;
    await this.release();
  }
}
