import type Page from "../browser/page.js";
import type Locator from "../locator/locator.js";
import { rankLocator } from "../recorder/ranking.js";
import type { ElementHandle } from "../script/element-handle.js";
import { locatorFromSpec } from "../steps/build.js";
import type { LocatorCall, LocatorSpec } from "../steps/model.js";
import { RESOLVE_SCRIPT, SNAPSHOT_SCRIPT } from "./snapshot-script.js";

/** A reference does not point at an element of the latest snapshot; the text says why and what to do */
export class SnapshotRefError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotRefError";
  }
}

/** The page as text for the model */
export interface Snapshot {
  /** Header, then one line per element: `[e12] button "Save" disabled` */
  text: string;
  /** Elements that got a reference */
  elements: number;
  /** Lines that did not fit the size cap */
  omitted: number;
}

/** An element of the latest snapshot, ready to act on */
export interface Located {
  ref: string;
  /** The locators the typed step is written with */
  spec: LocatorSpec;
  locator: Locator;
  /** `textbox "Email"`, for messages */
  description: string;
  /** A password or a field the caller marked secret: its value is never shown or typed by the model */
  secret: boolean;
  /** The page itself draws the value as dots (a password input), so even a screenshot does not show it */
  dotted: boolean;
}

export interface SnapshotOptions {
  /** CSS selectors of fields to treat as secret, besides password inputs. @default none */
  secretFields?: readonly string[];
  /** The size cap of the text in characters. @default 16000 */
  maxChars?: number;
}

/** The size cap when none is given */
const DEFAULT_MAX_CHARS = 16_000;

type Resolved =
  | {
      status: "ok";
      target: ElementHandle;
      candidates: LocatorCall[];
      secret: boolean;
      dotted: boolean;
      role: string;
      name: string;
    }
  | { status: "none" | "unknown" | "older" | "gone" | "nofocus" };

/**
 * Takes snapshots of a page and resolves their references. A reference (`e12`) stays the same for an element
 * while it lives and is valid until the next snapshot; after that, only the elements the new snapshot lists
 * resolve. A navigation to a new document starts over.
 */
export class Snapshotter {
  private readonly secretFields: readonly string[];
  private readonly maxChars: number;

  constructor(
    private readonly page: Page,
    options: SnapshotOptions = {},
  ) {
    this.secretFields = options.secretFields ?? [];
    this.maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  }

  public async take(): Promise<Snapshot> {
    const found = await this.page.evaluate<
      {
        text: string;
        omitted: number;
        count: number;
        url: string;
        title: string;
      },
      { maxChars: number; secretFields: readonly string[] }
    >(SNAPSHOT_SCRIPT, {
      maxChars: this.maxChars,
      secretFields: this.secretFields,
    });
    const header = `url: ${found.url}\ntitle: ${found.title}\n`;
    const marker =
      found.omitted > 0
        ? `\n… [snapshot truncated: ${found.omitted} more elements not shown]`
        : "";
    return {
      text: header + found.text + marker,
      elements: found.count,
      omitted: found.omitted,
    };
  }

  /** The element behind `ref`, with the best locator that matches only it. Throws `SnapshotRefError` */
  public async locate(ref: string): Promise<Located> {
    const match = /^e(\d+)$/.exec(ref.trim());
    if (!match)
      throw new SnapshotRefError(
        `"${ref}" is not a snapshot reference; references look like e12 and come from a snapshot`,
      );
    const label = `e${Number(match[1])}`;
    return this.locateWith(label, { ref: Number(match[1]) });
  }

  /** The element that has focus now (what `useSecret` fills). Throws `SnapshotRefError` when nothing is focused */
  public async locateFocused(): Promise<Located> {
    return this.locateWith("the focused field", { focused: true });
  }

  private async locateWith(
    label: string,
    which: { ref: number } | { focused: true },
  ): Promise<Located> {
    const found = await this.page.evaluate<Resolved, object>(RESOLVE_SCRIPT, {
      ...which,
      secretFields: this.secretFields,
    });
    if (found.status !== "ok")
      throw new SnapshotRefError(refProblem(label, found.status));
    const spec = await rankLocator(this.page, found.target, found.candidates);
    if (!spec)
      throw new SnapshotRefError(
        `${label} has no locator that matches only that element; take a new snapshot`,
      );
    return {
      ref: label,
      spec,
      locator: locatorFromSpec(this.page, spec),
      description: describe(found.role, found.name),
      secret: found.secret,
      dotted: found.dotted,
    };
  }
}

function describe(role: string, name: string): string {
  const kind = role === "" ? "element" : role;
  return name === "" ? kind : `${kind} "${name}"`;
}

function refProblem(
  label: string,
  status: Exclude<Resolved["status"], "ok">,
): string {
  switch (status) {
    case "none":
      return `${label} cannot be used: no snapshot has been taken of this page yet (the page is new or has reloaded); take a snapshot first`;
    case "unknown":
      return `${label} does not exist; use a reference from the latest snapshot`;
    case "older":
      return `${label} was in an earlier snapshot but is not in the latest one: the page changed; take a new snapshot`;
    case "gone":
      return `${label} is no longer on the page (it was removed after the snapshot); take a new snapshot`;
    case "nofocus":
      return "no field has focus; click the field first";
  }
}
