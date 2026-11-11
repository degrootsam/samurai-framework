import Locator from "../locator/locator.js";
import { remote, stubConnector, type StubResponse } from "./stub-connector.js";
import { xpathSelector } from "../locator/selector.js";

type StubCalls = ReturnType<typeof stubConnector>["calls"];

export function locatorWith(xpath: string, ...responses: StubResponse[]) {
  const { connector, expressions, nodeCounts, calls } = stubConnector(
    ...responses,
  );
  return {
    locator: new Locator([xpathSelector(xpath)], connector, "ctx"),
    expressions,
    nodeCounts,
    calls: calls as StubCalls,
  };
}

export const text = (value: string): StubResponse => ({
  type: "string",
  value,
});
export const missing: StubResponse = { type: "null" };
/** The element state the visibility probe answers: `visible` or not */
export const bool = (visible: boolean): StubResponse =>
  remote({
    attached: true,
    visible,
    enabled: true,
    editable: true,
    box: visible ? { x: 0, y: 0, width: 10, height: 10 } : null,
    hitTarget: null,
  });
