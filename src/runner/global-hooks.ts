import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  GlobalHookConfig,
  GlobalSetupFunction,
  GlobalTeardownFunction,
  SamuraiTestConfig,
} from "../types/config.js";

type Teardown = () => void | Promise<void>;

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** The function a hook names: given directly, or the default export of the module at `projectDir`/`hook` */
async function loadHook(
  name: "globalSetup" | "globalTeardown",
  hook: string | ((config: GlobalHookConfig) => unknown),
  projectDir: string,
): Promise<(config: GlobalHookConfig) => unknown> {
  if (typeof hook === "function") return hook;
  const file = path.resolve(projectDir, hook);
  let module: { default?: unknown };
  try {
    module = (await import(pathToFileURL(file).href)) as {
      default?: unknown;
    };
  } catch (error) {
    throw new Error(`${name}(): cannot load ${hook}: ${messageOf(error)}`);
  }
  if (typeof module.default !== "function")
    throw new Error(`${name}(): ${hook} must export a function as default`);
  return module.default as (config: GlobalHookConfig) => unknown;
}

/** The run-level hooks of a config: `setup` before the tests, `teardown` after them */
export interface GlobalHooks {
  /** Runs `globalSetup`. A throw is `globalSetup(): message` */
  setup(): Promise<void>;
  /**
   * Runs what the setup returned, then `globalTeardown`; both even when the setup failed half way. Resolves with the
   * first error as `globalTeardown(): message`, else undefined
   */
  teardown(): Promise<Error | undefined>;
}

/** Binds the config's `globalSetup` / `globalTeardown` to the config they receive and the project folder they load from */
export function globalHooks(
  config: SamuraiTestConfig,
  hookConfig: GlobalHookConfig,
  projectDir: string,
): GlobalHooks {
  const returned: Teardown[] = [];
  return {
    async setup() {
      if (config.globalSetup === undefined) return;
      try {
        const setup = (await loadHook(
          "globalSetup",
          config.globalSetup,
          projectDir,
        )) as GlobalSetupFunction;
        const teardown = await setup(hookConfig);
        if (typeof teardown === "function") returned.push(teardown);
      } catch (error) {
        const message = messageOf(error);
        throw new Error(
          message.startsWith("globalSetup(): ")
            ? message
            : `globalSetup(): ${message}`,
        );
      }
    },
    async teardown() {
      let first: Error | undefined;
      const record = (error: unknown) => {
        const message = messageOf(error);
        first ??= new Error(
          message.startsWith("globalTeardown(): ")
            ? message
            : `globalTeardown(): ${message}`,
        );
      };
      for (const teardown of returned.splice(0).reverse())
        try {
          await teardown();
        } catch (error) {
          record(error);
        }
      if (config.globalTeardown !== undefined)
        try {
          const teardown = (await loadHook(
            "globalTeardown",
            config.globalTeardown,
            projectDir,
          )) as GlobalTeardownFunction;
          await teardown(hookConfig);
        } catch (error) {
          record(error);
        }
      return first;
    },
  };
}
