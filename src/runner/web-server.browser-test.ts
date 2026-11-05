import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { browserConfig } from "../testing/test-browser.js";
import { runTests } from "./run.js";
import { answers } from "./wait-for-url.js";

const API = path.resolve("src/api.ts");

async function freePort(): Promise<number> {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as { port: number };
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** A project whose config starts a node server with a page and has a global setup and teardown */
async function project(extra: object = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "samurai-webserver-run-"));
  const port = await freePort();
  writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
  writeFileSync(
    path.join(dir, "server.cjs"),
    `require("node:http").createServer((q, r) => { r.setHeader("content-type", "text/html"); r.end("<h1>from the web server</h1>"); }).listen(Number(process.argv[2]));`,
  );
  writeFileSync(
    path.join(dir, "setup.mjs"),
    `import { appendFileSync } from "node:fs";
export default async (config) => {
  process.env.FROM_GLOBAL_SETUP = "set by globalSetup";
  appendFileSync("order.log", "setup " + config.baseURL + "\\n");
};`,
  );
  writeFileSync(
    path.join(dir, "teardown.mjs"),
    `import { appendFileSync } from "node:fs";
export default async () => { appendFileSync("order.log", "teardown\\n"); };`,
  );
  writeFileSync(
    path.join(dir, "samurai.config.ts"),
    `export default ${JSON.stringify({
      srcDir: "./specs",
      timeout: 30000,
      ...browserConfig(),
      webServer: {
        command: `node server.cjs ${port}`,
        port,
        timeout: 20000,
      },
      globalSetup: "./setup.mjs",
      globalTeardown: "./teardown.mjs",
      ...extra,
    })};`,
  );
  mkdirSync(path.join(dir, "specs"));
  writeFileSync(
    path.join(dir, "specs", "app.spec.ts"),
    `import { test, expect } from ${JSON.stringify(API)};
for (const name of ["first", "second"]) {
  test(name, async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("from the web server")).toBeVisible();
    expect(process.env.FROM_GLOBAL_SETUP).toBe("set by globalSetup");
  });
}`,
  );
  return { dir, port };
}

for (const workers of [1, 2]) {
  test(
    `specs run against the webServer's baseURL, with globalSetup variables, on ${workers} worker(s)`,
    { timeout: 120000 },
    async () => {
      const { dir, port } = await project();
      const previous = process.cwd();
      process.chdir(dir);
      try {
        const summary = await runTests({
          projectDir: dir,
          dataDir: path.join(dir, "data"),
          headless: true,
          port: 9480 + workers,
          workers,
        });
        assert.equal(summary.status, "success");
        assert.deepEqual(
          summary.tests.map((t) => t.name),
          ["first", "second"],
        );
      } finally {
        process.chdir(previous);
      }
      assert.equal(
        readFileSync(path.join(dir, "order.log"), "utf8"),
        `setup http://localhost:${port}\nteardown\n`,
      );
      assert.equal(await answers({ port }), false, "the server was stopped");
    },
  );
}
