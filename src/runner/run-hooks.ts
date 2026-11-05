import { resolveConfig } from "../config/resolved-config.js";
import type { RunSettings } from "../config/run-settings.js";
import { webServersOf } from "../config/web-server-options.js";
import logger from "../logger/index.js";
import type { SamuraiTestConfig } from "../types/config.js";
import { globalHooks } from "./global-hooks.js";
import { startWebServers } from "./web-server.js";

/**
 * Runs `work` between the config's run-level steps: web servers start, then `globalSetup`, then `work`, then
 * `globalTeardown`, then the servers stop. The teardown runs when the work or the setup throws (not when a server
 * failed to start, since nothing was set up), and the servers are stopped whatever happens. When the config has no
 * `baseURL` for the run, the first server's address becomes `settings.baseURL`.
 * Errors: a failed start is `webServer(): ...`, a failed setup `globalSetup(): ...`; the work's own error wins over
 * a teardown error, which is logged then.
 */
export async function withRunHooks<T>(
  run: {
    config: SamuraiTestConfig;
    settings: RunSettings;
    projectDir: string;
    signal?: AbortSignal | undefined;
  },
  work: () => Promise<T>,
): Promise<T> {
  const { config, settings, projectDir, signal } = run;
  const servers = webServersOf(config);
  if (
    servers.length === 0 &&
    config.globalSetup === undefined &&
    config.globalTeardown === undefined
  )
    return work();

  const running = await startWebServers(servers, { projectDir, signal });
  let outcome: { value: T } | { error: unknown } | undefined;
  try {
    if (settings.baseURL === undefined && running.baseURL !== undefined)
      settings.baseURL = running.baseURL;
    const hooks = globalHooks(
      config,
      {
        ...resolveConfig(config, { projectDir, env: process.env }),
        environment: settings.environment,
        ...(settings.baseURL !== undefined && { baseURL: settings.baseURL }),
      },
      projectDir,
    );
    try {
      await hooks.setup();
      outcome = { value: await work() };
    } catch (error) {
      outcome = { error };
    }
    const teardownError = await hooks.teardown();
    if (teardownError) {
      if ("error" in outcome) logger.error("%s", teardownError.message);
      else outcome = { error: teardownError };
    }
  } finally {
    await running.stop();
  }
  if (outcome && "error" in outcome) throw outcome.error;
  return (outcome as { value: T }).value;
}
