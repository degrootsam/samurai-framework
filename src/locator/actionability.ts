import { BiDiError } from "../transport/bidi-error.js";
import { ScriptError } from "../script/call-function.js";
import type { ElementHandle } from "../script/element-handle.js";
import { resolveTimeout } from "../config/timeouts.js";
import { waitUntil, WaitTimeoutError } from "../wait/wait-until.js";
import { ActionTimeoutError } from "./action-timeout-error.js";
import { isDocumentSwap } from "./document-swap.js";
import {
  allPass,
  DETACHED_STATE,
  evaluateChecks,
  parseElementState,
  PROBE_ELEMENT,
  type CheckName,
  type CheckResults,
  type ElementState,
  type ProbeOptions,
  type WaitForState,
} from "./element-state.js";
import {
  CALL_PROBE,
  HELPER_SANDBOX,
  HELPERS_MISSING,
  type HelperInstaller,
} from "./helper-realm.js";
import { ATTACHED_ONLY } from "./page-scripts.js";

export interface ActionOptions {
  /**
   * Time (ms) to wait for the element to become actionable. Defaults to config `expect.timeout`, then 5000.
   * 0 checks once without waiting; the stability check is skipped because it needs two probes
   */
  timeout?: number;
  /** Skip every actionability check except "attached" */
  force?: boolean;
}

/** What the actionability waits need of a locator: finding its element, calling into the page, naming itself */
export interface ActionabilityContext {
  resolveOne(): Promise<ElementHandle | null>;
  call<T>(fn: string, args: unknown[], sandbox?: string): Promise<T>;
  /** The locator's description for error messages */
  readonly selector: string;
  /** The page's helper realm; without it the probe source is sent on every poll */
  readonly helpers: HelperInstaller | undefined;
}

/** Reads the element's actionability state: one search, one probe */
export async function probeState(
  ctx: ActionabilityContext,
  options: ProbeOptions,
): Promise<ElementState> {
  const el = await ctx.resolveOne();
  if (!el) return DETACHED_STATE;
  try {
    return parseElementState(await callProbe(ctx, el, options));
  } catch (err) {
    // The document changed between the search and the probe
    if (
      (err instanceof BiDiError && err.code === "no such node") ||
      isDocumentSwap(err)
    )
      return DETACHED_STATE;
    throw err;
  }
}

async function callProbe(
  ctx: ActionabilityContext,
  el: ElementHandle,
  options: ProbeOptions,
): Promise<unknown> {
  const args = [el, { ...options }];
  if (!ctx.helpers) return ctx.call(PROBE_ELEMENT, args);

  await ctx.helpers.ensureInstalled();
  let result = await ctx.call(CALL_PROBE, args, HELPER_SANDBOX);
  if (result === HELPERS_MISSING) {
    // A document got past the registration (e.g. created while it was being set up): install again once
    await ctx.helpers.reinstall();
    result = await ctx.call(CALL_PROBE, args, HELPER_SANDBOX);
    if (result === HELPERS_MISSING) {
      throw new ScriptError(
        "the samurai helpers are missing in the page after reinstalling",
        "probeElement",
      );
    }
  }
  return result;
}

/**
 * Probes until every required check passes and returns that state.
 * Throws ActionTimeoutError describing the last probe on timeout.
 */
export async function waitForActionable(
  ctx: ActionabilityContext,
  action: string,
  checks: readonly CheckName[],
  probe: ProbeOptions,
  options: ActionOptions | undefined,
): Promise<ElementState> {
  const timeout = await resolveTimeout(options?.timeout);
  // Stability compares two probes; with timeout 0 there is only one
  const required = options?.force
    ? ATTACHED_ONLY
    : timeout === 0
      ? checks.filter((check) => check !== "stable")
      : checks;
  let lastChecks: CheckResults | undefined;
  try {
    return await waitUntil(
      () => probeState(ctx, probe),
      (current, previous) => {
        lastChecks = evaluateChecks(required, current, previous);
        return allPass(lastChecks);
      },
      { timeout },
    );
  } catch (err) {
    if (!(err instanceof WaitTimeoutError)) throw err;
    const last = err.last as ElementState | undefined;
    throw new ActionTimeoutError({
      action,
      selector: ctx.selector,
      timeout,
      reason: !last
        ? "unreadable"
        : last.attached
          ? "not-actionable"
          : "not-attached",
      checks: lastChecks,
      coveredBy:
        lastChecks?.["hit target"] === "fail"
          ? (last?.hitTarget ?? undefined)
          : undefined,
    });
  }
}

/** Waits until the element reaches `state` (default "visible"); does not scroll */
export async function waitForState(
  ctx: ActionabilityContext,
  { state = "visible", timeout }: { state?: WaitForState; timeout?: number },
): Promise<void> {
  const resolved = await resolveTimeout(timeout);
  const reached: Record<WaitForState, (current: ElementState) => boolean> = {
    attached: (current) => current.attached,
    detached: (current) => !current.attached,
    visible: (current) => current.attached && current.visible,
    hidden: (current) => !current.attached || !current.visible,
  };
  try {
    await waitUntil(
      () => probeState(ctx, { scroll: false, hitTest: false }),
      reached[state],
      { timeout: resolved },
    );
  } catch (err) {
    if (!(err instanceof WaitTimeoutError)) throw err;
    throw new ActionTimeoutError({
      action: "waitFor",
      selector: ctx.selector,
      timeout: resolved,
      reason: err.last === undefined ? "unreadable" : "wrong-state",
      state,
    });
  }
}
