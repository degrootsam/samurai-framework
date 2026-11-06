import type Page from "../../browser/page.js";

/** Methods that read: they pass. `OPTIONS` is the CORS preflight, which carries no data of the page */
const READS = new Set(["GET", "HEAD", "OPTIONS"]);

/** "POST /api/feedback": the method and the path, without the query (it can hold values) */
function describeRequest(method: string, url: string): string {
  try {
    return `${method} ${new URL(url).pathname}`;
  } catch {
    return method;
  }
}

/**
 * Makes the page read-only for the planner: every request that is not a `GET`, `HEAD` or `OPTIONS` is aborted
 * before it leaves the browser (form submits, `fetch`, XHR, beacons), and `onBlocked` hears what it was. A `GET`
 * that changes data and a WebSocket message are not covered. Other origins are the origin policy's business.
 */
export async function installPlanGuard(
  page: Pick<Page, "route">,
  onBlocked: (what: string) => void,
): Promise<void> {
  await page.route("**/*", async (route) => {
    const request = route.request();
    const { method, url } = request;
    if (READS.has(method.toUpperCase())) {
      await route.continue();
      return;
    }
    onBlocked(describeRequest(method.toUpperCase(), url));
    // An aborted form submit leaves Chrome on its error page; an empty 204 answer to a navigation keeps the page
    if (request.resourceType === "document" || request.navigation !== null)
      await route.fulfill({ status: 204 });
    else await route.abort();
  });
}
