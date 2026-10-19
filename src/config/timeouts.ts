import { readConfig } from "./config.js";
import { peekRunSettings } from "./run-settings.js";

/** The retry time of actions and assertions when nothing sets one (ms) */
const DEFAULT_EXPECT_TIMEOUT = 5000;

/** Per-call timeout, else the active run's expect timeout, else config `expect.timeout`, else 5000 */
export async function resolveTimeout(perCall?: number): Promise<number> {
  if (perCall !== undefined) return perCall;
  const run = peekRunSettings();
  if (run) return run.expectTimeout;
  return (await readConfig("expect"))?.timeout ?? DEFAULT_EXPECT_TIMEOUT;
}
