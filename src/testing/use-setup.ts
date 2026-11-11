import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before } from "node:test";
import { browserConfig } from "./test-browser.js";
import { runTests } from "../runner/run.js";

const API = JSON.stringify(path.resolve("src/api.ts"));

let server: Server;
let base = "";
export const seen: Array<Record<string, string | undefined>> = [];

/** The address of the server that `useServer` started */
export const serverBase = () => base;

/** Starts the test server for the file that calls it, and stops it afterwards */
export function useServer() {
  before(async () => {
    server = createServer((req, res) => {
      if (req.url?.startsWith("/echo")) {
        seen.push({
          feature: req.headers["x-feature"] as string | undefined,
          userAgent: req.headers["user-agent"],
          language: req.headers["accept-language"],
        });
        return void res.setHeader("content-type", "text/plain").end("ok");
      }
      res.setHeader("content-type", "text/html").end(
        `<!doctype html><meta name="viewport" content="width=600"><body>
       <p id="a">static</p><script>document.getElementById("a").textContent = "js ran"</script></body>`,
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });
}

/** `logJSON(value)` appends a JSON line to `api.log`; `BASE` is the server above */
const HEAD = `
import { appendFileSync } from "node:fs";
import { test, expect } from ${API};
const BASE = ${"process.env.USE_BASE"};
const logJSON = (value) => appendFileSync(process.env.API_LOG, JSON.stringify(value) + "\\n");
const facts = (page) => page.evaluate(\`() => ({
  language: navigator.language,
  zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  userAgent: navigator.userAgent,
  dark: matchMedia("(prefers-color-scheme: dark)").matches,
  touch: navigator.maxTouchPoints,
  width: innerWidth,
})\`);
`;

export function project(spec: string, config: object = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "samurai-use-"));
  writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
  writeFileSync(
    path.join(dir, "samurai.config.ts"),
    `export default ${JSON.stringify({ srcDir: "./specs", timeout: 40000, expect: { timeout: 2000 }, forbidOnly: false, ...browserConfig(), ...config })};`,
  );
  mkdirSync(path.join(dir, "specs"));
  writeFileSync(path.join(dir, "specs/use.spec.ts"), HEAD + spec);
  const apiLog = path.join(dir, "api.log");
  writeFileSync(apiLog, "");
  process.env.API_LOG = apiLog;
  process.env.USE_BASE = base;
  return {
    dir,
    json: () =>
      readFileSync(apiLog, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Record<string, any>),
  };
}

export async function run(dir: string, port: number) {
  const summary = await runTests({
    projectDir: dir,
    dataDir: path.join(dir, "data"),
    headless: true,
    port,
    workers: 1,
    reportPath: false,
  });
  return summary;
}

export const passed = (summary: Awaited<ReturnType<typeof run>>) =>
  assert.deepEqual(
    summary.tests
      .filter((t) => t.status !== "success")
      .map((t) => [t.name, t.status]),
    [],
  );

export const LONG = { timeout: 180000 };
