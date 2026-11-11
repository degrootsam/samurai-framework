import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { browserConfig } from "./test-browser.js";

export const OPTIONS = { timeout: 90000 };
export const pause = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));
export const PAGE = `data:text/html,<label for="n">Name</label><input id="n"><label>Secret <input type="password" name="pw"></label><button>Save</button>`;

/** A scratch project directory and a config for it */
export function project(config: object = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "samurai-record-"));
  return { dir, config: { ...browserConfig(), srcDir: "./tests", ...config } };
}
