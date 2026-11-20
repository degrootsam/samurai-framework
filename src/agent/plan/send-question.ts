/**
 * The question a planning run asks before it lets a request through that is not a page load. It travels as the
 * `send` field of a `question` event; the person answers it through the session like any other question.
 */
export interface PlanSendQuestion {
  /** The request's method, upper case: `POST`, `PUT`, `PATCH`, `DELETE` */
  method: string;
  /** The request's URL without query, fragment or credentials (a query can hold values) */
  url: string;
  /** The page the request came from, written the same way; empty when it could not be read */
  page: string;
  /** The button or field the person would recognise (its accessible name or text), when it could be found */
  label?: string;
  /** Why the planner wants to send it, when it said */
  reason?: string;
}

/** The answer that lets the one held request go out. Anything else (`PLAN_DECLINE`, other text) sends nothing */
export const PLAN_SEND = "send";

/** The answer that sends nothing; the planner records what it could not check */
export const PLAN_DECLINE = "decline";

/** The choices of the question, in the order to show them */
export const PLAN_SEND_OPTIONS: readonly string[] = [PLAN_SEND, PLAN_DECLINE];

/** How a held request ended: sent after a yes, declined, or not asked because nobody could answer */
export interface PlanSendOutcome {
  outcome: "sent" | "declined" | "unasked";
  method: string;
  url: string;
  /** With `sent`: the response's status, when it arrived in time */
  status?: number;
  /** With `sent`: the start of a text response with secrets masked, when it could be read */
  snippet?: string;
}

/** The outcome as one activity line, for a `plan` event: the method, the path and, when sent, what came back */
export function sendOutcomeLine(o: PlanSendOutcome): string {
  let path = o.url;
  try {
    path = new URL(o.url).pathname;
  } catch {
    // keep the text as it is
  }
  const what = `${o.method} ${path}`;
  if (o.outcome === "declined") return `${what} not sent: the person declined.`;
  if (o.outcome === "unasked")
    return `${what} not sent: nobody could be asked.`;
  const got = [o.status, o.snippet && `"${o.snippet}"`].filter(Boolean);
  return `${what} sent after a yes${got.length > 0 ? `: ${got.join(", ")}` : ""}.`;
}

/** Whether an answer lets the request go: exactly `send`, ignoring case and spaces */
export function isSendAnswer(answer: string): boolean {
  return answer.trim().toLowerCase() === PLAN_SEND;
}
