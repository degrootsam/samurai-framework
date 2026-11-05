import type { BiDiConnector } from "../transport/bidi-connection.js";

type Raw = { send(method: string, params: object): Promise<any> };

/** The CDP session of each page, per connection: `goog:cdp.getSession` attaches on every call */
const sessions = new WeakMap<BiDiConnector, Map<string, string>>();

/**
 * Sends a command the generated BiDi types do not list: `network.setExtraHeaders` (both browsers answer it) and
 * the `goog:cdp.*` commands of Chrome
 */
export function sendRaw(
  connector: BiDiConnector,
  method: string,
  params: object,
): Promise<any> {
  return (connector as unknown as Raw).send(method, params);
}

/**
 * Runs a Chrome DevTools Protocol command on the page `context` through the BiDi connection (`goog:cdp`, Chrome
 * only). Use it where BiDi has no command yet; CDP state belongs to one page, so it is set per page.
 */
export async function cdpSend(
  connector: BiDiConnector,
  context: string,
  method: string,
  params: object,
): Promise<void> {
  let known = sessions.get(connector);
  if (!known) sessions.set(connector, (known = new Map()));
  let session = known.get(context);
  if (session === undefined) {
    const reply = await sendRaw(connector, "goog:cdp.getSession", { context });
    known.set(context, (session = reply.session as string));
  }
  await sendRaw(connector, "goog:cdp.sendCommand", {
    method,
    params,
    session,
  });
}
