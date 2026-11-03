import type { BiDiConnector } from "../transport/bidi-connection.js";
import type { BrowserContext } from "./browser-context.js";

/** Grants a browser permission to the origin of the page (`url`), or to `options.origin` */
export async function grantPermission(
  biDiConnector: BiDiConnector,
  url: () => Promise<string>,
  context: () => BrowserContext | undefined,
  name: string,
  options: { origin?: string } = {},
): Promise<void> {
  const origin = options.origin ?? new URL(await url()).origin;
  // about:blank and data: pages have no origin to grant to
  if (origin === "null")
    throw new Error(
      "grantPermission(): needs a page on a web origin, or an explicit origin option",
    );
  const browserContext = context();
  await biDiConnector.send("permissions.setPermission", {
    descriptor: { name },
    state: "granted",
    origin,
    ...(browserContext &&
      !browserContext.isDefault && { userContext: browserContext.id }),
  });
}
