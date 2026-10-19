import { readConfig } from "../config/config.js";
import logger from "../logger/index.js";
import type { SamuraiTestConfig } from "../types/config.js";
import type { BiDiCommands } from "../types/bidi.js";

/** Time (ms) a navigation or a wait for a load state may take */
const DEFAULT_NAVIGATION_TIMEOUT = 30000;
/** Time (ms) without requests in flight that counts as idle */
const DEFAULT_IDLE_TIME = 500;

/** Options that otherwise come from `samurai.config.ts` */
export type PageSettings = Pick<
  SamuraiTestConfig,
  "network" | "navigation" | "use"
>;

/** What `navigateTo` and `reload` wait for */
export type ReadinessState = NonNullable<
  BiDiCommands["browsingContext.navigate"]["params"]["wait"]
>;

/** A section of the config, or `{}` when it cannot be read (a page can be used without a project) */
async function readSection<K extends keyof PageSettings>(
  key: K,
): Promise<NonNullable<PageSettings[K]>> {
  try {
    return ((await readConfig(key)) ?? {}) as NonNullable<PageSettings[K]>;
  } catch (err) {
    logger.debug("Could not read %s config, using defaults", key, { err });
    return {} as NonNullable<PageSettings[K]>;
  }
}

/** The settings a page uses: the ones it was given, else the project's config, else the defaults */
export class PageConfig {
  constructor(private readonly given?: PageSettings) {}

  public network() {
    return this.given?.network
      ? Promise.resolve(this.given.network)
      : readSection("network");
  }

  public navigation() {
    return this.given?.navigation
      ? Promise.resolve(this.given.navigation)
      : readSection("navigation");
  }

  public use() {
    return this.given?.use
      ? Promise.resolve(this.given.use)
      : readSection("use");
  }

  /** The time (ms) a navigation or a wait may take: the call's, else config `navigation.timeout`, else 30 s */
  public async navigationTimeout(override?: number): Promise<number> {
    return (
      override ??
      (await this.navigation()).timeout ??
      DEFAULT_NAVIGATION_TIMEOUT
    );
  }

  /** What a navigation waits for: the call's, else config `navigation.waitUntil`, else the load event */
  public async navigationWait(
    override?: ReadinessState,
  ): Promise<ReadinessState> {
    return override ?? (await this.navigation()).waitUntil ?? "complete";
  }

  /** Time (ms) without requests in flight that counts as idle: the call's, else config `network.idleTime`, else 500 */
  public async idleTime(override?: number): Promise<number> {
    return override ?? (await this.network()).idleTime ?? DEFAULT_IDLE_TIME;
  }
}
