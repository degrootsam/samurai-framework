const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/** Where a response sends the client next: its `Location` against the URL it came from; `undefined` when it does not redirect */
export function redirectTarget(
  status: number,
  location: string | undefined,
  from: URL,
): URL | undefined {
  if (!REDIRECTS.has(status) || !location) return undefined;
  try {
    return new URL(location, from);
  } catch {
    return undefined;
  }
}

/**
 * The method and body of the request that follows a redirect. 303 (any method but GET and HEAD) and 301/302 after
 * a POST turn into a GET without a body; 307 and 308 keep both.
 */
export function followUp<B>(
  status: number,
  method: string,
  body: B | undefined,
): { method: string; body: B | undefined } {
  const upgrades =
    (status === 303 && method !== "GET" && method !== "HEAD") ||
    ((status === 301 || status === 302) && method === "POST");
  return upgrades ? { method: "GET", body: undefined } : { method, body };
}
