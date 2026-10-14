import { cleanName } from "../../browser/evidence.js";
import { ConfigEditError } from "../../project/config-edit.js";
import { SECRET_NAME } from "../../project/secrets-file.js";
import { ExistsError, VARIABLE_NAME } from "../../project/variables.js";
import type { ElementHandle } from "../../script/element-handle.js";
import type {
  Expectation,
  LocatorCall,
  LocatorSpec,
  Step,
} from "../../steps/model.js";
import { expectationFor, type Observation } from "../normalise.js";
import type {
  ActionReply,
  PickInfo,
  ToolbarMessage,
  ToolbarState,
} from "./protocol.js";

/** What `inspect` found for a picked element: the reply, and the locator behind each Count choice */
export interface Inspection {
  info: PickInfo & { ok: true };
  /** `counts[i]` is the locator `info.counts[i]` describes */
  counts: LocatorCall[];
}

/** Everything the controller does to the browser and the project; the recorder implements these */
export interface ControllerDeps {
  /** Sends the state to every loaded top-level document's toolbar */
  push(state: ToolbarState): void;
  reply(id: number, result: PickInfo | ActionReply): void;
  currentUrl(): Promise<string>;
  rank(
    target: ElementHandle,
    candidates: LocatorCall[],
  ): Promise<LocatorSpec | undefined>;
  inspect(
    target: ElementHandle,
    locator: LocatorSpec,
    candidates: LocatorCall[],
  ): Promise<Inspection>;
  /** Types into the field with capture muted */
  type(locator: LocatorSpec, value: string): Promise<void>;
  mute(): Promise<void>;
  unmute(): Promise<void>;
  addVariable(name: string, value: string): Promise<void>;
  setSecret(name: string, value: string): Promise<void>;
  /** A secret was written to the project (called before its value is typed) */
  secretAdded(name: string): void;
  observe(observation: Observation): void;
  stop(): void;
  onStatus(status: { state: "recording" | "paused"; toolbar: boolean }): void;
}

export interface ControllerOptions {
  environment: string;
  canAddVariables: boolean;
  variables: Record<string, string | number | boolean>;
  /** Name → value; undefined when not set */
  secrets: Record<string, string | undefined>;
  secretsIgnored: boolean;
  /** Screenshot steps already in the test, for the default name */
  screenshots: number;
}

/** How long a loaded page's toolbar has to say `ready` */
const READY_WITHIN = 2000;

const UNIDENTIFIABLE = "This element can't be identified uniquely";
const TYPE_FAILED = "Couldn't type into that field";
const NO_ENVIRONMENT = "This recording has no environment";
const PAUSED = "Nothing you do now is recorded.";

const fail = (error: string, field?: "name"): ActionReply => ({
  ok: false,
  error,
  ...(field && { field }),
});

type Message = ToolbarMessage & { target?: ElementHandle };
type Of<A extends Message["action"]> = Extract<Message, { action: A }>;

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
  /** The picked element an `assert` with the same id refers to */
  private pick:
    { id: number; locator: LocatorSpec; counts: LocatorCall[] } | undefined;
  /** Ids of `assert`, `insert` and `add-insertable` being processed */
  private readonly inFlight = new Set<number>();
  /** Ids `accept` let through whose `handle` hasn't started yet */
  private readonly claimed = new Set<number>();
  /** Ids answered `{ ok: true }`: their step exists, a repeat is a double click */
  private readonly done = new Set<number>();
  /** Bumped on every page load: work started for an older page is not answered */
  private page = 0;
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
  }

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
      case "pick":
        return this.picked(message);
      case "assert":
        return this.once(message, () => this.assert(message));
      case "insert":
        return this.once(message, () => this.insert(message));
      case "add-insertable":
        return this.once(message, () => this.addInsertable(message));
      case "wait":
        if (this.paused) return;
        if (message.kind === "time") {
          if (!Number.isFinite(message.ms) || message.ms < 0) return;
          this.deps.observe({ type: "wait-time", ms: Math.round(message.ms) });
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
    this.page++;
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
  }

  /** A step was emitted (any source): count it */
  public stepAdded(step: Step): void {
    this.steps++;
    if (step.kind === "screenshot") this.screenshots++;
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

  /** Runs an action that expects a reply; a second one with the same id while the first runs is dropped */
  /**
   * Whether to process `message`; call it as the message arrives, before queueing it. An `assert`, `insert` or
   * `add-insertable` whose id is in flight or was already answered `{ ok: true }` is a double click and is
   * dropped (its first copy answers). A retry after `{ ok: false }` is accepted.
   */
  public accept(message: Message): boolean {
    if (
      message.action !== "assert" &&
      message.action !== "insert" &&
      message.action !== "add-insertable"
    )
      return true;
    const { id } = message;
    if (this.inFlight.has(id) || this.done.has(id)) return false;
    this.inFlight.add(id);
    this.claimed.add(id);
    return true;
  }

  /** Runs an action that expects a reply, unless it is a repeat (see `accept`) */
  private async once(
    message: Of<"assert" | "insert" | "add-insertable">,
    work: () => Promise<ActionReply>,
  ) {
    const { id } = message;
    if (!this.claimed.has(id) && !this.accept(message)) return;
    this.claimed.delete(id);
    try {
      const result = await work();
      if (result.ok) this.done.add(id);
      this.reply(id, result);
    } finally {
      this.inFlight.delete(id);
    }
  }

  private async picked(message: Of<"pick">): Promise<void> {
    const page = this.page;
    if (this.paused) return this.reply(message.id, fail(PAUSED));
    let found: Inspection | undefined;
    try {
      const locator =
        message.target &&
        (await this.deps.rank(message.target, message.candidates));
      if (locator) {
        found = await this.deps.inspect(
          message.target!,
          locator,
          message.candidates,
        );
        if (page === this.page)
          this.pick = { id: message.id, locator, counts: found.counts };
      }
    } catch {
      found = undefined; // the element went away while it was inspected
    }
    // The page that asked is gone: its successor's toolbar isn't waiting for this
    if (page !== this.page) return;
    this.reply(
      message.id,
      found ? this.withoutSecrets(found.info) : fail(UNIDENTIFIABLE),
    );
  }

  /**
   * A field may hold an inserted secret: its value (and any text or attribute equal to a secret) is left out,
   * and the first matcher follows the Alt+click rule without a value, so neither the page nor the spec gets it.
   */
  private withoutSecrets(info: PickInfo & { ok: true }): PickInfo {
    const values = [...this.secrets.values()].filter(
      (value): value is string => value !== undefined && value !== "",
    );
    const secret = (text: string | undefined) =>
      text !== undefined && values.some((value) => text.includes(value));
    if (
      !secret(info.value) &&
      !secret(info.text) &&
      !secret(info.first.expected) &&
      !info.attributes.some((a) => secret(a.value))
    )
      return info;
    const text = secret(info.text) ? "" : info.text;
    const first = expectationFor(text, undefined);
    const { value: _value, ...rest } = info;
    return {
      ...rest,
      text,
      attributes: info.attributes.filter((a) => !secret(a.value)),
      first: {
        matcher: first.matcher,
        ...("expected" in first && { expected: String(first.expected) }),
      },
    };
  }

  private async assert(message: Of<"assert">): Promise<ActionReply> {
    if (this.paused) return fail(PAUSED);
    const pick = this.pick;
    if (!pick || pick.id !== message.id) return fail("Pick the element again");
    let locator = pick.locator;
    let expectation: Expectation;
    const expected = String(message.expected ?? "");
    switch (message.matcher) {
      case "toBeVisible":
        expectation = { matcher: "toBeVisible" };
        break;
      case "toHaveText":
      case "toContainText":
      case "toHaveValue":
        expectation = { matcher: message.matcher, expected };
        break;
      case "toHaveAttribute":
        if (!message.attribute) return fail("Choose an attribute");
        expectation = {
          matcher: "toHaveAttribute",
          name: message.attribute,
          expected,
        };
        break;
      case "toHaveCount": {
        const call = pick.counts[message.countIndex ?? 0];
        const count = Number(expected);
        if (!call) return fail("Choose what to count");
        if (expected.trim() === "" || !Number.isInteger(count) || count < 0)
          return fail("A count is a whole number");
        locator = { chain: [call], fallbacks: [] };
        expectation = { matcher: "toHaveCount", expected: count };
        break;
      }
      default:
        return fail("Choose a matcher");
    }
    this.pick = undefined;
    this.deps.observe({
      type: "expect",
      locator,
      not: message.not === true,
      expectation,
    });
    return { ok: true };
  }

  private async insert(message: Of<"insert">): Promise<ActionReply> {
    if (this.paused) return fail(PAUSED);
    const { kind, name } = message;
    const value =
      kind === "secret" ? this.secrets.get(name) : this.variables.get(name);
    if (value === undefined)
      return fail(
        kind === "secret"
          ? `Set a value for ${name} first`
          : `There is no variable "${name}"`,
      );
    const locator = await this.locate(message);
    if (!locator) return fail(UNIDENTIFIABLE);
    return this.typeIn(locator, kind, name, value);
  }

  private async addInsertable(
    message: Of<"add-insertable">,
  ): Promise<ActionReply> {
    if (this.paused) return fail(PAUSED);
    const { kind, name } = message;
    const value = String(message.value ?? "");
    if (kind === "env" && !this.options.canAddVariables)
      return fail(NO_ENVIRONMENT);
    const known =
      kind === "env"
        ? this.variables.has(name)
        : this.secrets.get(name) !== undefined;
    if (known) return fail(`"${name}" already exists`, "name");
    // Found before anything is written: an element that can't be filled leaves the project as it was
    const locator = await this.locate(message);
    if (!locator) return fail(UNIDENTIFIABLE);
    const written =
      kind === "env"
        ? await this.write(
            () => this.deps.addVariable(name, value),
            (err) =>
              err instanceof ConfigEditError
                ? fail(
                    `samurai.config.ts can't be changed automatically. Add ${name} to environments.${this.options.environment}.variables yourself.`,
                  )
                : err instanceof ExistsError || !VARIABLE_NAME.test(name)
                  ? fail(errorText(err), "name")
                  : fail(errorText(err)),
          )
        : await this.write(
            () => this.deps.setSecret(name, value),
            (err) =>
              // An error never echoes the value
              SECRET_NAME.test(name)
                ? fail(scrub(errorText(err), value))
                : fail(scrub(errorText(err), value), "name"),
          );
    if (written) return written;
    if (kind === "env") this.variables.set(name, value);
    else {
      this.secrets.set(name, value);
      this.deps.secretAdded(name);
    }
    this.push();
    return this.typeIn(locator, kind, name, value, true);
  }

  /** Undefined when `work` succeeded, else the reply for its error */
  private async write(
    work: () => Promise<void>,
    replyFor: (err: unknown) => ActionReply,
  ): Promise<ActionReply | undefined> {
    try {
      await work();
      return undefined;
    } catch (err) {
      return replyFor(err);
    }
  }

  private async locate(message: {
    target?: ElementHandle;
    candidates: LocatorCall[];
  }): Promise<LocatorSpec | undefined> {
    if (!message.target) return undefined;
    try {
      return await this.deps.rank(message.target, message.candidates);
    } catch {
      return undefined; // the element went away
    }
  }

  private async typeIn(
    locator: LocatorSpec,
    kind: "env" | "secret",
    name: string,
    value: string,
    saved = false,
  ): Promise<ActionReply> {
    try {
      await this.deps.type(locator, value);
    } catch {
      // Typing clicks the field, which closes the panel the reply is for: the toast is what the tester sees
      this.showToast(
        saved
          ? `Saved ${name}, but couldn't type into that field`
          : TYPE_FAILED,
      );
      this.push();
      return fail(TYPE_FAILED);
    }
    this.deps.observe({ type: "insert", locator, value: { kind, name } });
    return { ok: true };
  }
}

const errorText = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

const scrub = (text: string, secret: string) =>
  secret === "" ? text : text.split(secret).join("••••••");
