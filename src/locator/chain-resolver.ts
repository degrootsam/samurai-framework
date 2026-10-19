import type { BiDiConnector } from "../transport/bidi-connection.js";
import { BiDiError } from "../transport/bidi-error.js";
import { UnsupportedOperationError } from "../transport/unsupported.js";
import type { BrowsingContext } from "../types/bidi-modules/browsing-context.js";
import { ElementHandle } from "../script/element-handle.js";
import type { Arg } from "../script/serialize.js";
import { isDocumentSwap } from "./document-swap.js";
import { LABEL_LOCATE } from "./label-locator.js";
import { InvalidSelectorError } from "./selector-errors.js";
import { describeSelector, toBiDiLocator, type Selector } from "./selector.js";
import { TEXT_LOCATE } from "./text-locator.js";

/** Calls `fn` in the page; the locator turns a throwing function into a "Failed to locate element" error */
export type CallInPage = <T>(
  fn: string,
  args: Arg[],
  sandbox?: string,
) => Promise<T>;

/** Locator types a connection's browser rejected, so they are not tried again on every poll */
const unsupportedByConnector = new WeakMap<BiDiConnector, Set<string>>();

function unsupportedTypes(connector: BiDiConnector): Set<string> {
  let types = unsupportedByConnector.get(connector);
  if (!types) unsupportedByConnector.set(connector, (types = new Set()));
  return types;
}

/** Finds the elements a chain of selector steps matches: every step searches inside the previous step's matches */
export class ChainResolver {
  constructor(
    private readonly connector: BiDiConnector,
    private readonly contextId: BrowsingContext,
    private readonly call: CallInPage,
  ) {}

  /** In document order; `max` limits the final result. Nothing is cached: the first match can change between polls */
  public async resolveChain(
    chain: readonly Selector[],
    max?: number,
  ): Promise<ElementHandle[]> {
    let nodes: ElementHandle[] | undefined;
    for (const [index, selector] of chain.entries()) {
      if (selector.kind === "nth") {
        const picked = nodes?.[selector.index];
        nodes = picked ? [picked] : [];
      } else {
        try {
          nodes = await this.locateStep(
            selector,
            index > 0,
            nodes,
            index === chain.length - 1 ? max : undefined,
          );
        } catch (err) {
          // The page is swapping documents: nothing matches right now, and the waits that poll try again
          if (isDocumentSwap(err)) return [];
          throw err;
        }
      }
      if (nodes.length === 0) return [];
    }
    return nodes ?? [];
  }

  private async locateStep(
    selector: Selector,
    scoped: boolean,
    startNodes: ElementHandle[] | undefined,
    max: number | undefined,
  ): Promise<ElementHandle[]> {
    if (selector.kind === "label")
      return this.locateInPage(LABEL_LOCATE, selector, startNodes, max);
    if (
      selector.kind === "text" &&
      unsupportedTypes(this.connector).has("innerText")
    ) {
      return this.locateInPage(TEXT_LOCATE, selector, startNodes, max);
    }
    try {
      return await this.locateNatively(selector, scoped, startNodes, max);
    } catch (err) {
      if (err instanceof BiDiError && err.code === "invalid selector") {
        throw new InvalidSelectorError(
          describeSelector(selector, scoped),
          err.message,
        );
      }
      if (err instanceof BiDiError && err.code === "unsupported operation") {
        if (selector.kind === "text") {
          // The browser has no innerText locator (Firefox): remember that and search in the page instead
          unsupportedTypes(this.connector).add("innerText");
          return this.locateInPage(TEXT_LOCATE, selector, startNodes, max);
        }
        throw new UnsupportedOperationError(
          `${describeSelector(selector, scoped)}: this kind of locator is not supported by the browser (${err.message})`,
        );
      }
      throw err;
    }
  }

  private async locateNatively(
    selector: Selector,
    scoped: boolean,
    startNodes: ElementHandle[] | undefined,
    max: number | undefined,
  ): Promise<ElementHandle[]> {
    const { nodes } = await this.connector.send("browsingContext.locateNodes", {
      context: this.contextId,
      locator: toBiDiLocator(selector, scoped),
      ...(max !== undefined && { maxNodeCount: max }),
      // Only the references are needed; skip serializing the matched subtrees
      serializationOptions: { maxDomDepth: 0 },
      ...(startNodes && {
        startNodes: startNodes.map(({ sharedId }) => ({ sharedId })),
      }),
    });
    const found = new Map<string, ElementHandle>();
    for (const node of nodes) {
      if (node.sharedId !== undefined && !found.has(node.sharedId)) {
        found.set(node.sharedId, new ElementHandle(node.sharedId));
      }
    }
    return [...found.values()];
  }

  /** Runs a page-side search `(starts, value, match, ignoreCase) => elements` */
  private async locateInPage(
    fn: string,
    selector: Extract<Selector, { kind: "text" | "label" }>,
    startNodes: ElementHandle[] | undefined,
    max: number | undefined,
  ): Promise<ElementHandle[]> {
    const found = await this.call<ElementHandle[]>(fn, [
      startNodes ?? [],
      selector.value,
      selector.match,
      selector.ignoreCase,
    ]);
    return max === undefined ? found : found.slice(0, max);
  }
}
