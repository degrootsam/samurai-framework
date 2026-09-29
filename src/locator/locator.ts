import type { BiDiConnector } from "../transport/bidi-connection.js";
import type {
  BrowsingContext,
  ElementRectangle,
} from "../types/bidi-modules/browsing-context.js";
import type {
  KeyDownAction,
  KeyUpAction,
} from "../types/bidi-modules/input.js";
import type { RemoteValue } from "../types/bidi-modules/script.js";
import { resolveTimeout, waitUntil, WaitTimeoutError } from "../wait/wait-until.js";
import { ActionTimeoutError } from "./action-timeout-error.js";
import {
  allPass,
  elementStateScript,
  evaluateChecks,
  parseElementState,
  type CheckName,
  type CheckResults,
  type ElementState,
  type ProbeOptions,
  type WaitForState,
} from "./element-state.js";

export type { WaitForState } from "./element-state.js";

export interface ActionOptions {
  /**
   * Time (ms) to wait for the element to become actionable. Defaults to config `expect.timeout`, then 5000.
   * 0 checks once without waiting; the stability check is skipped because it needs two probes
   */
  timeout?: number;
  /** Skip every actionability check except "attached" */
  force?: boolean;
}

const CLICK_CHECKS: readonly CheckName[] = ["attached", "visible", "stable", "enabled", "hit target"];
const FILL_CHECKS: readonly CheckName[] = ["attached", "visible", "enabled", "editable", "hit target"];
const ATTACHED_ONLY: readonly CheckName[] = ["attached"];

/** Unicode code point WebDriver uses for the Backspace key */
const BACKSPACE = "";

export default class Locator {
  private biDiConnector: BiDiConnector;
  private contextId: BrowsingContext;
  private xpath: string;

  constructor(
    xpath: string,
    biDiConnector: BiDiConnector,
    contextId: BrowsingContext,
  ) {
    this.xpath = xpath;
    this.biDiConnector = biDiConnector;
    this.contextId = contextId;
  }

  private async evaluate(expression: string): Promise<RemoteValue> {
    const locatorResult = await this.biDiConnector.send("script.evaluate", {
      expression,
      awaitPromise: false,
      target: {
        context: this.contextId,
      },
    });

    if (locatorResult.type === "exception") {
      throw new Error(
        `Failed to locate element ${this.xpath}. Details: ${locatorResult.exceptionDetails.text}`,
      );
    }

    return locatorResult.result;
  }

  /** Normalises the xpath: relative xpaths get a leading `//`; absolute, grouped and context paths are kept */
  private parsedXpath() {
    return /^[/(.]/.test(this.xpath) ? this.xpath : "//" + this.xpath;
  }

  /** The normalised xpath this locator evaluates */
  public get selector(): string {
    return this.parsedXpath();
  }

  /** JS expression for the first element matching the xpath, or null. The xpath is embedded as a JSON string so any quotes survive */
  private elementExpression() {
    return `document.evaluate(${JSON.stringify(this.parsedXpath())}, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue`;
  }

  /** Builds the expression calling `action` on the first matching element */
  private buildExpression(action: string) {
    return `${this.elementExpression()}.${action}`;
  }

  /** One locator per element currently matching the xpath, in document order */
  public async all(): Promise<Locator[]> {
    const count = await this.count();
    return Array.from(
      { length: count },
      (_, index) =>
        new Locator(
          `(${this.parsedXpath()})[${index + 1}]`,
          this.biDiConnector,
          this.contextId,
        ),
    );
  }

  /** Reads the element's actionability state in one round trip */
  private async probeState(options: ProbeOptions): Promise<ElementState> {
    return parseElementState(
      await this.evaluate(elementStateScript(this.elementExpression(), options)),
    );
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
        reason: !last ? "unreadable" : last.attached ? "not-actionable" : "not-attached",
        checks: lastChecks,
        coveredBy: lastChecks?.["hit target"] === "fail" ? (last?.hitTarget ?? undefined) : undefined,
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

  /** Simulate a click event on the center off a page element.
   * This is mostly used internally to focus input elements when using the `fill()` method
   * @example
   *  const container = page.locator("div[@id=['clickable-element']");
   *  const rect = await container.getBoundingClientRect();
   *  await container.clickRect(rect);
   */
  public async clickRect(rect: Pick<ElementRectangle, "x" | "y" | "width" | "height">) {
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

  /** Waits until the element is attached, then focuses it */
  public async focus(options?: ActionOptions): Promise<void> {
    await this.waitForActionable("focus", ATTACHED_ONLY, { scroll: false, hitTest: false }, options);
    await this.evaluate(this.buildExpression("focus()"));
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
      await waitUntil(() => this.probeState({ scroll: false, hitTest: false }), reached[state], {
        timeout: resolved,
      });
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
    let expression = this.buildExpression("getBoundingClientRect()");
    expression = `var rect = ${expression}; (JSON.stringify(rect));`;
    const rect = await this.evaluate(expression);
    if (rect.type !== "string")
      throw new Error(
        `Expected to receive an object but instead received "${rect.type}"`,
      );

    return JSON.parse(rect.value);
  }

  /** Evaluates `body` with `el` bound to the first matching element, or null when nothing matches */
  private readElement(body: string) {
    return this.evaluate(`(() => {
      const el = ${this.elementExpression()};
      ${body}
    })()`);
  }

  private stringOrNull(value: RemoteValue): string | null {
    if (value.type === "string") return value.value;
    if (value.type === "null") return null;
    throw new Error(`Expected a string or null but received "${value.type}"`);
  }

  /** Whether the element exists, has a non-empty box and is not hidden by CSS */
  public async isVisible(): Promise<boolean> {
    const result = await this.readElement(`
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 &&
        style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
    `);
    return result.type === "boolean" && result.value;
  }

  /** Trimmed text content, or null when the element is missing */
  public async textContent(): Promise<string | null> {
    return this.stringOrNull(
      await this.readElement(`return el ? el.textContent.trim() : null;`),
    );
  }

  /** Value of an input/textarea/select, or null when missing */
  public async inputValue(): Promise<string | null> {
    return this.stringOrNull(
      await this.readElement(`return el && typeof el.value === "string" ? el.value : null;`),
    );
  }

  /** Attribute value, or null when the element or attribute is missing */
  public async getAttribute(name: string): Promise<string | null> {
    return this.stringOrNull(
      await this.readElement(`return el ? el.getAttribute(${JSON.stringify(name)}) : null;`),
    );
  }

  /** Number of elements matching the xpath */
  public async count(): Promise<number> {
    const result = await this.evaluate(
      `document.evaluate(${JSON.stringify(`count(${this.parsedXpath()})`)}, document, null, XPathResult.NUMBER_TYPE, null).numberValue`,
    );
    if (result.type !== "number") {
      throw new Error(`Expected a number but received "${result.type}"`);
    }
    return result.value;
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

  /** Waits until the field is editable and not covered, then replaces its value by typing `value`; an empty string clears it */
  public async fill(value: string, options?: ActionOptions): Promise<void> {
    const state = await this.waitForActionable(
      "fill",
      FILL_CHECKS,
      { scroll: true, hitTest: true },
      options,
    );

    // Typing over the selected existing value replaces it; Backspace clears it for an empty value
    const keys = value === "" ? BACKSPACE : value;
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

    await this.readElement(`if (el && typeof el.select === "function") el.select();`);

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
