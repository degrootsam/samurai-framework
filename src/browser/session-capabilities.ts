import type { UseOptions } from "../types/use.js";

/**
 * Sent with session.new (Firefox) or as capabilities of the chromedriver session (Chrome). With "ignore" the browser
 * leaves a JavaScript dialog open and reports it (`browsingContext.userPromptOpened`), so the framework decides how
 * to answer instead of the browser.
 */
export const SESSION_CAPABILITIES = {
  alwaysMatch: { unhandledPromptBehavior: { default: "ignore" } },
};

/** The session capabilities for a launch: the ones above, plus the `use` option that has to be set when the browser starts */
export function sessionCapabilities(
  use?: Pick<UseOptions, "acceptInsecureCerts">,
) {
  return {
    alwaysMatch: {
      ...SESSION_CAPABILITIES.alwaysMatch,
      ...(use?.acceptInsecureCerts !== undefined && {
        acceptInsecureCerts: use.acceptInsecureCerts,
      }),
    },
  };
}
