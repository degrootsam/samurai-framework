import { readFileSync } from "node:fs";

/** The version of this package */
export function frameworkVersion(): string {
  const manifest = new URL("../../package.json", import.meta.url);
  return (JSON.parse(readFileSync(manifest, "utf8")) as { version: string })
    .version;
}
