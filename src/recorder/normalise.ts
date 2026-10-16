import type {
  Expectation,
  FileEntry,
  LocatorSpec,
  Step,
} from "../steps/model.js";

/** What the recorder does to the step list: a new step at `index`, a step rewritten in place, or one taken out */
export type RecorderEvent =
  | { op: "insert"; index: number; step: Step }
  | { op: "replace"; index: number; step: Step }
  | { op: "remove"; index: number };

/** A page event whose element already has its locators */
export type Observation =
  | { type: "click"; key: string; locator: LocatorSpec; textEntry: boolean }
  | {
      type: "input";
      key: string;
      locator: LocatorSpec;
      value?: string;
      secret?: boolean;
      secretName?: string;
    }
  | { type: "press"; key: string; locator: LocatorSpec; pressed: string }
  | {
      type: "assert";
      key: string;
      locator: LocatorSpec;
      text: string;
      value?: string;
    }
  | {
      type: "expect";
      locator: LocatorSpec;
      not: boolean;
      expectation: Expectation;
    }
  | {
      type: "insert";
      locator: LocatorSpec;
      value: { kind: "env" | "secret"; name: string };
    }
  /** A file input got a click: the click recorded just before it opened the file picker */
  | { type: "picker" }
  /** The file picker closed without a choice */
  | { type: "picker-cancel" }
  /** Files were set on an input or dropped on an element, and are stored (or listed as missing) */
  | {
      type: "files";
      via: "input" | "drop";
      locator: LocatorSpec;
      files: FileEntry[];
    }
  | { type: "wait-idle" }
  | { type: "wait-time"; ms: number }
  | { type: "screenshot"; name: string; fullPage: boolean }
  | { type: "goto"; url: string };

export interface NormaliserOptions {
  /** Index the first recorded step gets */
  at: number;
  /** Relative URLs are written against this */
  baseURL?: string;
  /** A navigation within this many ms of the last action is a consequence of it. @default 2000 */
  navigationWindow?: number;
}

const TEXT_LIMIT = 100;

/** A picker that opens within this many ms of a click was opened by it */
export const PICKER_WINDOW = 1000;

/** The name a secret gets in `secrets.<NAME>`: the field's name or id, upper snake case */
export function secretNameFor(hint: string | undefined): string {
  const name = (hint ?? "")
    .replace(/([a-z\d])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  return name === "" || /^\d/.test(name) ? "PASSWORD" : name;
}

export function expectationFor(
  text: string,
  value: string | undefined,
): Expectation {
  if (value !== undefined) return { matcher: "toHaveValue", expected: value };
  if (text === "") return { matcher: "toBeVisible" };
  return text.length <= TEXT_LIMIT
    ? { matcher: "toHaveText", expected: text }
    : { matcher: "toContainText", expected: text.slice(0, TEXT_LIMIT).trim() };
}

/**
 * Turns what the tester did into steps:
 * - typing into a field becomes one `fill`, rewritten as the text grows (a password becomes a secret reference);
 * - clicks that only focus a text field are dropped;
 * - a navigation right after an action becomes `waitForNetworkIdle`, any other navigation a `goto`;
 * - an Alt+click becomes an `expect`.
 * Pure: the caller feeds it events and the times they happened.
 */
export class Normaliser {
  private next: number;
  private lastFill: { key: string; index: number } | undefined;
  private lastAction = -Infinity;
  private lastStep: Step | undefined;
  /** The last click, so a picker it opened can take its place */
  private lastClick: { index: number; at: number } | undefined;
  /** The click that opened the file picker that is open now */
  private picker: number | undefined;
  private readonly window: number;

  constructor(private readonly options: NormaliserOptions) {
    this.next = options.at;
    this.window = options.navigationWindow ?? 2000;
  }

  /** Index the next inserted step gets */
  public get nextIndex(): number {
    return this.next;
  }

  private insert(step: Step): RecorderEvent {
    this.lastStep = step;
    this.picker = undefined;
    return { op: "insert", index: this.next++, step };
  }

  /** The path (and query) of `url` when it is inside the base URL, else `url` */
  public relative(url: string): string {
    const base = this.options.baseURL?.replace(/\/+$/, "");
    if (
      base &&
      (url === base ||
        url.startsWith(`${base}/`) ||
        url.startsWith(`${base}?`) ||
        url.startsWith(`${base}#`))
    ) {
      return url.slice(base.length) || "/";
    }
    return url;
  }

  /** Steps the toolbar asks for directly; undefined for page observations */
  private toolbarStep(observation: Observation): Step | undefined {
    switch (observation.type) {
      case "expect":
        return {
          kind: "expect",
          locator: observation.locator,
          not: observation.not,
          expectation: observation.expectation,
        };
      case "insert":
        return {
          kind: "fill",
          locator: observation.locator,
          value: observation.value,
        };
      case "wait-idle":
        return { kind: "waitForNetworkIdle" };
      case "wait-time":
        return { kind: "waitForTimeout", ms: observation.ms };
      case "screenshot":
        return {
          kind: "screenshot",
          name: observation.name,
          fullPage: observation.fullPage,
        };
      case "goto":
        return { kind: "goto", url: this.relative(observation.url) };
      default:
        return undefined;
    }
  }

  public observe(observation: Observation, at: number): RecorderEvent[] {
    const fromToolbar = this.toolbarStep(observation);
    if (fromToolbar) {
      this.lastFill = undefined;
      return [this.insert(fromToolbar)];
    }

    // The sandbox reports a picker for any click on a file input, including ones a page script fires:
    // it is only a hint, and only the very last step, recorded just before, may be replaced or removed
    if (observation.type === "picker") {
      const click = this.lastClick;
      this.picker =
        click && click.index === this.next - 1 && at - click.at <= PICKER_WINDOW
          ? click.index
          : undefined;
      return [];
    }

    if (observation.type === "picker-cancel") {
      const index = this.picker;
      this.picker = undefined;
      if (index === undefined || index !== this.next - 1) return [];
      this.next--;
      this.lastClick = undefined;
      this.lastStep = undefined;
      return [{ op: "remove", index }];
    }

    if (observation.type === "files") {
      this.lastFill = undefined;
      this.lastAction = at;
      const step: Step = {
        kind: observation.via === "drop" ? "dropFiles" : "setInputFiles",
        locator: observation.locator,
        files: observation.files,
      };
      const index = this.picker;
      if (
        observation.via === "input" &&
        index !== undefined &&
        index === this.next - 1
      ) {
        this.picker = undefined;
        this.lastClick = undefined;
        this.lastStep = step;
        return [{ op: "replace", index, step }];
      }
      return [this.insert(step)];
    }

    if (observation.type === "click") {
      if (observation.textEntry) return []; // focusing a field: the fill that follows needs no click
      this.lastFill = undefined;
      this.lastAction = at;
      const events = [
        this.insert({ kind: "click", locator: observation.locator }),
      ];
      this.lastClick = { index: this.next - 1, at };
      return events;
    }

    if (observation.type === "press") {
      // The page may react by clearing the field: what is typed next is a new fill, not a rewrite of this one
      this.lastFill = undefined;
      this.lastAction = at;
      return [
        this.insert({
          kind: "press",
          locator: observation.locator,
          key: observation.pressed,
        }),
      ];
    }

    if (observation.type === "assert") {
      this.lastFill = undefined;
      return [
        this.insert({
          kind: "expect",
          locator: observation.locator,
          not: false,
          expectation: expectationFor(observation.text, observation.value),
        }),
      ];
    }

    if (observation.type !== "input") return [];
    this.lastAction = at;
    const step: Step = {
      kind: "fill",
      locator: observation.locator,
      value: observation.secret
        ? { kind: "secret", name: secretNameFor(observation.secretName) }
        : { kind: "literal", value: observation.value ?? "" },
    };
    if (this.lastFill?.key === observation.key) {
      this.lastStep = step;
      return [{ op: "replace", index: this.lastFill.index, step }];
    }
    this.lastFill = { key: observation.key, index: this.next };
    return [this.insert(step)];
  }

  /** A top-level navigation started */
  public navigated(url: string, at: number): RecorderEvent[] {
    this.lastFill = undefined;
    if (at - this.lastAction <= this.window) {
      this.lastAction = -Infinity;
      return this.lastStep?.kind === "waitForNetworkIdle"
        ? []
        : [this.insert({ kind: "waitForNetworkIdle" })];
    }
    return [this.insert({ kind: "goto", url: this.relative(url) })];
  }

  /** The page the recording starts on, written as a `goto` */
  public initialGoto(url: string): RecorderEvent[] {
    return [this.insert({ kind: "goto", url: this.relative(url) })];
  }
}
