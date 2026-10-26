import type { BiDiConnector } from "../transport/bidi-connection.js";
import { BiDiError } from "../transport/bidi-error.js";
import type {
  BrowsingContext,
  ElementRectangle,
} from "../types/bidi-modules/browsing-context.js";
import { callFunction, ScriptError } from "../script/call-function.js";
import { ElementHandle } from "../script/element-handle.js";
import type { Arg } from "../script/serialize.js";
import {
  takeScreenshot,
  type ElementScreenshotOptions,
} from "../browser/screenshot.js";
import type { FileInput } from "../browser/generated-files.js";
import {
  probeState,
  waitForActionable,
  waitForState,
  type ActionabilityContext,
  type ActionOptions,
} from "./actionability.js";
import { ChainResolver } from "./chain-resolver.js";
import {
  dropFiles,
  setInputFiles,
  type ElementContext,
} from "./file-actions.js";
import {
  describeType,
  type CheckName,
  type ElementState,
  type ProbeOptions,
  type WaitForState,
} from "./element-state.js";
import { bindOutput } from "../wait/output-sink.js";
import type { HelperInstaller } from "./helper-realm.js";
import { cssPropertyName, IS_CHECKED_BODY } from "./element-reads.js";
import {
  clickRect,
  DEFAULT_PAUSE_MS,
  NAMED_KEYS,
  pause,
  pressKey,
  typeText,
} from "./input-actions.js";
import {
  CLICK_CHECKS,
  FILL_CHECKS,
  PRESS_CHECKS,
  SCREENSHOT_CHECKS,
  ATTACHED_ONLY,
} from "./page-scripts.js";
import {
  cssSelector,
  describeChain,
  describeSelector,
  labelSelector,
  roleSelector,
  testIdSelector,
  textSelector,
  xpathSelector,
  type Selector,
  type TextOptions,
} from "./selector.js";

export type { ActionOptions } from "./actionability.js";

export default class Locator {
  private biDiConnector: BiDiConnector;
  private contextId: BrowsingContext;
  private chain: readonly Selector[];
  private helpers: HelperInstaller | undefined;
  private alternatives: readonly Locator[];
  private matched: { index: number; selector: string } | undefined;
  private resolver: ChainResolver;
  /** What the actionability waits use of this locator */
  private actionability: ActionabilityContext;
  /** What the file actions use of this locator */
  private elementContext: ElementContext;

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
    const locator = this;
    this.actionability = {
      resolveOne: () => this.resolveOne(),
      call: (fn, args, sandbox) => this.call(fn, args as Arg[], sandbox),
      get selector() {
        return locator.selector;
      },
      helpers,
    };
    this.elementContext = {
      connector: biDiConnector,
      contextId,
      get selector() {
        return locator.selector;
      },
      call: (fn, args, sandbox) => this.call(fn, args, sandbox),
      waitForActionable: (action, checks, probe, options) =>
        this.waitForActionable(action, checks, probe, options),
      requireElement: () => this.requireElement(),
      noElementError: () => this.noElementError(),
    };
    this.resolver = new ChainResolver(
      biDiConnector,
      contextId,
      (fn, args, sandbox) => this.call(fn, args, sandbox),
    );
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
    const own = await this.resolver.resolveChain(this.chain, max);
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
    if ((await this.resolver.resolveChain(this.chain, 1)).length > 0)
      return this.withoutFallbacks();
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

  private async resolveOne(): Promise<ElementHandle | null> {
    return (await this.resolve(1))[0] ?? null;
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

  private probeState(options: ProbeOptions): Promise<ElementState> {
    return probeState(this.actionability, options);
  }

  private waitForActionable(
    action: string,
    checks: readonly CheckName[],
    probe: ProbeOptions,
    options: ActionOptions | undefined,
  ): Promise<ElementState> {
    return waitForActionable(
      this.actionability,
      action,
      checks,
      probe,
      options,
    );
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
    await clickRect(this.biDiConnector, this.contextId, state.box!);
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
    await setInputFiles(this.elementContext, files, options);
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
    await dropFiles(this.elementContext, files, options);
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
  public async waitFor(
    options: { state?: WaitForState; timeout?: number } = {},
  ): Promise<void> {
    await waitForState(this.actionability, options);
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
    const state = await this.probeState({ scroll: false, hitTest: false });
    return state.attached && state.visible;
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

  /** Like `isEnabled`, but null when the element is missing, so callers can tell "disabled" from "not there"; does not wait */
  public async enabledState(): Promise<boolean | null> {
    const state = await this.probeState({ scroll: false, hitTest: false });
    return state.attached ? state.enabled : null;
  }

  /** Whether a checkbox or radio input is checked or the element has `aria-checked="true"`; null when the element is missing */
  public async isChecked(): Promise<boolean | null> {
    return booleanOrNull(
      await this.callOnElement<unknown>(null, IS_CHECKED_BODY),
    );
  }

  /** The class attribute as written ("" when the element has none), or null when the element is missing */
  public async classAttribute(): Promise<string | null> {
    return stringOrNull(
      await this.callOnElement<unknown>(
        null,
        `return el.getAttribute("class") ?? "";`,
      ),
    );
  }

  /** Computed value of a CSS property (camelCase names become kebab-case, `--custom` is kept), or null when the element is missing */
  public async cssValue(name: string): Promise<string | null> {
    return stringOrNull(
      await this.callOnElement<unknown>(
        null,
        `return getComputedStyle(el).getPropertyValue(name);`,
        ["name"],
        [cssPropertyName(name)],
      ),
    );
  }

  /** Whether the element exists and accepts typing (enabled, not readonly, a text field); does not wait */
  public async isEditable(): Promise<boolean> {
    const state = await this.probeState({ scroll: false, hitTest: false });
    return state.attached && state.editable;
  }

  /** Wait for certain time (ms). Default: 300ms  */
  public async wait(duration: number = DEFAULT_PAUSE_MS) {
    await pause(this.biDiConnector, this.contextId, duration);
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
    await pressKey(this.biDiConnector, this.contextId, code);
  }

  /** Waits until the field is editable and not covered, then replaces its value by typing `value`; an empty string clears it */
  public async fill(
    value: string,
    options?: ActionOptions & { output?: string },
  ): Promise<void> {
    // Taken when the call starts, so a fill that outlives its test saves into that test's closed sink
    const save =
      options?.output === undefined
        ? undefined
        : bindOutput("fill()", options.output);
    const state = await this.waitForActionable(
      "fill",
      FILL_CHECKS,
      { scroll: true, hitTest: true },
      options,
    );

    // Typing over the selected existing value replaces it; Backspace clears it for an empty value
    const keys = value === "" ? NAMED_KEYS.Backspace! : value;

    await clickRect(this.biDiConnector, this.contextId, state.box!);

    // Lets the focus the click caused (and the page's focus handlers) settle before the text is selected and typed over
    await this.wait();

    await this.callOnElement(
      undefined,
      `if (typeof el.select === "function") el.select();`,
    );

    await typeText(this.biDiConnector, this.contextId, keys);
    save?.(value);
  }
}

function booleanOrNull(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === null) return null;
  throw new Error(
    `Expected a boolean or null but received "${describeType(value)}"`,
  );
}

function stringOrNull(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value === null) return null;
  throw new Error(
    `Expected a string or null but received "${describeType(value)}"`,
  );
}
