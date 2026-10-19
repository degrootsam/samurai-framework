import type { BiDiConnector } from "../transport/bidi-connection.js";

/**
 * The window realms of `sandbox` in the context, as the browser lists them now. A script message names the realm it
 * came from; only messages from a sandbox the page cannot reach are taken.
 */
export async function listSandboxRealms(
  connector: BiDiConnector,
  context: string,
  sandbox: string,
): Promise<Set<string>> {
  const { realms } = await connector.send("script.getRealms", {
    context,
    type: "window",
  });
  return new Set(
    realms
      .filter((info) => info.type === "window" && info.sandbox === sandbox)
      .map((info) => info.realm),
  );
}
