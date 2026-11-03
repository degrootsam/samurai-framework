import Locator from "../locator/locator.js";
import type { HelperRealm } from "../locator/helper-realm.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";
import type { BrowsingContext } from "../types/bidi-modules/browsing-context.js";
import type { PageConfig } from "./page-settings.js";

/** Makes the page's locators, and holds whether they are strict */
export class PageLocators {
  private strictOverride: boolean | undefined;

  constructor(
    private biDiConnector: BiDiConnector,
    private id: BrowsingContext,
    private helperRealm: HelperRealm,
    private pageConfig: PageConfig,
    private assertOpen: () => void,
  ) {}

  public locate(selector: ConstructorParameters<typeof Locator>[0]): Locator {
    this.assertOpen();
    return new Locator(
      selector,
      this.biDiConnector,
      this.id,
      this.helperRealm,
      [],
      () => this.pageConfig.strictSelectors(this.strictOverride),
    );
  }

  /** `undefined` goes back to config `use.strictSelectors`; a locator asks once, at its first action or read, so earlier ones that already ran keep their answer */
  public setStrictSelectors(enabled: boolean | undefined): void {
    this.strictOverride = enabled;
  }
}
