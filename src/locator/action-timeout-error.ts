import type { CheckName, CheckResult, CheckResults, WaitForState } from "./element-state.js";

export type ActionTimeoutReason = "unreadable" | "not-attached" | "not-actionable" | "wrong-state";

export interface ActionTimeoutDetails {
  /** Locator method that timed out, e.g. "click" */
  action: string;
  selector: string;
  timeout: number;
  reason: ActionTimeoutReason;
  /** Check results from the last probe, in check order */
  checks?: CheckResults | undefined;
  /** Description of the element covering the target, when the hit-target check failed */
  coveredBy?: string | undefined;
  /** Target state, for waitFor */
  state?: WaitForState | undefined;
}

const SYMBOLS: Record<CheckResult, string> = { pass: "✓", fail: "✗", pending: "—" };

function formatMessage({
  action,
  selector,
  timeout,
  reason,
  checks,
  coveredBy,
  state,
}: ActionTimeoutDetails) {
  switch (reason) {
    case "unreadable":
      return `${action}(): could not read ${selector} within ${timeout}ms`;
    case "not-attached":
      return `${action}(): ${selector} was not attached within ${timeout}ms`;
    case "wrong-state":
      return `${action}(): ${selector} did not become ${state} within ${timeout}ms`;
    case "not-actionable": {
      const summary = (Object.entries(checks ?? {}) as Array<[CheckName, CheckResult]>)
        .map(([name, result]) => {
          const covered =
            name === "hit target" && result === "fail" && coveredBy
              ? ` (covered by ${coveredBy})`
              : "";
          return `${name} ${SYMBOLS[result]}${covered}`;
        })
        .join("  ");
      return `${action}(): ${selector} was not actionable within ${timeout}ms\n  ${summary}`;
    }
  }
}

export class ActionTimeoutError extends Error {
  public readonly action: string;
  public readonly selector: string;
  public readonly timeout: number;
  public readonly reason: ActionTimeoutReason;
  public readonly checks: CheckResults | undefined;
  public readonly coveredBy: string | undefined;
  public readonly state: WaitForState | undefined;

  constructor(details: ActionTimeoutDetails) {
    super(formatMessage(details));
    this.name = "ActionTimeoutError";
    this.action = details.action;
    this.selector = details.selector;
    this.timeout = details.timeout;
    this.reason = details.reason;
    this.checks = details.checks;
    this.coveredBy = details.coveredBy;
    this.state = details.state;
  }
}
