import type { ElementRectangle } from "../types/bidi-modules/browsing-context.js";
import type { PageFunction } from "../script/call-function.js";
import type { ElementScreenshotOptions } from "../browser/screenshot.js";
import type { FileInput } from "../browser/generated-files.js";
import {
  waitForState,
  type ActionabilityContext,
  type ActionOptions,
} from "./actionability.js";
import { setChecked, type CheckOptions } from "./check-actions.js";
import type { ElementAccess } from "./element-access.js";
import {
  clearElement,
  fillElement,
  focusElement,
  pressOnElement,
  pressSequentially,
  screenshotElement,
} from "./element-actions.js";
import { blurElement, dispatchEventOn } from "./event-actions.js";
import {
  clickElement,
  hoverElement,
  tapElement,
  type ClickOptions,
  type PointerOptions,
} from "./pointer-element-actions.js";
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
import type { WaitForState } from "./element-state.js";
import { selectOptions, type SelectOptionValue } from "./select-actions.js";

/**
 * The actions and reads of a `Locator` that work on the element its `access` resolves. `Locator` extends this
 * and adds the chain, the fallbacks and the steps that build new locators.
 */
export abstract class LocatorElementMethods {
  /** What the reads and actions use of this locator */
  protected abstract access: ElementAccess;
  /** What the actionability waits use of this locator */
  protected abstract actionability: ActionabilityContext;

  /**
   * Waits until the element is attached, visible, stable, enabled and not covered, then clicks it with real pointer
   * input: its centre, or `position` (pixels from its top left corner). `button`, `clickCount`, `delay` (ms between press
   * and release) and `modifiers` (keys held down) are as in Playwright
   */
  public async click(options?: ClickOptions): Promise<void> {
    await clickElement(this.access, options);
  }

  /** `click` with `clickCount: 2` */
  public async dblclick(options?: ClickOptions): Promise<void> {
    await clickElement(this.access, { ...options, clickCount: 2 }, "dblclick");
  }

  /** Waits until the element is attached, visible, stable and not covered, then moves the mouse onto it (`:hover`, `mouseover`, tooltips) */
  public async hover(options?: PointerOptions): Promise<void> {
    await hoverElement(this.access, options);
  }

  /** Waits like `click`, then touches the element with a touch pointer: `touchstart`, `touchend`, then the mouse events a tap ends in */
  public async tap(options?: PointerOptions): Promise<void> {
    await tapElement(this.access, options);
  }

  /** Waits until the element is attached, then fires a synthetic event (`click`, `keydown`, ...; the class follows the type) at it, bubbling and composed */
  public async dispatchEvent(
    type: string,
    eventInit?: Record<string, unknown>,
    options?: ActionOptions,
  ): Promise<void> {
    await dispatchEventOn(this.access, type, eventInit, options);
  }

  /** Waits until the element is attached, then removes focus from it */
  public async blur(options?: ActionOptions): Promise<void> {
    await blurElement(this.access, options);
  }

  /** Empties an input, textarea or editable element, as `fill("")` does */
  public async clear(options?: ActionOptions): Promise<void> {
    await clearElement(this.access, options);
  }

  /** Focuses the element and types `text` into it one key press at a time, `delay` ms apart */
  public async pressSequentially(
    text: string,
    options?: ActionOptions & { delay?: number },
  ): Promise<void> {
    await pressSequentially(this.access, text, options);
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

  /**
   * Waits until the element is attached, visible and enabled, focuses it and presses `key` with real keyboard input.
   * Named keys are `Enter`, `Escape`, `Tab`, `Backspace`, `Delete`, `Space`, `Insert`, `Home`, `End`, `PageUp`, `PageDown`,
   * `F1` to `F12` and the arrows; any other key must be a single character. A chord holds modifiers (`Control`, `Shift`,
   * `Alt`, `Meta`, `ControlOrMeta`) while the last key is pressed.
   * @example
   *  await page.getByLabel("New todo").press("Enter");
   *  await page.getByLabel("Name").press("Control+a");
   */
  public async press(
    key: string,
    options?: ActionOptions & { delay?: number },
  ): Promise<void> {
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
