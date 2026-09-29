import Locator from "../locator/locator.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";
import type { BiDiCommands } from "../types/bidi.js";
import type { BrowsingContext } from "../types/bidi-modules/browsing-context.js";

export default class Page {
  private biDiConnector: BiDiConnector;
  private contextId: BrowsingContext;

  constructor(biDiConnector: BiDiConnector, contextId: string) {
    this.biDiConnector = biDiConnector;
    this.contextId = contextId;
  }
  /** Locates an element on the page and returns an interactable object */
  public locator(xpath: string) {
    return new Locator(xpath, this.biDiConnector, this.contextId);
  }

  /** Navigates to the given URL */
  public async navigateTo(
    url: string,
    wait?: BiDiCommands["browsingContext.navigate"]["params"]["wait"],
    protocol: "http" | "https" = "https",
  ) {
    // A scheme is letters followed by ":" not directly followed by a digit, so "localhost:3000" is a host
    const hasScheme = /^[a-z][a-z\d+.-]*:(?!\d)/i.test(url);
    const parsedURL = hasScheme ? url : `${protocol}://${url}`;
    const result = await this.biDiConnector.send("browsingContext.navigate", {
      context: this.contextId,
      url: parsedURL,
      wait,
    });
    if (!result) {
      throw new Error(`Navigating to ${url} failed`);
    }
  }

  public async waitForNetworkIdle() {
    console.log("Waiting for page to load");
    return new Promise<void>((resolve) => {
      this.biDiConnector.onEvent("browsingContext.load", (params) => {
        if (params.context === this.contextId) {
          console.log({ pageLoaded: params });
          resolve();
        }
      });
    });
  }

  /** Captures an image of the given navigable, and returns it as a Base64-encoded string */
  public async captureScreenshot(
    clip?: BiDiCommands["browsingContext.captureScreenshot"]["params"]["clip"],
    format?: BiDiCommands["browsingContext.captureScreenshot"]["params"]["format"],
    origin?: BiDiCommands["browsingContext.captureScreenshot"]["params"]["origin"],
  ) {
    const screenshot = await this.biDiConnector.send(
      "browsingContext.captureScreenshot",
      {
        context: this.contextId,
        clip,
        format,
        origin,
      },
    );
    // TODO: Store screenshot according to config specs
  }
}
