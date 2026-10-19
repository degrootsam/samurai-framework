import {
  type BiDiConnector,
  DEFAULT_COMMAND_TIMEOUT,
} from "../transport/bidi-connection.js";
import { BiDiError } from "../transport/bidi-error.js";
import { SESSION_CAPABILITIES } from "./session-capabilities.js";

/** session.new waits at least this long (ms): the first start after an install can take a while (macOS checks the new app) */
const SESSION_START_TIMEOUT = 120_000;

/** session.new got no reply in time */
export class BrowserStartTimeoutError extends Error {
  constructor(label: string, timeout: number) {
    super(
      `${label} did not finish starting within ${Math.round(timeout / 1000)}s. The first start after an install can be slow; run again.`,
    );
    this.name = "BrowserStartTimeoutError";
  }
}

/** Sends session.new with its own, longer timeout; `label` names the browser in the timeout error */
export async function startSession(
  connector: Pick<BiDiConnector, "send">,
  label: string,
  commandTimeout: number | undefined,
): Promise<void> {
  const timeout = Math.max(
    commandTimeout ?? DEFAULT_COMMAND_TIMEOUT,
    SESSION_START_TIMEOUT,
  );
  try {
    await connector.send(
      "session.new",
      { capabilities: SESSION_CAPABILITIES },
      { timeout },
    );
  } catch (err) {
    if (err instanceof BiDiError && err.code === "timeout")
      throw new BrowserStartTimeoutError(label, timeout);
    throw err;
  }
}

/**
 * Stops what a failed launch started. A browser left running holds the profile (the next launch
 * fails with "already open") and keeps the test process alive.
 */
export function abandonLaunch(
  browserProc: { kill(): boolean },
  biDiConnector: { kill(): void } | undefined,
): void {
  biDiConnector?.kill();
  browserProc.kill();
}
