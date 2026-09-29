import type Page from "../browser/page.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";

/**
 * Test-only: replaces the page body with `html`, then runs `setup` (JavaScript source,
 * wrapped in its own function scope) in the page. Reaches into Page's private fields.
 */
export async function setContent(page: Page, html: string, setup = "") {
  const internals = page as unknown as { biDiConnector: BiDiConnector; contextId: string };
  const result = await internals.biDiConnector.send("script.evaluate", {
    expression: `document.body.innerHTML = ${JSON.stringify(html)}; (() => { ${setup} })();`,
    awaitPromise: false,
    target: { context: internals.contextId },
  });
  if (result.type === "exception") {
    throw new Error(`setContent failed: ${result.exceptionDetails.text}`);
  }
}
