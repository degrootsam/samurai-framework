import type { BiDiConnector } from "../transport/bidi-connection.js";
import type {
  BrowsingContext,
  ElementRectangle,
  SharedReference,
} from "../types/bidi-modules/browsing-context.js";
import type {
  KeyDownAction,
  KeyUpAction,
} from "../types/bidi-modules/input.js";
import type { RemoveDataCollectorResult } from "../types/bidi-modules/network.js";
import type { RemoteValue } from "../types/bidi-modules/script.js";

export interface LocatorOptions {
  useMultiple: boolean;
}
export default class Locator {
  private biDiConnector: BiDiConnector;
  private contextId: BrowsingContext;
  private xpath: string;
  private useMultiple: boolean | undefined = false;

  constructor(
    xpath: string,
    biDiConnector: BiDiConnector,
    contextId: BrowsingContext,
    options?: LocatorOptions,
  ) {
    this.xpath = xpath;
    this.biDiConnector = biDiConnector;
    this.contextId = contextId;
    this.useMultiple = options?.useMultiple;
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

  /** Builds the expression to evaluate on */
  private buildExpression(action?: string) {
    let parsedXpath = this.xpath.startsWith("//")
      ? this.xpath
      : "//" + this.xpath;
    parsedXpath = parsedXpath.replaceAll("'", '"');

    const xpathResultType = this.useMultiple
      ? "XPathResult.ORDERED_NODE_ITERATOR_TYPE"
      : "XPathResult.FIRST_ORDERED_NODE_TYPE";

    return [
      `document.evaluate(
        '${parsedXpath}', 
        document,  
        null,
        ${xpathResultType},
        null
      )`,
      !this.useMultiple && "singleNodeValue",
      action,
    ]
      .filter(Boolean)
      .join(".");
  }

  public async all() {
    if (this.useMultiple) return this;
    return new Locator(this.xpath, this.biDiConnector, this.contextId, {
      useMultiple: true,
    });
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

  /** Simulates keystrokes on any form of input or textarea element*/
  public async fill(value: string) {
    const rect = await this.getBoundingClientRect();

    const actions: Array<KeyDownAction | KeyUpAction> = Array.from(
      value,
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
