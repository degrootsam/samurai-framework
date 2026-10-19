/**
 * Sent with session.new (Firefox) or as capabilities of the chromedriver session (Chrome). With "ignore" the browser
 * leaves a JavaScript dialog open and reports it (`browsingContext.userPromptOpened`), so the framework decides how
 * to answer instead of the browser.
 */
export const SESSION_CAPABILITIES = {
  alwaysMatch: { unhandledPromptBehavior: { default: "ignore" } },
};
