import { cleanName } from "../../browser/evidence.js";
import type { Step } from "../../steps/model.js";
import { ActionGuard } from "./action-guard.js";
import { assertAction } from "./actions/assert.js";
import { addInsertableAction, insertAction } from "./actions/insert.js";
import { withoutSecrets } from "./actions/pick.js";
import { fail, PAUSED, UNIDENTIFIABLE } from "./actions/reply.js";
import { LEFT, PageScope } from "./page-scope.js";
import type { ActionReply, PickInfo, ToolbarState } from "./protocol.js";
import type {
  ActionContext,
  ControllerDeps,
  ControllerOptions,
  Inspection,
  Message,
  Of,
  PickState,
} from "./types.js";

/** A wait for time is 0.1–60 s */
const WAIT_MIN_MS = 100;
const WAIT_MAX_MS = 60000;

/** How long a loaded page's toolbar has to say `ready` */
const READY_WITHIN = 2000;

/**
 * The recorder's side of the toolbar: owns its state (pause, the rail, the environment's variables and
 * secrets) and turns its messages into observations. Secret values stay here; the page only ever gets
 * their names and whether they are set.
 */
export class ToolbarController {
  private status: "recording" | "paused" = "recording";
  private collapsed = false;
  private position: { x: number; y: number } | null = null;
  private steps = 0;
  private screenshots: number;
  private readonly variables: Map<string, string>;
  private readonly secrets: Map<string, string | undefined>;
  private pausedAt: string | undefined;
  /** The URL the resume question offers; set while it is asked */
  private question: string | undefined;
  private toast: { id: number; text: string } | undefined;
  private toastId = 0;
  private savingName: string | undefined;
  private warnings: { id: number; text: string }[] = [];
  private warningId = 0;
  private pick: PickState | undefined;
  private readonly guard = new ActionGuard();
  private readonly scope = new PageScope();
  private toolbar = true;
  /** A `ready` arrived since the last load: it counts for the next one */
  private readySinceLoad = false;
  private watchdog: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(
    private readonly deps: ControllerDeps,
    private readonly options: ControllerOptions,
  ) {
    this.screenshots = options.screenshots;
    this.variables = new Map(
      Object.entries(options.variables).map(([name, value]) => [
        name,
        String(value),
      ]),
    );
    this.secrets = new Map(Object.entries(options.secrets));
    this.actions = {
      deps,
      options,
      variables: this.variables,
      secrets: this.secrets,
      isPaused: () => this.paused,
      pick: () => this.pick,
      setPick: (pick) => {
        this.pick = pick;
      },
      showToast: (text) => this.showToast(text),
      push: () => this.push(),
    };
  }

  /** What the action handlers (assert, insert, add) use of this controller */
  private readonly actions: ActionContext;

  public get paused(): boolean {
    return this.status === "paused";
  }

  private state(): ToolbarState {
    return {
      status: this.status,
      collapsed: this.collapsed,
      position: this.position,
      steps: this.steps,
      environment: this.options.environment,
      canAddVariables: this.options.canAddVariables,
      variables: [...this.variables].map(([name, value]) => ({ name, value })),
      secrets: [...this.secrets].map(([name, value]) => ({
        name,
        set: value !== undefined,
      })),
      secretsIgnored: this.options.secretsIgnored,
      resumeQuestion: this.question !== undefined,
      nextScreenshot: `screenshot-${this.screenshots + 1}`,
      ...(this.toast && { toast: this.toast }),
      ...(this.savingName !== undefined && { saving: this.savingName }),
      warnings: this.warnings.map((w) => ({ ...w })),
    };
  }

  private push(): void {
    if (!this.disposed) this.deps.push(this.state());
  }

  private reply(id: number, result: PickInfo | ActionReply): void {
    if (!this.disposed) this.deps.reply(id, result);
  }

  private reportStatus(): void {
    if (!this.disposed)
      this.deps.onStatus({ state: this.status, toolbar: this.toolbar });
  }

  private setToolbar(loaded: boolean): void {
    if (this.toolbar === loaded) return;
    this.toolbar = loaded;
    this.reportStatus();
  }

  /** A picked or dropped file is being saved; undefined when done */
  public saving(name: string | undefined): void {
    this.savingName = name;
    this.push();
  }

  /** Shows a warning that stays until the tester dismisses it */
  public warn(text: string): void {
    this.warnings.push({ id: ++this.warningId, text });
    this.push();
  }

  private showToast(text: string): void {
    this.toast = { id: ++this.toastId, text };
  }

  public async handle(message: Message): Promise<void> {
    if (this.disposed) return;
    switch (message.action) {
      case "ready":
        return this.ready(message.url);
      case "pause":
        return this.pause();
      case "resume":
        return this.resume();
      case "resume-goto":
        return this.answer(message.add);
      case "stop":
        return this.deps.stop();
      case "move":
        if (!Number.isFinite(message.x) || !Number.isFinite(message.y)) return;
        this.position = { x: Math.round(message.x), y: Math.round(message.y) };
        return this.push();
      case "collapse":
        this.collapsed = message.collapsed === true;
        this.pick = undefined;
        return this.push();
      case "dismiss":
        this.warnings = this.warnings.filter((w) => w.id !== message.id);
        return this.push();
      case "pick":
        return this.picked(message);
      case "assert":
        return this.replying(message, () =>
          assertAction(this.actions, message),
        );
      case "insert":
        return this.replying(message, () =>
          insertAction(this.actions, message),
        );
      case "add-insertable":
        return this.replying(message, () =>
          addInsertableAction(this.actions, message),
        );
      case "wait":
        if (this.paused) return;
        if (message.kind === "time") {
          if (!Number.isFinite(message.ms) || message.ms < 0) return;
          // The panel's range (0.1–60 s), whatever the message says
          const ms = Math.min(
            WAIT_MAX_MS,
            Math.max(WAIT_MIN_MS, Math.round(message.ms)),
          );
          this.deps.observe({ type: "wait-time", ms });
        } else {
          this.deps.observe({ type: "wait-idle" });
        }
        this.showToast("Wait step added");
        return this.push();
      case "screenshot":
        if (this.paused) return;
        this.deps.observe({
          type: "screenshot",
          name: cleanName(String(message.name ?? "")),
          fullPage: message.fullPage === true,
        });
        this.showToast("Screenshot step added");
        return this.push();
    }
  }

  /** A top-level document finished loading: push state; start the 2 s ready watchdog */
  public loaded(): void {
    if (this.disposed) return;
    this.scope.enter();
    this.pick = undefined;
    this.toast = undefined;
    this.push();
    // A new document starts with capture on
    if (this.paused) void this.deps.mute().catch(() => undefined);
    clearTimeout(this.watchdog);
    this.watchdog = undefined;
    if (this.readySinceLoad) {
      this.readySinceLoad = false;
      this.setToolbar(true);
      return;
    }
    this.watchdog = setTimeout(() => {
      this.watchdog = undefined;
      this.setToolbar(false);
    }, READY_WITHIN);
  }

  /**
   * A top-level navigation to a new document started: a `ready` from before it belongs to the old document
   * and doesn't count for the coming load
   */
  public navigating(): void {
    this.readySinceLoad = false;
    this.scope.leave();
  }

  /** A step was emitted (any source): count it */
  public stepAdded(step: Step): void {
    this.steps++;
    if (step.kind === "screenshot") this.screenshots++;
    this.push();
  }

  /** A recorded step was taken out again (a cancelled file picker's click) */
  public stepRemoved(): void {
    this.steps = Math.max(0, this.steps - 1);
    this.push();
  }

  /** The recording ended: no more pushes, replies or status */
  public dispose(): void {
    this.disposed = true;
    clearTimeout(this.watchdog);
    this.watchdog = undefined;
  }

  /**
   * The toolbar draws at document start, so its `ready` usually comes before the load; Firefox also runs it
   * in a transient about:blank while navigating. A `ready` that arrives while the watchdog runs settles it;
   * any other counts for the next load.
   */
  private ready(url: string | undefined): void {
    // The transient about:blank Firefox passes through while navigating is not the page being recorded
    if (url === "about:blank") return;
    if (this.watchdog !== undefined) {
      clearTimeout(this.watchdog);
      this.watchdog = undefined;
    } else if (this.toolbar) {
      this.readySinceLoad = true;
    }
    this.setToolbar(true);
    this.push();
  }

  private async pause(): Promise<void> {
    if (this.paused) return;
    this.status = "paused";
    this.question = undefined;
    this.pick = undefined;
    this.push();
    this.reportStatus();
    const [, url] = await Promise.all([
      this.deps.mute(),
      this.deps.currentUrl(),
    ]);
    this.pausedAt = url;
  }

  private async resume(): Promise<void> {
    if (!this.paused) return;
    const url = await this.deps.currentUrl();
    await this.deps.unmute();
    this.status = "recording";
    this.question =
      this.pausedAt !== undefined && url !== this.pausedAt ? url : undefined;
    this.pausedAt = undefined;
    this.push();
    this.reportStatus();
  }

  private answer(add: boolean): void {
    const url = this.question;
    if (url === undefined) return;
    this.question = undefined;
    if (add === true) this.deps.observe({ type: "goto", url });
    this.push();
  }

  /**
   * Whether to process `message`; call it as the message arrives, before queueing it. An `assert`, `insert` or
   * `add-insertable` whose id is in flight or was already answered `{ ok: true }` is a double click and is
   * dropped (its first copy answers). A retry after `{ ok: false }` is accepted.
   */
  public accept(message: Message): boolean {
    return this.guard.accept(message);
  }

  /** Runs an action that expects a reply, unless it is a repeat (see `accept`) */
  private replying(
    message: Of<"assert" | "insert" | "add-insertable">,
    work: () => Promise<ActionReply>,
  ) {
    return this.guard.run(message, work, (id, result) =>
      this.reply(id, result),
    );
  }

  private async picked(message: Of<"pick">): Promise<void> {
    const page = this.scope.current;
    if (this.paused) return this.reply(message.id, fail(PAUSED));
    let found: Inspection | undefined | typeof LEFT;
    try {
      // Chrome never answers a command into a document that is being replaced, so a pick of the old page must not
      // keep the messages behind it waiting
      found = await this.scope.whileOn(async () => {
        const locator =
          message.target &&
          (await this.deps.rank(message.target, message.candidates));
        if (!locator) return undefined;
        const inspected = await this.deps.inspect(
          message.target!,
          locator,
          message.candidates,
        );
        if (page === this.scope.current)
          this.pick = { id: message.id, locator, counts: inspected.counts };
        return inspected;
      });
    } catch {
      found = undefined; // the element went away while it was inspected
    }
    // The page that asked is gone: its successor's toolbar isn't waiting for this
    if (found === LEFT || page !== this.scope.current) return;
    this.reply(
      message.id,
      found ? withoutSecrets(found.info, this.secrets) : fail(UNIDENTIFIABLE),
    );
  }
}
