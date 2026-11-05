import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { RunSettings } from "../config/run-settings.js";
import type { SamuraiTestConfig } from "../types/config.js";
import { withRunHooks } from "./run-hooks.js";
import { answers } from "./wait-for-url.js";

const dir = mkdtempSync(path.join(tmpdir(), "samurai-run-hooks-"));

const settings = (): RunSettings => ({
  environment: "default",
  timeout: 1000,
  expectTimeout: 1000,
  variables: {},
  headless: true,
});

const run = (config: SamuraiTestConfig, s = settings()) => ({
  config,
  settings: s,
  projectDir: dir,
});

async function freePort(): Promise<number> {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as { port: number };
  await new Promise((resolve) => server.close(resolve));
  return port;
}

const SERVER = `require("node:http").createServer((q, r) => r.end("ok")).listen(Number(process.argv[2]));`;
const serverCommand = (port: number) => {
  const file = path.join(dir, "server.cjs");
  writeFileSync(file, SERVER);
  return `node "${file}" ${port}`;
};

describe("withRunHooks", () => {
  it("runs the work as is when nothing is configured", async () => {
    assert.equal(await withRunHooks(run({}), async () => 7), 7);
  });

  it("orders server start, setup, work, teardown, server stop", async () => {
    const port = await freePort();
    const events: string[] = [];
    const up = async () => ((await answers({ port })) ? "up" : "down");
    const value = await withRunHooks(
      run({
        webServer: { command: serverCommand(port), port, timeout: 15000 },
        globalSetup: async () => {
          events.push(`setup ${await up()}`);
          return async () => void events.push(`returned ${await up()}`);
        },
        globalTeardown: async () => void events.push(`teardown ${await up()}`),
      }),
      async () => {
        events.push(`work ${await up()}`);
        return "done";
      },
    );
    events.push(`after ${await up()}`);
    assert.equal(value, "done");
    assert.deepEqual(events, [
      "setup up",
      "work up",
      "returned up",
      "teardown up",
      "after down",
    ]);
  });

  it("gives the hooks the resolved config with the base URL from the server, and sets it on the run", async () => {
    const port = await freePort();
    const s = settings();
    let seen:
      { baseURL?: string; environment: string; projectDir: string } | undefined;
    await withRunHooks(
      run(
        {
          webServer: { command: serverCommand(port), port, timeout: 15000 },
          globalSetup: (config) => void (seen = config),
        },
        s,
      ),
      async () => undefined,
    );
    assert.equal(s.baseURL, `http://localhost:${port}`);
    assert.equal(seen?.baseURL, `http://localhost:${port}`);
    assert.equal(seen?.environment, "default");
    assert.equal(seen?.projectDir, dir);
  });

  it("keeps a configured baseURL", async () => {
    const port = await freePort();
    const s = { ...settings(), baseURL: "https://configured.test" };
    await withRunHooks(
      run(
        { webServer: { command: serverCommand(port), port, timeout: 15000 } },
        s,
      ),
      async () => undefined,
    );
    assert.equal(s.baseURL, "https://configured.test");
  });

  it("runs the teardown and stops the servers when the work fails, and the work's error wins", async () => {
    const port = await freePort();
    const events: string[] = [];
    await assert.rejects(
      withRunHooks(
        run({
          webServer: { command: serverCommand(port), port, timeout: 15000 },
          globalTeardown: () => {
            events.push("teardown");
            throw new Error("teardown broke");
          },
        }),
        async () => {
          throw new Error("tests broke");
        },
      ),
      /^Error: tests broke$/,
    );
    assert.deepEqual(events, ["teardown"]);
    assert.equal(await answers({ port }), false);
  });

  it("fails with globalSetup(): when the setup throws, but still tears down", async () => {
    const events: string[] = [];
    await assert.rejects(
      withRunHooks(
        run({
          globalSetup: () => {
            events.push("setup");
            throw new Error("db is down");
          },
          globalTeardown: () => void events.push("teardown"),
        }),
        async () => void events.push("work"),
      ),
      /^Error: globalSetup\(\): db is down$/,
    );
    assert.deepEqual(events, ["setup", "teardown"]);
  });

  it("fails with globalTeardown(): when only the teardown throws", async () => {
    await assert.rejects(
      withRunHooks(
        run({
          globalSetup: () => () => {
            throw new Error("cleanup failed");
          },
        }),
        async () => undefined,
      ),
      /^Error: globalTeardown\(\): cleanup failed$/,
    );
  });

  it("does not run the setup or teardown when a web server fails to start", async () => {
    const events: string[] = [];
    await assert.rejects(
      withRunHooks(
        run({
          webServer: {
            command: `node -e "process.exit(1)"`,
            port: await freePort(),
            timeout: 15000,
          },
          globalSetup: () => void events.push("setup"),
          globalTeardown: () => void events.push("teardown"),
        }),
        async () => void events.push("work"),
      ),
      /^Error: webServer\(\): /,
    );
    assert.deepEqual(events, []);
  });

  it("loads hooks from module paths relative to the project, and passes env to the work", async () => {
    writeFileSync(
      path.join(dir, "setup.mjs"),
      `export default async () => { process.env.SAMURAI_TEST_FROM_SETUP = "yes"; return () => { process.env.SAMURAI_TEST_TORN = "1"; }; };`,
    );
    writeFileSync(
      path.join(dir, "teardown.mjs"),
      `export default () => { process.env.SAMURAI_TEST_TORN += "2"; };`,
    );
    let during: string | undefined;
    await withRunHooks(
      run({ globalSetup: "./setup.mjs", globalTeardown: "teardown.mjs" }),
      async () => void (during = process.env.SAMURAI_TEST_FROM_SETUP),
    );
    assert.equal(during, "yes");
    assert.equal(process.env.SAMURAI_TEST_TORN, "12");
    delete process.env.SAMURAI_TEST_FROM_SETUP;
    delete process.env.SAMURAI_TEST_TORN;
  });

  it("explains a module that is missing or exports no function", async () => {
    writeFileSync(path.join(dir, "bad.mjs"), "export const x = 1;");
    await assert.rejects(
      withRunHooks(run({ globalSetup: "./nope.mjs" }), async () => 1),
      /^Error: globalSetup\(\): cannot load \.\/nope\.mjs: /,
    );
    await assert.rejects(
      withRunHooks(run({ globalSetup: "./bad.mjs" }), async () => 1),
      /^Error: globalSetup\(\): \.\/bad\.mjs must export a function as default$/,
    );
  });
});
