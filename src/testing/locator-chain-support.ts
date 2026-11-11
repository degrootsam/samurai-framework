import Locator from "../locator/locator.js";
import { remote, stubConnector, type StubResponse } from "./stub-connector.js";

export type Sent = Array<{ method: string; params: unknown }>;
interface LocateParams {
  context: string;
  locator: unknown;
  maxNodeCount?: number;
  startNodes?: Array<{ sharedId: string }>;
}
export const locateCommands = (sent: Sent) =>
  sent
    .filter(({ method }) => method === "browsingContext.locateNodes")
    .map(({ params }) => params as LocateParams);

export const READY: StubResponse = remote({
  attached: true,
  visible: true,
  enabled: true,
  editable: true,
  box: { x: 0, y: 0, width: 10, height: 10 },
  hitTarget: "self",
});

export function chainWith(
  steps: ConstructorParameters<typeof Locator>[0],
  ...responses: StubResponse[]
): { locator: Locator } & ReturnType<typeof stubConnector> {
  const stub = stubConnector(
    ...(responses.length ? responses : [remote(null)]),
  );
  return { locator: new Locator(steps, stub.connector, "ctx"), ...stub };
}
