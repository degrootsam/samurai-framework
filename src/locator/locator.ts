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

  /** Simulate a 'Click' event on the element */
  public async click() {
    return await this.evaluate(this.buildExpression("click()"));
  }

  /** Simulate a click event on the center off a page element.
   * This is mostly used internally to focus input elements when using the `fill()` method
   * @example
   *  const container = page.locator("div[@id=['clickable-element']");
   *  const rect = await container.getBoundingClientRect();
   *  await container.clickRect(rect);
   */
  public async clickRect(rect: ElementRectangle) {
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

  /** Simulates focusing an element */
  public async focus() {
    return await this.evaluate(this.buildExpression("focus()"));
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

  /** Replaces the value of an input or textarea by typing `value`; an empty string clears it */
  public async fill(value: string) {
    const rect = await this.getBoundingClientRect();

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

    await this.clickRect(rect);

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
