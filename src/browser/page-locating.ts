import Locator from "../locator/locator.js";
import type { FilterOptions } from "../locator/filter-step.js";
import type { RoleOptions } from "../locator/role-locator.js";
import type { ExactOption, TextOptions } from "../locator/selector.js";
import {
  attributeSelector,
  cssSelector,
  labelSelector,
  roleSelector,
  testIdSelector,
  textSelector,
} from "../locator/selector.js";
import { PageActions } from "./page-actions.js";

/** @internal The ways to locate elements */
export abstract class PageLocating extends PageActions {
  /**
   * Locates elements on the page. An xpath (`//x`, `/html/body`, `(//x)[2]`, `./x`, `xpath=…`, or an older
   * relative one such as `a[@id='x']`) or a css selector (`input[name='x']`, `a, button`, `css=…`).
   * `options` filter the matches, as `locator.filter()` does
   */
  public locator(selector: string, options?: FilterOptions<Locator>) {
    const found = this.locators.locate(selector);
    return options === undefined ? found : found.filter(options);
  }

  /**
   * Makes this page's locators strict (or not): an action or read on a locator matching several elements then
   * throws `name(): strict mode violation, N elements match ...` instead of using the first. `undefined` goes back
   * to config `use.strictSelectors` (off unless set). Applies to locators made afterwards and to earlier ones that have not
   * run an action or read yet: a locator keeps the answer it got at its first one
   */
  public setStrictSelectors(enabled: boolean | undefined): void {
    this.locators.setStrictSelectors(enabled);
  }

  /** Locates elements with a CSS selector */
  public getByCss(css: string) {
    return this.locators.locate([cssSelector(css)]);
  }

  /** Locates elements by their text: an exact match unless `match: "partial"` or `exact: false`; a RegExp is tested as written (see `TextOptions`) */
  public getByText(text: string | RegExp, options?: TextOptions) {
    return this.locators.locate([textSelector(text, options)]);
  }

  /** Locates form controls by their label text: an exact match unless `match: "partial"` or `exact: false`; a RegExp is tested as written */
  public getByLabel(text: string | RegExp, options?: TextOptions) {
    return this.locators.locate([labelSelector(text, options)]);
  }

  /** Locates elements by their `placeholder` (see `TextOptions` for `exact` and RegExp) */
  public getByPlaceholder(text: string | RegExp, options?: ExactOption) {
    return this.locators.locate([
      attributeSelector("placeholder", text, options),
    ]);
  }

  /** Locates elements by their `alt` text (images, areas, image inputs) */
  public getByAltText(text: string | RegExp, options?: ExactOption) {
    return this.locators.locate([attributeSelector("alt", text, options)]);
  }

  /** Locates elements by their `title` attribute */
  public getByTitle(text: string | RegExp, options?: ExactOption) {
    return this.locators.locate([attributeSelector("title", text, options)]);
  }

  /** Locates elements by their `data-testid` attribute */
  public getByTestId(testId: string) {
    return this.locators.locate([testIdSelector(testId)]);
  }

  /** Locates elements by ARIA role and, optionally, accessible name and state (see `RoleOptions`) */
  public getByRole(role: string, options?: RoleOptions) {
    return this.locators.locate([roleSelector(role, options)]);
  }
}
