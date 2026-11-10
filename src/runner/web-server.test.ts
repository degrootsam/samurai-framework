import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { startWebServers } from "./web-server.js";
import { answers } from "./wait-for-url.js";

const dir = mkdtempSync(path.join(tmpdir(), "samurai-webserver-"));

const SERVER = `
const http = require("node:http");
const fs = require("node:fs");
const [port, pidFile, mode] = process.argv.slice(2);
if (mode === "grandchild") {
  const child = require("node:child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  fs.writeFileSync(pidFile, String(child.pid));
}
if (mode === "ignore-term") process.on("SIGTERM", () => {});
http.createServer((req, res) => { res.statusCode = mode === "login" ? 401 : 200; res.end("ok"); }).listen(Number(port));
`;
const serverFile = path.join(dir, "server.cjs");
writeFileSync(serverFile, SERVER);

async function freePort(): Promise<number> {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as { port: number };
  await new Promise((resolve) => server.close(resolve));
  return port;
}

const serve = (port: number, ...rest: string[]) =>
  `node "${serverFile}" ${port} "${path.join(dir, `pid-${port}`)}" ${rest.join(" ")}`;

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const context = { projectDir: dir };

describe("startWebServers", () => {
  it("starts the command, waits for the url, and stops it", async () => {
    const port = await freePort();
    const running = await startWebServers(
      [
        {
          command: serve(port),
          url: `http://localhost:${port}/`,
          timeout: 15000,
        },
      ],
      context,
    );
    assert.equal(running.baseURL, `http://localhost:${port}`);
    assert.equal(await answers({ port }), true);
    await running.stop();
    assert.equal(await answers({ port }), false);
    await running.stop();
  });

  it("treats a 401 as ready, and waits on a port", async () => {
    const port = await freePort();
    const running = await startWebServers(
      [{ command: serve(port, "login"), port, timeout: 15000 }],
      context,
    );
    assert.equal(running.baseURL, `http://localhost:${port}`);
    assert.equal(await answers({ url: `http://localhost:${port}/` }), true);
    await running.stop();
  });

  it("stops the whole process tree, grandchildren included", async () => {
    const port = await freePort();
    const running = await startWebServers(
      [{ command: serve(port, "grandchild"), port, timeout: 15000 }],
      context,
    );
    const grandchild = Number(
      readFileSync(path.join(dir, `pid-${port}`), "utf8"),
    );
    assert.equal(alive(grandchild), true);
    await running.stop();
    assert.equal(alive(grandchild), false);
  });

  it("kills a server that ignores SIGTERM after the grace period", async () => {
    const port = await freePort();
    const running = await startWebServers(
      [
        {
          command: serve(port, "ignore-term"),
          port,
          timeout: 15000,
          gracefulShutdown: { signal: "SIGTERM", timeout: 300 },
        },
      ],
      context,
    );
    await running.stop();
    // The port closes a moment after stop() returns on some machines (seen in a container), so wait for it
    const deadline = Date.now() + 2000;
    while ((await answers({ port })) && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(await answers({ port }), false);
  });

  it("fails on a timeout with the last lines of its output", async () => {
    const port = await freePort();
    await assert.rejects(
      startWebServers(
        [
          {
            command: `node -e "console.log('starting up'); console.error('still busy'); setInterval(() => {}, 1000)"`,
            port,
            timeout: 700,
          },
        ],
        context,
      ),
      (error: Error) => {
        assert.match(
          error.message,
          /^webServer\(\): timed out after 700ms waiting for localhost:\d+/,
        );
        assert.match(error.message, /starting up/);
        assert.match(error.message, /still busy/);
        return true;
      },
    );
  });

  it("fails when the process exits early, never printing env values", async () => {
    const port = await freePort();
    await assert.rejects(
      startWebServers(
        [
          {
            command: `node -e "console.log('token is ' + process.env.MY_TOKEN); process.exit(3)"`,
            port,
            timeout: 15000,
            env: { MY_TOKEN: "hunter2-secret" },
          },
        ],
        context,
      ),
      (error: Error) => {
        assert.match(
          error.message,
          /the process exited \(code 3\) before localhost:\d+ was ready/,
        );
        assert.match(error.message, /token is /);
        assert.doesNotMatch(error.message, /hunter2/);
        assert.doesNotMatch(error.message, /MY_TOKEN/);
        return true;
      },
    );
  });

  it("refuses a busy url unless reuseExistingServer is set", async () => {
    const port = await freePort();
    const existing = http.createServer((_, res) => res.end("up"));
    await new Promise<void>((resolve) => existing.listen(port, resolve));
    try {
      const marker = path.join(dir, "should-not-exist");
      const command = `node -e "require('fs').writeFileSync('${marker}', '')"`;
      const url = `http://localhost:${port}/`;
      await assert.rejects(
        startWebServers([{ command, url }], context),
        /^Error: webServer\(\): http:\/\/localhost:\d+\/ is already in use/,
      );
      const reused = await startWebServers(
        [{ command, url, reuseExistingServer: true }],
        context,
      );
      assert.equal(reused.baseURL, `http://localhost:${port}`);
      await reused.stop();
      assert.equal(existsSync(marker), false);
      assert.equal(
        await answers({ port }),
        true,
        "a reused server is left running",
      );
    } finally {
      await new Promise((resolve) => existing.close(resolve));
    }
  });

  it("stops the servers already started when a later one fails", async () => {
    const first = await freePort();
    const second = await freePort();
    await assert.rejects(
      startWebServers(
        [
          { command: serve(first), port: first, timeout: 15000 },
          {
            command: `node -e "process.exit(1)"`,
            port: second,
            timeout: 15000,
          },
        ],
        context,
      ),
      /webServer\(\): the process exited/,
    );
    assert.equal(await answers({ port: first }), false);
  });

  it("stops waiting when the run is aborted", async () => {
    const port = await freePort();
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 300);
    await assert.rejects(
      startWebServers(
        [{ command: `node -e "setInterval(() => {}, 1000)"`, port }],
        { projectDir: dir, signal: controller.signal },
      ),
      /webServer\(\): aborted while waiting for localhost:\d+/,
    );
  });
});
