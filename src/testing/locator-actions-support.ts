import Locator from "../locator/locator.js";
import { xpathSelector } from "../locator/selector.js";
import type { ElementState } from "../locator/element-state.js";
import { remote, stubConnector, type StubResponse } from "./stub-connector.js";

export const BOX = { x: 10, y: 20, width: 100, height: 40 };

/** Element state response; defaults describe an element ready for any action */
export function state(overrides: Partial<ElementState> = {}): StubResponse {
  return remote({
    attached: true,
    visible: true,
    enabled: true,
    editable: true,
    box: BOX,
    hitTarget: "self",
    ...overrides,
  });
}

export const detached = state({
  attached: false,
  visible: false,
  enabled: false,
  editable: false,
  box: null,
  hitTarget: null,
});

export function locatorWith(
  xpath: string,
  ...responses: StubResponse[]
): { locator: Locator } & ReturnType<typeof stubConnector> {
  const stub = stubConnector(...responses);
  return {
    locator: new Locator([xpathSelector(xpath)], stub.connector, "ctx"),
    ...stub,
  };
}

type Performed = {
  actions: Array<{
    type: string;
    actions: Array<{ type: string; x?: number; y?: number; value?: string }>;
  }>;
};
type Sent = Array<{ method: string; params: unknown }>;

function performed(sent: Sent, sourceType: string) {
  return sent
    .filter(({ method }) => method === "input.performActions")
    .map(({ params }) => (params as Performed).actions[0]!)
    .filter((source) => source.type === sourceType);
}

/** [x, y] of the pointerMove of every pointer click sent */
export function pointerClicks(sent: Sent) {
  return performed(sent, "pointer").map((source) => [
    source.actions[0]!.x,
    source.actions[0]!.y,
  ]);
}

export function keysTyped(sent: Sent) {
  return performed(sent, "key")
    .flatMap((source) => source.actions.map((action) => action.value))
    .join("");
}
