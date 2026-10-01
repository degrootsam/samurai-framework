import type { BiDiConnector } from "../transport/bidi-connection.js";
import { PROBE_ELEMENT } from "../locator/element-state.js";
import { addPreload, runInLoadedContexts, type PreloadHandle } from "./preload.js";

/** Sandbox realm holding the framework's helpers: same DOM as the page, separate JS globals */
export const HELPER_SANDBOX = "samurai";

/** What `CALL_PROBE` answers with when the helpers are not installed in the document */
export const HELPERS_MISSING = "samurai:helpers-missing";

/** Installs `globalThis.__samurai` in the sandbox realm of a document */
export const HELPERS_SOURCE = `() => {
  globalThis.__samurai = { probeElement: ${PROBE_ELEMENT} };
}`;

/** Calls the installed probe, or reports that the helpers are missing instead of throwing */
export const CALL_PROBE = `(...args) => {
  const helpers = globalThis.__samurai;
  return helpers ? helpers.probeElement(...args) : ${JSON.stringify(HELPERS_MISSING)};
}`;

/** What the locator needs from the helper realm */
export interface HelperInstaller {
  /** Resolves once the helpers are registered for the page; installs on first use */
  ensureInstalled(): Promise<void>;
  /** Runs the helpers again in the loaded documents; used when a call found them missing */
  reinstall(): Promise<void>;
}

/** The framework's helper library for one page: registered once, applied to every document */
export class HelperRealm implements HelperInstaller {
  private installed: Promise<PreloadHandle> | undefined;

  constructor(
    private connector: BiDiConnector,
    private contextId: string,
  ) {}

  public ensureInstalled(): Promise<void> {
    this.installed ??= addPreload(this.connector, this.options()).catch((err) => {
      this.installed = undefined;
      throw err;
    });
    return this.installed.then(() => undefined);
  }

  public async reinstall(): Promise<void> {
    if (!this.installed) return this.ensureInstalled();
    await this.installed;
    await runInLoadedContexts(this.connector, this.options());
  }

  /** Removes the registration; nothing is sent when the helpers were never installed */
  public async dispose(): Promise<void> {
    const installed = this.installed;
    this.installed = undefined;
    if (!installed) return;
    await (await installed).dispose();
  }

  private options() {
    return {
      source: HELPERS_SOURCE,
      contexts: [this.contextId],
      sandbox: HELPER_SANDBOX,
    };
  }
}
