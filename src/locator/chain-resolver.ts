import type { BiDiConnector } from "../transport/bidi-connection.js";
import { BiDiError } from "../transport/bidi-error.js";
import { UnsupportedOperationError } from "../transport/unsupported.js";
import type { BrowsingContext } from "../types/bidi-modules/browsing-context.js";
import { ElementHandle } from "../script/element-handle.js";
import type { Arg } from "../script/serialize.js";
import { isDocumentSwap } from "./document-swap.js";
import { intersect, union } from "./combine-step.js";
import { applyFilter } from "./filter-step.js";
import { SORT_IN_DOCUMENT_ORDER } from "./page-search.js";
import { InvalidSelectorError } from "./selector-errors.js";
import { pageSearch, textSearch, type PageSearch } from "./page-step.js";
import { describeSelector, toBiDiLocator, type Selector } from "./selector.js";

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

/**
 * How many matches step `index` has to find: `max` for the last step; for a step an `nth` follows, only
 * as many as that index needs, when one start node (or none) makes the search order the document's
 */
function stepLimit(
  chain: readonly Selector[],
  index: number,
  from: readonly ElementHandle[] | undefined,
  max: number | undefined,
): number | undefined {
  if (index === chain.length - 1) return max;
  const next = chain[index + 1]!;
  const single = (from?.length ?? 0) <= 1;
  return next.kind === "nth" && next.index >= 0 && single
    ? next.index + 1
    : undefined;
}

/** Finds the elements a chain of selector steps matches: every step searches inside the previous step's matches */
export class ChainResolver {
  constructor(
    private readonly connector: BiDiConnector,
    private readonly contextId: BrowsingContext,
    private readonly call: CallInPage,
  ) {}

  /**
   * In document order; `max` limits the final result. Nothing is cached: the first match can change between polls.
   * `start` makes the chain relative to those elements: its first step searches inside them, like a later step.
   */
  public async resolveChain(
    chain: readonly Selector[],
    max?: number,
    start?: readonly ElementHandle[],
  ): Promise<ElementHandle[]> {
    let nodes: ElementHandle[] | undefined;
    for (const [index, selector] of chain.entries()) {
      const from = nodes ?? start;
      if (selector.kind === "nth") {
        const picked =
          nodes?.[
            selector.index < 0 ? nodes.length + selector.index : selector.index
          ];
        nodes = picked ? [picked] : [];
      } else if (selector.kind === "and" || selector.kind === "or") {
        try {
          nodes = await this.combine(
            selector,
            from,
            stepLimit(chain, index, from, max),
          );
        } catch (err) {
          if (isDocumentSwap(err)) return [];
          throw err;
        }
      } else if (selector.kind === "filter") {
        try {
          nodes = from
            ? await applyFilter(from, selector, {
                call: this.call,
                findInside: (inner, element) =>
                  this.resolveChain(inner, 1, [element]),
              })
            : [];
        } catch (err) {
          if (isDocumentSwap(err)) return [];
          throw err;
        }
      } else {
        try {
          nodes = await this.locateStep(
            selector,
            from !== undefined,
            from,
            stepLimit(chain, index, from, max),
          );
          // Results per start node are not in document order, which an index into them needs
          if (chain[index + 1]?.kind === "nth" && (from?.length ?? 0) > 1) {
            nodes = await this.inDocumentOrder(nodes);
          }
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

  /**
   * `and` keeps what both chains match; `or` what either matches, in document order. Both chains search from
   * scratch (or inside `from`, when the whole chain is relative). An `or` needs no more than `max` of each
   */
  private async combine(
    { kind, left, right }: Extract<Selector, { kind: "and" | "or" }>,
    from: readonly ElementHandle[] | undefined,
    max: number | undefined,
  ): Promise<ElementHandle[]> {
    const limit = kind === "or" ? max : undefined;
    const first = await this.resolveChain(left, limit, from);
    const second = await this.resolveChain(right, limit, from);
    if (kind === "and") {
      const both = intersect(first, second);
      return max === undefined ? both : both.slice(0, max);
    }
    if (first.length === 0 || second.length === 0) {
      return (first.length === 0 ? second : first).slice(0, max);
    }
    const ordered = await this.inDocumentOrder(union(first, second));
    return max === undefined ? ordered : ordered.slice(0, max);
  }

  private async inDocumentOrder(nodes: ElementHandle[]) {
    if (nodes.length < 2) return nodes;
    return this.call<ElementHandle[]>(SORT_IN_DOCUMENT_ORDER, [nodes]);
  }

  private async locateStep(
    selector: Selector,
    scoped: boolean,
    startNodes: readonly ElementHandle[] | undefined,
    max: number | undefined,
  ): Promise<ElementHandle[]> {
    const inPage = pageSearch(selector);
    if (inPage) return this.locateInPage(inPage, startNodes, max);
    if (
      selector.kind === "text" &&
      unsupportedTypes(this.connector).has("innerText")
    ) {
      return this.locateInPage(textSearch(selector), startNodes, max);
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
          return this.locateInPage(textSearch(selector), startNodes, max);
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
    startNodes: readonly ElementHandle[] | undefined,
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

  /** Runs a page-side search `(starts, ...args) => elements` */
  private async locateInPage(
    { fn, args }: PageSearch,
    startNodes: readonly ElementHandle[] | undefined,
    max: number | undefined,
  ): Promise<ElementHandle[]> {
    const found = await this.call<ElementHandle[]>(fn, [
      startNodes ?? [],
      ...args,
    ]);
    return max === undefined ? found : found.slice(0, max);
  }
}
