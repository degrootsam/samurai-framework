import type { Expectation, LocatorSpec, Step } from "../steps/model.js";

/** What the recorder does to the step list: a new step at `index`, or a step rewritten in place */
export type RecorderEvent = { op: "insert"; index: number; step: Step } | { op: "replace"; index: number; step: Step };

/** A page event whose element already has its locators */
export type Observation =
  | { type: "click"; key: string; locator: LocatorSpec; textEntry: boolean }
  | { type: "input"; key: string; locator: LocatorSpec; value?: string; secret?: boolean; secretName?: string }
  | { type: "assert"; key: string; locator: LocatorSpec; text: string; value?: string };

export interface NormaliserOptions {
  /** Index the first recorded step gets */
  at: number;
  /** Relative URLs are written against this */
  baseURL?: string;
  /** A navigation within this many ms of the last action is a consequence of it. @default 2000 */
  navigationWindow?: number;
}

const TEXT_LIMIT = 100;

/** The name a secret gets in `secrets.<NAME>`: the field's name or id, upper snake case */
export function secretNameFor(hint: string | undefined): string {
  const name = (hint ?? "").replace(/([a-z\d])([A-Z])/g, "$1_$2").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase();
  return name === "" || /^\d/.test(name) ? "PASSWORD" : name;
}

function expectationFor(text: string, value: string | undefined): Expectation {
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
    return { op: "insert", index: this.next++, step };
  }

  /** The path (and query) of `url` when it is inside the base URL, else `url` */
  public relative(url: string): string {
    const base = this.options.baseURL?.replace(/\/+$/, "");
    if (base && (url === base || url.startsWith(`${base}/`) || url.startsWith(`${base}?`) || url.startsWith(`${base}#`))) {
      return url.slice(base.length) || "/";
    }
    return url;
  }

  public observe(observation: Observation, at: number): RecorderEvent[] {
    if (observation.type === "click") {
      if (observation.textEntry) return []; // focusing a field: the fill that follows needs no click
      this.lastFill = undefined;
      this.lastAction = at;
      return [this.insert({ kind: "click", locator: observation.locator })];
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
      return this.lastStep?.kind === "waitForNetworkIdle" ? [] : [this.insert({ kind: "waitForNetworkIdle" })];
    }
    return [this.insert({ kind: "goto", url: this.relative(url) })];
  }

  /** The page the recording starts on, written as a `goto` */
  public initialGoto(url: string): RecorderEvent[] {
    return [this.insert({ kind: "goto", url: this.relative(url) })];
  }
}
