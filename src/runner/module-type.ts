import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Specs must load as ES modules. A spec in a project whose package.json lacks `"type": "module"` is loaded as
 * CommonJS, which gives it second copies of the framework's modules: `expect(locator)` then no longer
 * recognises a locator, and its tests land in a registry the runner never reads. Fail early instead.
 */
export function assertModuleProject(specFile: string): void {
  if (specFile.endsWith(".mts")) return;
  for (let dir = path.dirname(specFile); ; dir = path.dirname(dir)) {
    const manifest = path.join(dir, "package.json");
    if (existsSync(manifest)) {
      let type: unknown;
      try {
        type = (
          JSON.parse(readFileSync(manifest, "utf8")) as { type?: unknown }
        ).type;
      } catch {
        throw new Error(`Cannot read ${manifest}`);
      }
      if (type === "module") return;
      throw new Error(
        `${manifest} must set "type": "module": specs are ES modules (needed to run ${path.basename(specFile)})`,
      );
    }
    if (path.dirname(dir) === dir) break;
  }
  throw new Error(
    `No package.json with "type": "module" found above ${specFile}: specs are ES modules`,
  );
}
