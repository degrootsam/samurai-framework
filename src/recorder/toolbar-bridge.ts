import logger from "../logger/index.js";
import type Page from "../browser/page.js";
import { callFunction } from "../script/call-function.js";
import { fromRemoteValue, type Arg } from "../script/serialize.js";
import type { ElementHandle } from "../script/element-handle.js";
import { locatorFromSpec } from "../steps/build.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";
import { addVariable, setSecret } from "../project/index.js";
import type { Observation } from "./normalise.js";
import type { ToolbarOptions } from "./options.js";
import { listSandboxRealms } from "./realms.js";
import { rankLocator } from "./ranking.js";
import { ToolbarController } from "./toolbar/controller.js";
import { inspectElement } from "./toolbar/inspect.js";
import {
  TOOLBAR_KEY,
  TOOLBAR_SANDBOX,
  type ToolbarMessage,
} from "./toolbar/protocol.js";

/** The toolbar's hook in its sandbox */
export const TOOLBAR_HOOK = `globalThis[Symbol.for(${JSON.stringify(TOOLBAR_KEY)})]`;

/** What the bridge needs of the recording it belongs to */
export interface BridgeHost {
  page: Page;
  connector: BiDiConnector;
  context: string;
  mute(): Promise<void>;
  unmute(): Promise<void>;
  /** A step the toolbar made (wait, screenshot, insert, assertion) */
  observe(observation: Observation): void;
  /** The toolbar's Stop, when the caller did not ask to be told */
  stop(): void;
  /** Runs `work` in order with the recording's other events */
  enqueue(work: () => Promise<void>): void;
}

/**
 * The recorder's side of the toolbar: builds its controller, sends it state and replies, and takes its messages
 * only from the toolbar's own sandbox realm (the page cannot reach that sandbox).
 */
export class ToolbarBridge {
  public readonly controller: ToolbarController;
  /** The context's `samurai-toolbar` sandbox realms, as last listed */
  private realms = new Set<string>();
  /** Messages waiting for a realm lookup, and those that arrived behind them (kept in order) */
  private backlog: Promise<void> = Promise.resolve();
  private waiting = 0;

  constructor(
    private readonly host: BridgeHost,
    toolbar: ToolbarOptions,
  ) {
    this.controller = this.createController(toolbar);
  }

  /** A message that came on the toolbar's channel from `realm` */
  public receive(realm: string, data: unknown): void {
    if (this.waiting === 0 && this.realms.has(realm)) {
      this.fromToolbar(data);
      return;
    }
    // A sandbox not seen yet (a new document's toolbar): look it up, and keep later messages behind it
    this.waiting++;
    this.backlog = this.backlog
      .then(async () => {
        if (!this.realms.has(realm)) await this.listRealms();
        if (this.realms.has(realm)) this.fromToolbar(data);
        else
          logger.warn(
            "Recorder ignored a toolbar message from outside the toolbar's sandbox",
          );
      })
      .catch((err: unknown) => {
        logger.debug("Could not check a toolbar message's realm", { err });
      })
      .finally(() => this.waiting--);
  }

  private async listRealms(): Promise<void> {
    this.realms = await listSandboxRealms(
      this.host.connector,
      this.host.context,
      TOOLBAR_SANDBOX,
    );
  }

  /** A message from the toolbar's own sandbox */
  private fromToolbar(data: unknown): void {
    const message = fromRemoteValue(
      data as Parameters<typeof fromRemoteValue>[0],
    ) as (ToolbarMessage & { target?: ElementHandle }) | { type: string };
    const controller = this.controller;
    if (message.type !== "toolbar" || !("action" in message)) return;
    if (message.action === "ready") {
      // Not behind a slow insert: the ready watchdog is waiting for it
      void controller.handle(message);
    } else if (controller.accept(message)) {
      // Decided as it arrives: a double click's second copy would only run after the first had finished
      this.host.enqueue(async () => controller.handle(message));
    }
  }

  private createController(toolbar: ToolbarOptions): ToolbarController {
    const { page, connector, context } = this.host;
    const { projectDir, environment, onStatus, onStop, onSecretAdded } =
      toolbar;
    return new ToolbarController(
      {
        push: (state) => this.call("update", [state]),
        reply: (id, result) => this.call("reply", [id, result]),
        currentUrl: () => page.url(),
        rank: (target, candidates) => rankLocator(page, target, candidates),
        inspect: (target, locator, candidates) =>
          inspectElement(page, connector, context, target, locator, candidates),
        type: async (locator, value) => {
          await this.host.mute();
          try {
            await locatorFromSpec(page, locator).fill(value, {
              timeout: 5000,
            });
          } finally {
            await this.host.unmute();
          }
        },
        mute: () => this.host.mute(),
        unmute: () => this.host.unmute(),
        addVariable: (name, value) =>
          addVariable(projectDir, environment, name, value),
        setSecret: (name, value) =>
          setSecret(projectDir, environment, name, value),
        secretAdded: (name) => onSecretAdded?.(name),
        observe: (observation) => this.host.observe(observation),
        stop: () => {
          if (onStop) onStop();
          else this.host.stop();
        },
        onStatus: (status) => onStatus?.(status),
      },
      toolbar,
    );
  }

  /** Calls the toolbar hook's `method` in the loaded document; a document between loads has no toolbar yet */
  private call(method: "update" | "reply", args: unknown[]): void {
    callFunction(
      this.host.connector,
      this.host.context,
      `(...args) => { ${TOOLBAR_HOOK}?.${method}(...args); }`,
      args as Arg[],
      { sandbox: TOOLBAR_SANDBOX, awaitPromise: false },
    ).catch((err: unknown) =>
      logger.debug("Could not reach the recorder toolbar", { err }),
    );
  }
}
