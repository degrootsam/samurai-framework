import type { BiDiConnector } from "../transport/bidi-connection.js";
import { BiDiError } from "../transport/bidi-error.js";
import type {
  BrowsingContext,
  ElementRectangle,
} from "../types/bidi-modules/browsing-context.js";
import type {
  KeyDownAction,
  KeyUpAction,
} from "../types/bidi-modules/input.js";
import { callFunction, ScriptError } from "../script/call-function.js";
import {
  CALL_PROBE,
  HELPER_SANDBOX,
  HELPERS_MISSING,
  type HelperInstaller,
} from "../script/helpers.js";
import { ElementHandle } from "../script/element-handle.js";
import {
  takeScreenshot,
  type ElementScreenshotOptions,
} from "../browser/screenshot.js";
import {
  isGeneratedFile,
  resolveFileInputs,
  type FileInput,
} from "../browser/generated-files.js";
import type { Arg } from "../script/serialize.js";
import {
  resolveTimeout,
  waitUntil,
  WaitTimeoutError,
} from "../wait/wait-until.js";
import { ActionTimeoutError } from "./action-timeout-error.js";
import {
  allPass,
  DETACHED_STATE,
  describeType,
  evaluateChecks,
  parseElementState,
  PROBE_ELEMENT,
  type CheckName,
  type CheckResults,
  type ElementState,
  type ProbeOptions,
  type WaitForState,
} from "./element-state.js";

import {
  InvalidSelectorError,
  UnsupportedOperationError,
} from "./selector-errors.js";
import { LABEL_LOCATE } from "./label-locator.js";
import { TEXT_LOCATE } from "./text-locator.js";
import {
  cssSelector,
  describeChain,
  describeSelector,
  labelSelector,
  roleSelector,
  testIdSelector,
  textSelector,
  toBiDiLocator,
  xpathSelector,
  type Selector,
  type TextOptions,
} from "./selector.js";

export interface ActionOptions {
  /**
   * Time (ms) to wait for the element to become actionable. Defaults to config `expect.timeout`, then 5000.
   * 0 checks once without waiting; the stability check is skipped because it needs two probes
   */
  timeout?: number;
  /** Skip every actionability check except "attached" */
  force?: boolean;
}

/** Locator types a connection's browser rejected, so they are not tried again on every poll */
const unsupportedByConnector = new WeakMap<BiDiConnector, Set<string>>();

function unsupportedTypes(connector: BiDiConnector): Set<string> {
  let types = unsupportedByConnector.get(connector);
  if (!types) unsupportedByConnector.set(connector, (types = new Set()));
  return types;
}

/** What `setInputFiles` needs to know about the element before it sends files */
const FILE_INPUT_INFO = `(el) => ({
  tag: el.tagName.toLowerCase(),
  type: (el.getAttribute("type") || "").toLowerCase(),
  multiple: Boolean(el.multiple),
})`;

const FILE_INPUT_CHECKS: readonly CheckName[] = ["attached", "enabled"];
const DROP_CHECKS: readonly CheckName[] = ["attached", "visible"];
/** The sandbox `dropFiles` builds its files in */
const DROP_SANDBOX = "samurai-drop";
const DROP_KEY = `globalThis[Symbol.for("samurai.drop")]`;
const DROP_INPUT = `() => {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  ${DROP_KEY} = input;
  return input;
}`;
/** Fires dragenter, dragover and drop at the element's centre with the input's files (retyped where asked) */
const DROP_EVENTS = `(el, types) => {
  const input = ${DROP_KEY};
  delete ${DROP_KEY};
  const data = new DataTransfer();
  Array.from(input.files).forEach((file, i) => {
    data.items.add(types[i] ? new File([file], file.name, { type: types[i], lastModified: file.lastModified }) : file);
  });
  const box = el.getBoundingClientRect();
  const at = { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 };
  for (const type of ["dragenter", "dragover", "drop"]) {
    el.dispatchEvent(new DragEvent(type, Object.assign({ bubbles: true, cancelable: true, composed: true, dataTransfer: data }, at)));
  }
}`;
const SCREENSHOT_CHECKS: readonly CheckName[] = ["attached", "visible"];

const CLICK_CHECKS: readonly CheckName[] = [
  "attached",
  "visible",
  "stable",
  "enabled",
  "hit target",
];
const FILL_CHECKS: readonly CheckName[] = [
  "attached",
  "visible",
  "enabled",
  "editable",
  "hit target",
];
const PRESS_CHECKS: readonly CheckName[] = ["attached", "visible", "enabled"];
const ATTACHED_ONLY: readonly CheckName[] = ["attached"];

/** WebDriver code points of the named keys `press()` accepts; any other single character is typed as is */
const NAMED_KEYS: Readonly<Record<string, string>> = {
  Backspace: "\uE003",
  Tab: "\uE004",
  Enter: "\uE007",
  Escape: "\uE00C",
  Space: " ",
  ArrowLeft: "\uE012",
  ArrowUp: "\uE013",
  ArrowRight: "\uE014",
  ArrowDown: "\uE015",
  Delete: "\uE017",
  Home: "\uE011",
  End: "\uE010",
  PageUp: "\uE00E",
  PageDown: "\uE00F",
};

/**
 * Chrome answers a command sent while the page swaps documents with an unknown error that says the context
 * is gone for the moment; the same call a moment later works.
 */
const DOCUMENT_SWAP =
  /Cannot find context with specified id|execution contexts? (was |were )?(cleared|destroyed)/i;

function isDocumentSwap(err: unknown): boolean {
  return (
    err instanceof BiDiError &&
    err.code === "unknown error" &&
    DOCUMENT_SWAP.test(err.message)
  );
}

export default class Locator {
  private biDiConnector: BiDiConnector;
  private contextId: BrowsingContext;
  private chain: readonly Selector[];
  private helpers: HelperInstaller | undefined;
  private alternatives: readonly Locator[];
  private matched: { index: number; selector: string } | undefined;

  /**
   * `selector` is an xpath, or a chain of selector steps that each search inside the previous step's matches.
   * `helpers` is the page's helper realm. With it the actionability probe is installed once per
   * document and called by name; without it (a locator built by hand) the probe source is sent on every poll.
   * `alternatives` are fallback locators tried in order whenever this chain matches nothing (see `withFallbacks`).
   */
  constructor(
    selector: string | readonly Selector[],
    biDiConnector: BiDiConnector,
    contextId: BrowsingContext,
    helpers?: HelperInstaller,
    alternatives: readonly Locator[] = [],
  ) {
    this.chain =
      typeof selector === "string" ? [xpathSelector(selector)] : selector;
    this.biDiConnector = biDiConnector;
    this.contextId = contextId;
    this.helpers = helpers;
    this.alternatives = alternatives;
  }

  /**
   * The description of this locator used in error messages, e.g. `//form >> role=button[name="Save"]`;
   * fallbacks follow as `or …`
   */
  public get selector(): string {
    return [
      describeChain(this.chain),
      ...this.alternatives.map((alt) => alt.selector),
    ].join(" or ");
  }

  /** Steps that keep the fallbacks: each fallback gets the same step, so "inside A or B" stays meaningful */
  private child(step: Selector): Locator {
    return new Locator(
      [...this.chain, step],
      this.biDiConnector,
      this.contextId,
      this.helpers,
      this.alternatives.map((alt) => alt.child(step)),
    );
  }

  /**
   * A locator that tries this one first and, whenever it matches nothing, each of `fallbacks` in order;
   * the first one with a match wins. For steps with several ways to find the same element (a test id,
   * then role and name, then text), most stable first. `matchedBy` says which one matched last, so a
   * self-healing layer can tell the primary locator has gone stale.
   * @example
   *  page.getByTestId("save").withFallbacks(page.getByRole("button", { name: "Save" }), page.getByText("Save"));
   */
  public withFallbacks(...fallbacks: Locator[]): Locator {
    return new Locator(
      this.chain,
      this.biDiConnector,
      this.contextId,
      this.helpers,
      [...this.alternatives, ...fallbacks],
    );
  }

  /**
   * Which locator found elements the last time this one searched: index 0 is the primary, 1 the first
   * fallback, and so on. `undefined` before any search or when the last search found nothing.
   */
  public get matchedBy(): { index: number; selector: string } | undefined {
    return this.matched;
  }

  /** Elements matching the label text (`<label>`, `aria-labelledby`, `aria-label`), inside this locator's matches */
  public getByLabel(text: string, options?: TextOptions): Locator {
    return this.child(labelSelector(text, options));
  }

  /** Elements whose `data-testid` attribute equals `testId`, inside this locator's matches */
  public getByTestId(testId: string): Locator {
    return this.child(testIdSelector(testId));
  }

  /** Elements matching `xpath` inside this locator's matches (relative and `//` paths search inside them) */
  public locator(xpath: string): Locator {
    return this.child(xpathSelector(xpath));
  }

  /** Elements matching the CSS selector inside this locator's matches */
  public getByCss(css: string): Locator {
    return this.child(cssSelector(css));
  }

  /** Elements whose text matches, inside this locator's matches. Exact match unless `match: "partial"` */
  public getByText(text: string, options?: TextOptions): Locator {
    return this.child(textSelector(text, options));
  }

  /** Elements with the ARIA role (and accessible name, when given), inside this locator's matches */
  public getByRole(role: string, options?: { name?: string }): Locator {
    return this.child(roleSelector(role, options));
  }

  /** One locator per element currently matching, in document order */
  public async all(): Promise<Locator[]> {
    if (this.alternatives.length > 0) {
      // Pin to whichever of the primary and the fallbacks matches, so each result is one element
      const first = await this.firstMatching();
      return first ? first.all() : [];
    }
    const count = await this.count();
    const only = this.chain.length === 1 ? this.chain[0]! : undefined;
    return Array.from({ length: count }, (_, index) =>
      only?.kind === "xpath"
        ? // A positional xpath keeps working without a second search for the whole chain
          new Locator(
            `(${describeSelector(only, false)})[${index + 1}]`,
            this.biDiConnector,
            this.contextId,
            this.helpers,
          )
        : this.child({ kind: "nth", index }),
    );
  }

  /**
   * Finds the elements the chain matches, in document order. Every step searches inside the previous
   * step's matches; `max` limits the final result. Nothing is cached: the element that matches "first"
   * can change between polls, and a removed node stays resolvable in the browser.
   */
  private async resolve(max?: number): Promise<ElementHandle[]> {
    this.matched = undefined;
    const own = await this.resolveChain(max);
    if (own.length > 0) {
      this.matched = { index: 0, selector: describeChain(this.chain) };
      return own;
    }
    for (const [index, alternative] of this.alternatives.entries()) {
      const found = await alternative.resolve(max);
      if (found.length > 0) {
        this.matched = { index: index + 1, selector: alternative.selector };
        return found;
      }
    }
    return [];
  }

  /** The primary or the first fallback that currently matches, without its own fallbacks */
  private async firstMatching(): Promise<Locator | undefined> {
    if ((await this.resolveChain(1)).length > 0) return this.withoutFallbacks();
    for (const alternative of this.alternatives) {
      const found = await alternative.firstMatching();
      if (found) return found;
    }
    return undefined;
  }

  private withoutFallbacks(): Locator {
    return new Locator(
      this.chain,
      this.biDiConnector,
      this.contextId,
      this.helpers,
    );
  }

  private async resolveChain(max?: number): Promise<ElementHandle[]> {
    let nodes: ElementHandle[] | undefined;
    for (const [index, selector] of this.chain.entries()) {
      if (selector.kind === "nth") {
        const picked = nodes?.[selector.index];
        nodes = picked ? [picked] : [];
      } else {
        try {
          nodes = await this.locateStep(
            selector,
            index > 0,
            nodes,
            index === this.chain.length - 1 ? max : undefined,
          );
        } catch (err) {
          // The page is swapping documents: nothing matches right now, and the waits that poll try again
          if (isDocumentSwap(err)) return [];
          throw err;
        }
      }
      if (nodes.length === 0) return [];
    }
    return nodes ?? [];
  }

  private async resolveOne(): Promise<ElementHandle | null> {
    return (await this.resolve(1))[0] ?? null;
  }

  private async locateStep(
    selector: Selector,
    scoped: boolean,
    startNodes: ElementHandle[] | undefined,
    max: number | undefined,
  ): Promise<ElementHandle[]> {
    if (selector.kind === "label")
      return this.locateInPage(LABEL_LOCATE, selector, startNodes, max);
    if (
      selector.kind === "text" &&
      unsupportedTypes(this.biDiConnector).has("innerText")
    ) {
      return this.locateInPage(TEXT_LOCATE, selector, startNodes, max);
    }
    try {
      return await this.locateNatively(selector, scoped, startNodes, max);
    } catch (err) {
      if (err instanceof BiDiError && err.code === "invalid selector") {
        throw new InvalidSelectorError(
          describeSelector(selector, scoped),
          err.message,
        );
      }
      if (err instanceof BiDiError && err.code === "unsupported operation") {
        if (selector.kind === "text") {
          // The browser has no innerText locator (Firefox): remember that and search in the page instead
          unsupportedTypes(this.biDiConnector).add("innerText");
          return this.locateInPage(TEXT_LOCATE, selector, startNodes, max);
        }
        throw new UnsupportedOperationError(
          `${describeSelector(selector, scoped)}: this kind of locator is not supported by the browser (${err.message})`,
        );
      }
      throw err;
    }
  }

  private async locateNatively(
    selector: Selector,
    scoped: boolean,
    startNodes: ElementHandle[] | undefined,
    max: number | undefined,
  ): Promise<ElementHandle[]> {
    const { nodes } = await this.biDiConnector.send(
      "browsingContext.locateNodes",
      {
        context: this.contextId,
        locator: toBiDiLocator(selector, scoped),
        ...(max !== undefined && { maxNodeCount: max }),
        // Only the references are needed; skip serializing the matched subtrees
        serializationOptions: { maxDomDepth: 0 },
        ...(startNodes && {
          startNodes: startNodes.map(({ sharedId }) => ({ sharedId })),
        }),
      },
    );
    const found = new Map<string, ElementHandle>();
    for (const node of nodes) {
      if (node.sharedId !== undefined && !found.has(node.sharedId)) {
        found.set(node.sharedId, new ElementHandle(node.sharedId, node.handle));
      }
    }
    return [...found.values()];
  }

  /** Runs a page-side search `(starts, value, match, ignoreCase) => elements` */
  private async locateInPage(
    fn: string,
    selector: Extract<Selector, { kind: "text" | "label" }>,
    startNodes: ElementHandle[] | undefined,
    max: number | undefined,
  ): Promise<ElementHandle[]> {
    const found = await this.call<ElementHandle[]>(fn, [
      startNodes ?? [],
      selector.value,
      selector.match,
      selector.ignoreCase,
    ]);
    return max === undefined ? found : found.slice(0, max);
  }

  /** Calls `fn` in the page; a throwing function becomes a "Failed to locate element" error */
  private async call<T>(fn: string, args: Arg[], sandbox?: string): Promise<T> {
    try {
      return await callFunction<T>(
        this.biDiConnector,
        this.contextId,
        fn,
        args,
        {
          awaitPromise: false,
          ...(sandbox !== undefined && { sandbox }),
        },
      );
    } catch (err) {
      if (err instanceof ScriptError) {
        throw new Error(
          `Failed to locate element ${this.selector}. Details: ${err.text}`,
        );
      }
      throw err;
    }
  }

  /**
   * Calls a function on the first matching element: `body` sees it as `el`, followed by `params`.
   * Answers `whenMissing` when nothing matches, or the element disappeared meanwhile.
   */
  private async callOnElement<T>(
    whenMissing: T,
    body: string,
    params: string[] = [],
    args: Arg[] = [],
  ): Promise<T> {
    const el = await this.resolveOne();
    if (!el) return whenMissing;
    try {
      return await this.call<T>(
        `(el${params.map((param) => `, ${param}`).join("")}) => { ${body} }`,
        [el, ...args],
      );
    } catch (err) {
      if (err instanceof BiDiError && err.code === "no such node")
        return whenMissing;
      throw err;
    }
  }

  /** Like `callOnElement`, for operations that cannot go on without the element */
  private async callOnExistingElement<T>(body: string): Promise<T> {
    const missing = Symbol("missing");
    const result = await this.callOnElement<T | typeof missing>(missing, body);
    if (result === missing) throw this.noElementError();
    return result;
  }

  /** The error for an operation that needs an element when none matches */
  private noElementError(): Error {
    return new Error(
      `Failed to locate element ${this.selector}. Details: no element matches`,
    );
  }

  /** The element the locator matches now; throws when none does */
  private async requireElement(): Promise<ElementHandle> {
    const el = await this.resolveOne();
    if (!el) throw this.noElementError();
    return el;
  }

  /** Reads the element's actionability state: one search, one probe */
  private async probeState(options: ProbeOptions): Promise<ElementState> {
    const el = await this.resolveOne();
    if (!el) return DETACHED_STATE;
    try {
      return parseElementState(await this.callProbe(el, options));
    } catch (err) {
      // The document changed between the search and the probe
      if (
        (err instanceof BiDiError && err.code === "no such node") ||
        isDocumentSwap(err)
      )
        return DETACHED_STATE;
      throw err;
    }
  }

  private async callProbe(
    el: ElementHandle,
    options: ProbeOptions,
  ): Promise<unknown> {
    const args = [el, { ...options }];
    if (!this.helpers) return this.call(PROBE_ELEMENT, args);

    await this.helpers.ensureInstalled();
    let result = await this.call(CALL_PROBE, args, HELPER_SANDBOX);
    if (result === HELPERS_MISSING) {
      // A document got past the registration (e.g. created while it was being set up): install again once
      await this.helpers.reinstall();
      result = await this.call(CALL_PROBE, args, HELPER_SANDBOX);
      if (result === HELPERS_MISSING) {
        throw new ScriptError(
          "the samurai helpers are missing in the page after reinstalling",
          "probeElement",
        );
      }
    }
    return result;
  }

  /**
   * Probes until every required check passes and returns that state.
   * Throws ActionTimeoutError describing the last probe on timeout.
   */
  private async waitForActionable(
    action: string,
    checks: readonly CheckName[],
    probe: ProbeOptions,
    options: ActionOptions | undefined,
  ): Promise<ElementState> {
    const timeout = await resolveTimeout(options?.timeout);
    // Stability compares two probes; with timeout 0 there is only one
    const required = options?.force
      ? ATTACHED_ONLY
      : timeout === 0
        ? checks.filter((check) => check !== "stable")
        : checks;
    let lastChecks: CheckResults | undefined;
    try {
      return await waitUntil(
        () => this.probeState(probe),
        (current, previous) => {
          lastChecks = evaluateChecks(required, current, previous);
          return allPass(lastChecks);
        },
        { timeout },
      );
    } catch (err) {
      if (!(err instanceof WaitTimeoutError)) throw err;
      const last = err.last as ElementState | undefined;
      throw new ActionTimeoutError({
        action,
        selector: this.selector,
        timeout,
        reason: !last
          ? "unreadable"
          : last.attached
            ? "not-actionable"
            : "not-attached",
        checks: lastChecks,
        coveredBy:
          lastChecks?.["hit target"] === "fail"
            ? (last?.hitTarget ?? undefined)
            : undefined,
      });
    }
  }

  /** Waits until the element is attached, visible, stable, enabled and not covered, then clicks its centre with real pointer input */
  public async click(options?: ActionOptions): Promise<void> {
    const state = await this.waitForActionable(
      "click",
      CLICK_CHECKS,
      { scroll: true, hitTest: true },
      options,
    );
    // "attached" is always required, so the box is present
    await this.clickRect(state.box!);
  }

  /** Clicks the centre of `rect` (viewport pixels) with real pointer input; `click()` and `fill()` use it */
  private async clickRect(
    rect: Pick<ElementRectangle, "x" | "y" | "width" | "height">,
  ) {
    await this.biDiConnector.send("input.performActions", {
      context: this.contextId,
      actions: [
        {
          type: "pointer",
          id: "samurai-pointer",
          actions: [
            {
              type: "pointerMove",
              x: rect.x + rect.width / 2,
              y: rect.y + rect.height / 2,
            },
            {
              type: "pointerDown",
              button: 0,
            },
            {
              type: "pointerUp",
              button: 0,
            },
          ],
        },
      ],
    });
  }

  /**
   * Sets the files of an `<input type=file>`; `[]` clears it. Paths are relative to the project folder (absolute
   * ones are used as they are); `generatedFile(…)` writes a file of a given size when the step runs.
   * Waits for the input to be attached and enabled; it need not be visible, file inputs are often hidden behind a label.
   * @example
   *  await page.getByLabel("Avatar").setInputFiles("files/avatar.png");
   *  await page.getByLabel("Upload").setInputFiles(generatedFile({ name: "huge.pdf", size: "60 MB" }));
   */
  public async setInputFiles(
    files: FileInput | FileInput[],
    options?: { timeout?: number },
  ): Promise<void> {
    const paths = await resolveFileInputs(files, "setInputFiles");

    await this.waitForActionable(
      "setInputFiles",
      FILE_INPUT_CHECKS,
      { scroll: false, hitTest: false },
      options,
    );

    const el = await this.requireElement();
    let info: { tag: string; type: string; multiple: boolean };
    try {
      info = await this.call(FILE_INPUT_INFO, [el]);
    } catch (err) {
      if (err instanceof BiDiError && err.code === "no such node")
        throw this.noElementError();
      throw err;
    }

    if (info.tag !== "input" || info.type !== "file") {
      const found =
        info.tag === "input"
          ? `<input type="${info.type || "text"}">`
          : `<${info.tag}>`;
      throw new Error(
        `setInputFiles(): ${this.selector} is not an <input type=file> (found ${found})`,
      );
    }
    if (paths.length > 1 && !info.multiple) {
      throw new Error(
        `setInputFiles(): ${this.selector} does not accept multiple files`,
      );
    }

    await this.biDiConnector.send("input.setFiles", {
      context: this.contextId,
      element: { sharedId: el.sharedId },
      files: paths,
    });
  }

  /**
   * Drops files on the element, as dragging them from the desktop does: `dragenter`, `dragover` and `drop`
   * with a `DataTransfer` holding the files. Takes what `setInputFiles` takes. The events are synthetic
   * (`isTrusted` is false); a page that only accepts trusted drops ignores them.
   * Waits for the element to be attached and visible.
   * @example
   *  await page.getByTestId("dropzone").dropFiles(["files/a.png", "files/b.png"]);
   */
  public async dropFiles(
    files: FileInput | FileInput[],
    options?: { timeout?: number },
  ): Promise<void> {
    const list = Array.isArray(files) ? files : [files];
    const paths = await resolveFileInputs(list, "dropFiles");
    const types = list.map((file) =>
      isGeneratedFile(file) ? (file.type ?? "") : "",
    );
    await this.waitForActionable(
      "dropFiles",
      DROP_CHECKS,
      { scroll: true, hitTest: false },
      options,
    );
    const el = await this.requireElement();
    // A file input of our own, made in a sandbox and never attached: the page doesn't see it
    const input = await this.call<ElementHandle>(DROP_INPUT, [], DROP_SANDBOX);
    await this.biDiConnector.send("input.setFiles", {
      context: this.contextId,
      element: { sharedId: input.sharedId },
      files: paths,
    });
    await this.call(DROP_EVENTS, [el, types], DROP_SANDBOX);
  }

  /**
   * Takes a screenshot of just this element, after scrolling it into view and waiting until it is attached and
   * visible. Returns the image (also written to `options.path`).
   * @example
   *  await page.locator("div[@id='chart']").screenshot({ path: "out/chart.png" });
   */
  public async screenshot(
    options: ElementScreenshotOptions & { timeout?: number } = {},
  ): Promise<Buffer> {
    const { timeout, ...capture } = options;
    await this.waitForActionable(
      "screenshot",
      SCREENSHOT_CHECKS,
      { scroll: true, hitTest: false },
      timeout === undefined ? undefined : { timeout },
    );
    const el = await this.requireElement();
    return takeScreenshot(this.biDiConnector, this.contextId, capture, {
      sharedId: el.sharedId,
    });
  }

  /** Waits until the element is attached, then focuses it */
  public async focus(options?: ActionOptions): Promise<void> {
    await this.waitForActionable(
      "focus",
      ATTACHED_ONLY,
      { scroll: false, hitTest: false },
      options,
    );
    await this.callOnExistingElement(`el.focus();`);
  }

  /** Waits until the element reaches `state` (default "visible"); does not scroll */
  public async waitFor({
    state = "visible",
    timeout,
  }: { state?: WaitForState; timeout?: number } = {}): Promise<void> {
    const resolved = await resolveTimeout(timeout);
    const reached: Record<WaitForState, (current: ElementState) => boolean> = {
      attached: (current) => current.attached,
      detached: (current) => !current.attached,
      visible: (current) => current.attached && current.visible,
      hidden: (current) => !current.attached || !current.visible,
    };
    try {
      await waitUntil(
        () => this.probeState({ scroll: false, hitTest: false }),
        reached[state],
        {
          timeout: resolved,
        },
      );
    } catch (err) {
      if (!(err instanceof WaitTimeoutError)) throw err;
      throw new ActionTimeoutError({
        action: "waitFor",
        selector: this.selector,
        timeout: resolved,
        reason: err.last === undefined ? "unreadable" : "wrong-state",
        state,
      });
    }
  }

  /** Returns the browser's getBoundingClientRect result for the given element */
  public async getBoundingClientRect(): Promise<ElementRectangle> {
    const rect = await this.callOnExistingElement<unknown>(`
      const { x, y, width, height, top, right, bottom, left } = el.getBoundingClientRect();
      return { x, y, width, height, top, right, bottom, left };
    `);
    if (typeof rect !== "object" || rect === null) {
      throw new Error(
        `Expected to receive an object but instead received "${describeType(rect)}"`,
      );
    }
    return rect as ElementRectangle;
  }

  /** Whether the element exists, has a non-empty box and is not hidden by CSS */
  public async isVisible(): Promise<boolean> {
    const result = await this.callOnElement<unknown>(
      false,
      `
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 &&
        style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
    `,
    );
    return result === true;
  }

  /** Trimmed text content, or null when the element is missing */
  public async textContent(): Promise<string | null> {
    return stringOrNull(
      await this.callOnElement<unknown>(null, `return el.textContent.trim();`),
    );
  }

  /** Value of an input/textarea/select, or null when missing */
  public async inputValue(): Promise<string | null> {
    return stringOrNull(
      await this.callOnElement<unknown>(
        null,
        `return typeof el.value === "string" ? el.value : null;`,
      ),
    );
  }

  /** Attribute value, or null when the element or attribute is missing */
  public async getAttribute(name: string): Promise<string | null> {
    return stringOrNull(
      await this.callOnElement<unknown>(
        null,
        `return el.getAttribute(name);`,
        ["name"],
        [name],
      ),
    );
  }

  /** References to the elements currently matching, in document order. Internal: for tooling that identifies elements */
  public async elements(): Promise<ElementHandle[]> {
    return this.resolve();
  }

  /** Number of elements currently matching */
  public async count(): Promise<number> {
    return (await this.resolve()).length;
  }

  /** Whether the element exists and is not disabled; does not wait */
  public async isEnabled(): Promise<boolean> {
    const state = await this.probeState({ scroll: false, hitTest: false });
    return state.attached && state.enabled;
  }

  /** Whether the element exists and accepts typing (enabled, not readonly, a text field); does not wait */
  public async isEditable(): Promise<boolean> {
    const state = await this.probeState({ scroll: false, hitTest: false });
    return state.attached && state.editable;
  }

  /** Wait for certain time (ms). Default: 300ms  */
  public async wait(duration: number = 300) {
    await this.biDiConnector.send("input.performActions", {
      context: this.contextId,
      actions: [
        {
          type: "none",
          id: "samurai-sleep",
          actions: [
            {
              type: "pause",
              duration,
            },
          ],
        },
      ],
    });
  }

  /**
   * Waits until the element is attached, visible and enabled, focuses it and presses `key` with real keyboard input.
   * Named keys are `Enter`, `Escape`, `Tab`, `Backspace`, `Delete`, `Space`, `Home`, `End`, `PageUp`, `PageDown` and the arrows;
   * any other key must be a single character.
   * @example
   *  await page.getByLabel("New todo").press("Enter");
   */
  public async press(key: string, options?: ActionOptions): Promise<void> {
    const code = NAMED_KEYS[key] ?? (Array.from(key).length === 1 ? key : "");
    if (code === "") {
      throw new Error(
        `press(): unknown key "${key}". Use one of ${Object.keys(NAMED_KEYS).join(", ")} or a single character`,
      );
    }
    await this.waitForActionable(
      "press",
      PRESS_CHECKS,
      { scroll: true, hitTest: false },
      options,
    );
    await this.callOnElement(undefined, `el.focus();`);
    await this.biDiConnector.send("input.performActions", {
      context: this.contextId,
      actions: [
        {
          type: "key",
          id: "samurai-keyboard",
          actions: [
            { type: "keyDown", value: code },
            { type: "keyUp", value: code },
          ],
        },
      ],
    });
  }

  /** Waits until the field is editable and not covered, then replaces its value by typing `value`; an empty string clears it */
  public async fill(value: string, options?: ActionOptions): Promise<void> {
    const state = await this.waitForActionable(
      "fill",
      FILL_CHECKS,
      { scroll: true, hitTest: true },
      options,
    );

    // Typing over the selected existing value replaces it; Backspace clears it for an empty value
    const keys = value === "" ? NAMED_KEYS.Backspace! : value;
    const actions: Array<KeyDownAction | KeyUpAction> = Array.from(
      keys,
    ).flatMap((char) => [
      {
        type: "keyDown",
        value: char,
      },
      {
        type: "keyUp",
        value: char,
      },
    ]);

    await this.clickRect(state.box!);

    await this.wait();

    await this.callOnElement(
      undefined,
      `if (typeof el.select === "function") el.select();`,
    );

    await this.biDiConnector.send("input.performActions", {
      context: this.contextId,
      actions: [
        {
          actions,
          type: "key",
          id: "samurai-keyboard",
        },
      ],
    });
  }
}

function stringOrNull(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value === null) return null;
  throw new Error(
    `Expected a string or null but received "${describeType(value)}"`,
  );
}
