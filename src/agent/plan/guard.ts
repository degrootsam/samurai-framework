import type Page from "../../browser/page.js";
import { maskText } from "../../config/mask.js";
import {
  isSendAnswer,
  type PlanSendOutcome,
  type PlanSendQuestion,
} from "./send-question.js";

/** Methods that read: they pass. `OPTIONS` is the CORS preflight, which carries no data of the page */
const READS = new Set(["GET", "HEAD", "OPTIONS"]);

/** How long a sent request's response is waited for, to report its status */
const RESPONSE_WAIT_MS = 5000;
const SNIPPET_CHARS = 160;
const LABEL_CHARS = 80;

/** What the guard needs from the run besides the page */
export interface PlanGuardHooks {
  /**
   * Asks the person about one held request and resolves with the answer; only `send` lets it go. Left out when
   * nobody can be asked (`forms: "block"`): every such request is stopped as `unasked`. A rejection (the run
   * ended) stops the request too
   */
  ask?: (question: PlanSendQuestion) => Promise<string>;
  /** The name of the element the planner last acted on, tried before the page is asked (it may be busy loading) */
  label?: () => string | undefined;
  /** The planner's reason for the next send, if it gave one */
  reason?: () => string | undefined;
  /** Gets every held request's whole handling, so the tools can wait for it before they answer */
  track?: (done: Promise<void>) => void;
}

type GuardPage = Pick<
  Page,
  "route" | "url" | "evaluate" | "waitForResponse" | "startBodyCollection"
>;

/** The URL as shown to the person: origin and path, no query, fragment or credentials */
function plainUrl(url: string): string {
  try {
    const { origin, pathname } = new URL(url);
    return `${origin}${pathname}`;
  } catch {
    return "";
  }
}

/**
 * The button the person pressed, best effort: the focused element's accessible name, or the submit button of its
 * form. Never a field's value.
 */
const LABEL_SCRIPT = `(() => {
  const own = (e) => (e.getAttribute("aria-label") || e.innerText || ((e.type === "submit" || e.type === "button") && e.value) || "").trim();
  const e = document.activeElement;
  if (!e || e === document.body) return null;
  let text = own(e);
  if (!text && e.form) {
    const b = e.form.querySelector('button:not([type]), [type="submit"]');
    if (b) text = own(b);
  }
  return text ? text.slice(0, ${LABEL_CHARS}) : null;
})()`;

async function labelOf(page: GuardPage): Promise<string | null> {
  try {
    const found = await Promise.race([
      page.evaluate<string | null>(LABEL_SCRIPT),
      new Promise<null>((resolve) => setTimeout(resolve, 300, null)),
    ]);
    return typeof found === "string" && found !== "" ? maskText(found) : null;
  } catch {
    return null;
  }
}

/** The visible start of a text response: tags dropped, spaces collapsed, secrets masked; null for anything else */
function snippetOf(body: string, contentType: string): string | null {
  if (!/html|json|text|xml/i.test(contentType)) return null;
  const text = body
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text === "" ? null : maskText(text.slice(0, SNIPPET_CHARS));
}

/** The status and snippet of the response to a request that went out; empty when it did not arrive in time */
async function responseOf(
  page: GuardPage,
  requestId: string,
): Promise<Pick<PlanSendOutcome, "status" | "snippet">> {
  try {
    const response = await page.waitForResponse(
      (r) => r.request.id === requestId,
      { timeout: RESPONSE_WAIT_MS },
    );
    const snippet = await response
      .text()
      .then((text) => snippetOf(text, response.headers["content-type"] ?? ""))
      .catch(() => null);
    return { status: response.status, ...(snippet && { snippet }) };
  } catch {
    return {};
  }
}

/**
 * Makes the page's requests that change data wait for the person. A `GET`, `HEAD` or `OPTIONS` passes. Any other
 * request (form submits, `fetch`, XHR, beacons) is held before it leaves the browser and the person is asked,
 * once per request, with no "allow all". A `send` answer lets that one request go; anything else, or nobody to
 * ask, or a run that ends meanwhile, stops it. A held request is never let through by waiting: there is no
 * timeout. `report` hears how each one ended. A `GET` that changes data and a WebSocket message are not covered.
 * Other origins are the origin policy's business.
 */
export async function installPlanGuard(
  page: GuardPage,
  report: (outcome: PlanSendOutcome) => void,
  hooks: PlanGuardHooks = {},
): Promise<void> {
  // One question at a time: a form can send several requests
  let line: Promise<unknown> = Promise.resolve();
  await page.route("**/*", async (route) => {
    const request = route.request();
    const method = request.method.toUpperCase();
    if (READS.has(method)) {
      await route.continue();
      return;
    }
    const url = plainUrl(request.url);
    const turn = line.then(async () => {
      let allowed = false;
      if (hooks.ask) {
        // The page can be busy with the navigation this request starts: never wait long for it
        const known = hooks.label?.();
        const [current, label] = await Promise.all([
          Promise.race([
            page.url().then(plainUrl, () => ""),
            new Promise<string>((resolve) => setTimeout(resolve, 300, "")),
          ]),
          known ? maskText(known) : labelOf(page),
        ]);
        // Chrome's page cannot answer while it starts this navigation: the referer names the page then
        const pageUrl = current || plainUrl(request.headers?.referer ?? "");
        const reason = hooks.reason?.();
        const question: PlanSendQuestion = {
          method,
          url,
          page: pageUrl,
          ...(label && { label }),
          ...(reason && { reason: maskText(reason) }),
        };
        allowed = await hooks.ask(question).then(isSendAnswer, () => false);
      }
      if (allowed) {
        const arrived = responseOf(page, request.id);
        await page.startBodyCollection().catch(() => undefined);
        try {
          await route.continue();
        } catch {
          return; // the page moved on while the question was open
        }
        report({ outcome: "sent", method, url, ...(await arrived) });
        return;
      }
      report({ outcome: hooks.ask ? "declined" : "unasked", method, url });
      try {
        // An aborted form submit leaves Chrome on its error page; an empty 204 answer to a navigation keeps the page
        if (request.resourceType === "document" || request.navigation !== null)
          await route.fulfill({ status: 204 });
        else await route.abort();
      } catch {
        // the page moved on while the question was open
      }
    });
    line = turn.catch(() => undefined);
    hooks.track?.(turn.catch(() => undefined));
    await turn;
  });
}
