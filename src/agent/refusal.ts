/**
 * What a gateway or proxy in front of the model said when it refused a request, read from the error the AI SDK threw:
 * the HTTP status, the `code` of a `{ error, code }` answer and how long `retry-after` asked to wait. The SDK keeps only the
 * status text of an answer it does not know the shape of, so without this a tool cannot tell "limit reached" from "key refused".
 */
export interface ModelRefusal {
  status: number;
  /** The gateway's stable code, for example `limit_reached` */
  code: string;
  /** Seconds the answer asked to wait before trying again (`retry-after`), when it said */
  retryAfter?: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** The error the SDK gave up on: a retry error wraps the last attempt's, and an error may be the cause of another */
function chainOf(error: unknown): Record<string, unknown>[] {
  const chain: Record<string, unknown>[] = [];
  for (let e = error; isRecord(e) && chain.length < 5;) {
    chain.push(e);
    e = isRecord(e.lastError) ? e.lastError : e.cause;
  }
  return chain;
}

/** The refusal in an error (or in what it wraps), or undefined when it is not an answer with a `code` */
export function modelRefusal(error: unknown): ModelRefusal | undefined {
  for (const e of chainOf(error)) {
    if (typeof e.statusCode !== "number" || typeof e.responseBody !== "string")
      continue;
    let body: unknown;
    try {
      body = JSON.parse(e.responseBody);
    } catch {
      continue;
    }
    if (!isRecord(body) || typeof body.code !== "string") continue;
    const headers = isRecord(e.responseHeaders) ? e.responseHeaders : {};
    const wait = Number(headers["retry-after"]);
    return {
      status: e.statusCode,
      code: body.code,
      ...(headers["retry-after"] !== undefined &&
        Number.isFinite(wait) &&
        wait >= 0 && { retryAfter: wait }),
    };
  }
  return undefined;
}
