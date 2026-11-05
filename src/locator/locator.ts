import type { BiDiConnector } from "../transport/bidi-connection.js";
import type {
  BrowsingContext,
  ElementRectangle,
} from "../types/bidi-modules/browsing-context.js";
import { ElementHandle } from "../script/element-handle.js";
import type { PageFunction } from "../script/call-function.js";
import type { Arg } from "../script/serialize.js";
import type { ElementScreenshotOptions } from "../browser/screenshot.js";
import type { FileInput } from "../browser/generated-files.js";
import {
  waitForActionable,
  waitForState,
  type ActionabilityContext,
  type ActionOptions,
} from "./actionability.js";
import { setChecked, type CheckOptions } from "./check-actions.js";
import { ChainResolver } from "./chain-resolver.js";
import {
  callInPage,
  noElementError,
  requireElement,
  type ElementAccess,
} from "./element-access.js";
import {
  clickElement,
  fillElement,
  focusElement,
  pressOnElement,
  screenshotElement,
} from "./element-actions.js";
import {
  readAccessibleDescription,
  readAccessibleName,
  readAllInnerTexts,
  readAllTextContents,
  readAttribute,
  readBoundingBox,
  readBoundingClientRect,
  readClassAttribute,
  readCssValue,
  readEnabledState,
  readInnerHTML,
  readInnerText,
  readInputValue,
  readIsChecked,
  readIsEditable,
  readIsEnabled,
  readIsVisible,
  readTextContent,
  type BoundingBox,
} from "./element-reads.js";
import { evaluateOnAll, evaluateOnElement } from "./evaluate.js";
import { dropFiles, setInputFiles } from "./file-actions.js";
import type {
  CheckName,
  ElementState,
  ProbeOptions,
  WaitForState,
} from "./element-state.js";
import type { HelperInstaller } from "./helper-realm.js";
import { DEFAULT_PAUSE_MS, pause } from "./input-actions.js";
import {
  NOT_STRICT,
  strictViolation,
  type StrictSource,
} from "./strict-mode.js";
import type { RoleOptions } from "./role-locator.js";
import {
  attributeSelector,
  cssSelector,
  describeChain,
  describeSelector,
  labelSelector,
  nthSelector,
  roleSelector,
  testIdSelector,
  textSelector,
  type Selector,
  type ExactOption,
  type TextOptions,
} from "./selector.js";
import { selectOptions, type SelectOptionValue } from "./select-actions.js";
import { filterSelector, type FilterOptions } from "./filter-step.js";
import { selectorFromString } from "./selector-string.js";

export type { ActionOptions } from "./actionability.js";

export default class Locator {
  private biDiConnector: BiDiConnector;
  private contextId: BrowsingContext;
  private chain: readonly Selector[];
  private helpers: HelperInstaller | undefined;
  private alternatives: readonly Locator[];
  private strictness: StrictSource;
  /** Asked once per locator: the answer comes from the config, which a wait would otherwise read on every poll */
  private strictAnswer: Promise<boolean> | undefined;
  private matched: { index: number; selector: string } | undefined;
  private resolver: ChainResolver;
  /** What the actionability waits use of this locator */
  private actionability: ActionabilityContext;
  /** What the reads and actions use of this locator */
  private access: ElementAccess;

  /**
   * `selector` is an xpath, or a chain of selector steps that each search inside the previous step's matches.
   * `helpers` is the page's helper realm. With it the actionability probe is installed once per
   * document and called by name; without it (a locator built by hand) the probe source is sent on every poll.
   * `alternatives` are fallback locators tried in order whenever this chain matches nothing (see `withFallbacks`).
   * `strictness` says whether actions and reads throw when the locator matches several elements (see `strict`); default no.
   */
  constructor(
    selector: string | readonly Selector[],
    biDiConnector: BiDiConnector,
    contextId: BrowsingContext,
    helpers?: HelperInstaller,
    alternatives: readonly Locator[] = [],
    strictness: StrictSource = NOT_STRICT,
  ) {
    this.chain =
      typeof selector === "string" ? [selectorFromString(selector)] : selector;
    this.biDiConnector = biDiConnector;
    this.contextId = contextId;
    this.helpers = helpers;
    this.alternatives = alternatives;
    this.strictness = strictness;
    const locator = this;
    this.actionability = {
      resolveOne: (method) => this.resolveOne(method),
      call: (fn, args, sandbox) => this.access.call(fn, args as Arg[], sandbox),
      get selector() {
        return locator.selector;
      },
      helpers,
    };
    this.access = {
      connector: biDiConnector,
      contextId,
      get selector() {
        return locator.selector;
      },
      resolveOne: (method) => this.resolveOne(method),
      resolveAll: () => this.resolve(),
      call: (fn, args, sandbox) => callInPage(this.access, fn, args, sandbox),
      waitForActionable: (action, checks, probe, options) =>
        this.waitForActionable(action, checks, probe, options),
      requireElement: () => requireElement(this.access),
      noElementError: () => noElementError(this.access.selector),
    };
    this.resolver = new ChainResolver(
      biDiConnector,
      contextId,
      (fn, args, sandbox) => this.access.call(fn, args, sandbox),
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
    return this.copy({
      chain: [...this.chain, step],
      alternatives: this.alternatives.map((alt) => alt.child(step)),
    });
  }

  /** A locator on the same page and helpers, with the given parts replaced */
  private copy(
    parts: {
      chain?: readonly Selector[] | string;
      alternatives?: readonly Locator[];
      strictness?: StrictSource;
    } = {},
  ): Locator {
    return new Locator(
      parts.chain ?? this.chain,
      this.biDiConnector,
      this.contextId,
      this.helpers,
      parts.alternatives ?? this.alternatives,
      parts.strictness ?? this.strictness,
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
    return this.copy({ alternatives: [...this.alternatives, ...fallbacks] });
  }

  /**
   * This locator, strict or not whatever the page and the config say: a strict locator makes actions and reads
   * (`click`, `fill`, `textContent`, ...) throw `name(): strict mode violation, N elements match ...` when it
   * matches several elements, instead of using the first. Steps added to it stay strict. See config `use.strictSelectors`
   * @example
   *  await page.locator("li").strict().click(); // throws when there is more than one li
   */
  public strict(enabled = true): Locator {
    return this.copy({ strictness: () => Promise.resolve(enabled) });
  }

  /**
   * Which locator found elements the last time this one searched: index 0 is the primary, 1 the first
   * fallback, and so on. `undefined` before any search or when the last search found nothing.
   */
  public get matchedBy(): { index: number; selector: string } | undefined {
    return this.matched;
  }

  /** Elements matching the label text (`<label>`, `aria-labelledby`, `aria-label`), inside this locator's matches. See `TextOptions` for `exact` and RegExp */
  public getByLabel(text: string | RegExp, options?: TextOptions): Locator {
    return this.child(labelSelector(text, options));
  }

  /** Elements whose `placeholder` matches, inside this locator's matches. See `TextOptions` for `exact` and RegExp */
  public getByPlaceholder(text: string | RegExp, options?: ExactOption) {
    return this.child(attributeSelector("placeholder", text, options));
  }

  /** Elements whose `alt` text matches (images, areas, image inputs), inside this locator's matches. See `TextOptions` */
  public getByAltText(text: string | RegExp, options?: ExactOption) {
    return this.child(attributeSelector("alt", text, options));
  }

  /** Elements whose `title` attribute matches, inside this locator's matches. See `TextOptions` */
  public getByTitle(text: string | RegExp, options?: ExactOption) {
    return this.child(attributeSelector("title", text, options));
  }

  /** Elements whose `data-testid` attribute equals `testId`, inside this locator's matches */
  public getByTestId(testId: string): Locator {
    return this.child(testIdSelector(testId));
  }

  /**
   * Elements matching `selector` inside this locator's matches. An xpath (`//x`, `./x`, `xpath=…`, or an older
   * relative one such as `a[@id='x']`) searches inside them; anything else is css (`css=` is accepted).
   * `options` filter the matches, as `filter()` does
   */
  public locator(selector: string, options?: FilterOptions<Locator>): Locator {
    const found = this.child(selectorFromString(selector));
    return options === undefined ? found : found.filter(options);
  }

  /** Elements matching the CSS selector inside this locator's matches */
  public getByCss(css: string): Locator {
    return this.child(cssSelector(css));
  }

  /** Elements whose text matches, inside this locator's matches. Exact match unless `match: "partial"` or `exact: false`; a RegExp is tested as written */
  public getByText(text: string | RegExp, options?: TextOptions): Locator {
    return this.child(textSelector(text, options));
  }

  /** Elements with the ARIA role (and accessible name and state, when given), inside this locator's matches. See `RoleOptions` */
  public getByRole(role: string, options?: RoleOptions): Locator {
    return this.child(roleSelector(role, options));
  }

  /** The n-th (0-based) match, in document order; a negative index counts from the end (`-1` is the last). Matches nothing when out of range */
  public nth(index: number): Locator {
    return this.child(nthSelector(index));
  }

  /**
   * The matches that pass the tests, in their order. `hasText` keeps elements whose text contains the string
   * (case-insensitive, whitespace collapsed; this is Playwright's rule, the `getBy*` text matching is unchanged)
   * or matches the RegExp; `has` keeps elements containing a match of the locator, searched inside them.
   * @example
   *  await page.locator("li").filter({ hasText: "paid", has: page.getByRole("button") }).first().click();
   */
  public filter(options: FilterOptions<Locator>): Locator {
    return this.child(
      filterSelector(options, (inner, option) =>
        inner.chainFor("filter()", option),
      ),
    );
  }

  /** The elements both this locator and `other` match, in this locator's order */
  public and(other: Locator): Locator {
    return this.combined("and", other);
  }

  /** The elements either this locator or `other` matches, in document order, each once */
  public or(other: Locator): Locator {
    return this.combined("or", other);
  }

  private combined(kind: "and" | "or", other: Locator): Locator {
    if (other.contextId !== this.contextId) {
      throw new TypeError(`${kind}(): the locators belong to different pages`);
    }
    return this.copy({
      chain: [
        {
          kind,
          left: this.chainFor(`${kind}()`, "an operand"),
          right: other.chainFor(`${kind}()`, "an operand"),
        },
      ],
      alternatives: [],
    });
  }

  /** The chain of a locator used inside another (`has`); a locator with fallbacks cannot be */
  private chainFor(method: string, role: string): readonly Selector[] {
    if (this.alternatives.length > 0) {
      throw new TypeError(
        `${method}: a locator with fallbacks (withFallbacks) cannot be used as ${role}`,
      );
    }
    return this.chain;
  }

  /** The first match, in document order */
  public first(): Locator {
    return this.nth(0);
  }

  /** The last match, in document order */
  public last(): Locator {
    return this.nth(-1);
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
          this.copy({
            chain: `(${describeSelector(only, false)})[${index + 1}]`,
            alternatives: [],
          })
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
    return this.copy({ alternatives: [] });
  }

  /**
   * The element the locator matches first. With a `method` name and strict selectors on, several matches
   * throw instead (`method` is the public method that asked, for the message)
   */
  private async resolveOne(method?: string): Promise<ElementHandle | null> {
    if (
      method === undefined ||
      !(await (this.strictAnswer ??= this.strictness()))
    ) {
      return (await this.resolve(1))[0] ?? null;
    }
    const found = await this.resolve();
    if (found.length > 1) {
      throw strictViolation(method, found.length, this.selector);
    }
    return found[0] ?? null;
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
    await clickElement(this.access, options);
  }

  /**
   * Checks a checkbox, radio or `role=checkbox|radio|switch` element; does nothing when it is already checked.
   * Waits like `click`, but a hidden input counts as reachable through its `<label>`, which is what gets clicked.
   * `trial` waits without clicking. Throws when the click did not change the state.
   * @example
   *  await page.getByLabel("I accept the terms").check();
   */
  public async check(options?: CheckOptions): Promise<void> {
    await setChecked(this.access, "check", true, options);
  }

  /** Unchecks a checkbox or `role=checkbox|switch` element; does nothing when it is already unchecked. A radio button cannot be unchecked: throws */
  public async uncheck(options?: CheckOptions): Promise<void> {
    await setChecked(this.access, "uncheck", false, options);
  }

  /** `check()` or `uncheck()`, whichever brings the element to `checked` */
  public async setChecked(
    checked: boolean,
    options?: CheckOptions,
  ): Promise<void> {
    await setChecked(this.access, "setChecked", checked, options);
  }

  /**
   * Selects options of a `<select>` or `<select multiple>` (which replaces its selection) and fires `input` and
   * `change`. A string matches an option's value or its label; `{ value, label, index }` must match every field
   * given. Waits until the select is visible and enabled and every option exists. Returns the values now selected.
   * @example
   *  await page.getByLabel("Country").selectOption("Netherlands");
   *  await page.locator("select").selectOption([{ index: 0 }, { value: "b" }]);
   */
  public async selectOption(
    values: SelectOptionValue | SelectOptionValue[],
    options?: ActionOptions,
  ): Promise<string[]> {
    return selectOptions(this.access, values, options);
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
    await setInputFiles(this.access, files, options);
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
    await dropFiles(this.access, files, options);
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
    return screenshotElement(this.access, options);
  }

  /** Waits until the element is attached, then focuses it */
  public async focus(options?: ActionOptions): Promise<void> {
    await focusElement(this.access, options);
  }

  /** Waits until the element reaches `state` (default "visible"); does not scroll */
  public async waitFor(
    options: { state?: WaitForState; timeout?: number } = {},
  ): Promise<void> {
    await waitForState(this.actionability, options);
  }

  /** Returns the browser's getBoundingClientRect result for the given element */
  public async getBoundingClientRect(): Promise<ElementRectangle> {
    return readBoundingClientRect(this.access);
  }

  /** Whether the element exists, has a non-empty box and is not hidden by CSS */
  public async isVisible(): Promise<boolean> {
    return readIsVisible(this.actionability);
  }

  /** The opposite of `isVisible`: true for a hidden element and for one that is not there */
  public async isHidden(): Promise<boolean> {
    return !(await this.isVisible());
  }

  /** Trimmed text content, or null when the element is missing */
  public async textContent(): Promise<string | null> {
    return readTextContent(this.access);
  }

  /** Rendered text of the element (as a person would copy it, hidden text left out), untrimmed, or null when the element is missing */
  public async innerText(): Promise<string | null> {
    return readInnerText(this.access);
  }

  /** The markup inside the element, or null when the element is missing */
  public async innerHTML(): Promise<string | null> {
    return readInnerHTML(this.access);
  }

  /** `textContent` of every match, as the page has it (untrimmed, unlike `textContent()`); `[]` when none match. Does not wait */
  public async allTextContents(): Promise<string[]> {
    return readAllTextContents(this.access);
  }

  /** `innerText` of every match; `[]` when none match. Does not wait */
  public async allInnerTexts(): Promise<string[]> {
    return readAllInnerTexts(this.access);
  }

  /** The element's box in CSS pixels from the viewport's top left, or null when it is missing or not rendered (`display: none`). Does not wait or scroll */
  public async boundingBox(): Promise<BoundingBox | null> {
    return readBoundingBox(this.access);
  }

  /**
   * Waits until the element is attached (hidden is fine), then calls `fn(element, arg)` in the page and returns the result
   * (see `page.evaluate` for what comes back). `fn` is a function or the source of one; a strict locator throws when several match.
   * @example
   *  const id = await page.getByTestId("row").evaluate((el) => el.dataset.id);
   */
  public async evaluate<R = unknown, A = unknown>(
    fn: PageFunction<[any, A], R>,
    arg?: A,
    options?: { timeout?: number },
  ): Promise<R> {
    return evaluateOnElement(this.access, fn, arg, options);
  }

  /** Calls `fn(elements, arg)` in the page with an array of every match (empty when none; does not wait) and returns the result */
  public async evaluateAll<R = unknown, A = unknown>(
    fn: PageFunction<[any[], A], R>,
    arg?: A,
  ): Promise<R> {
    return evaluateOnAll(this.access, fn, arg);
  }

  /** Value of an input/textarea/select, or null when missing */
  public async inputValue(): Promise<string | null> {
    return readInputValue(this.access);
  }

  /** Attribute value, or null when the element or attribute is missing */
  public async getAttribute(name: string): Promise<string | null> {
    return readAttribute(this.access, name);
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
    return readIsEnabled(this.actionability);
  }

  /** The opposite of `isEnabled`: true for a disabled element and for one that is not there; does not wait */
  public async isDisabled(): Promise<boolean> {
    return !(await this.isEnabled());
  }

  /** Like `isEnabled`, but null when the element is missing, so callers can tell "disabled" from "not there"; does not wait */
  public async enabledState(): Promise<boolean | null> {
    return readEnabledState(this.actionability);
  }

  /** Whether a checkbox or radio input is checked or the element has `aria-checked="true"`; null when the element is missing */
  public async isChecked(): Promise<boolean | null> {
    return readIsChecked(this.access);
  }

  /** The accessible name (what `getByRole`'s `name` is matched against), "" when there is none, or null when the element is missing */
  public async accessibleName(): Promise<string | null> {
    return readAccessibleName(this.access);
  }

  /** The accessible description (`aria-describedby`, `aria-description`, else `title` when it is not the name), or null when the element is missing */
  public async accessibleDescription(): Promise<string | null> {
    return readAccessibleDescription(this.access);
  }

  /** The class attribute as written ("" when the element has none), or null when the element is missing */
  public async classAttribute(): Promise<string | null> {
    return readClassAttribute(this.access);
  }

  /** Computed value of a CSS property (camelCase names become kebab-case, `--custom` is kept), or null when the element is missing */
  public async cssValue(name: string): Promise<string | null> {
    return readCssValue(this.access, name);
  }

  /** Whether the element exists and accepts typing (enabled, not readonly, a text field); does not wait */
  public async isEditable(): Promise<boolean> {
    return readIsEditable(this.actionability);
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
    await pressOnElement(this.access, key, options);
  }

  /** Waits until the field is editable and not covered, then replaces its value by typing `value`; an empty string clears it */
  public async fill(
    value: string,
    options?: ActionOptions & { output?: string },
  ): Promise<void> {
    await fillElement(this.access, value, options);
  }
}
