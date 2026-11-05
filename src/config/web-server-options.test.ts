import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SamuraiTestConfig } from "../types/config.js";
import { validateConfig } from "./config.js";
import { webServersOf } from "./web-server-options.js";

const bad = (config: unknown, message: string | RegExp) =>
  assert.throws(
    () => validateConfig(config as SamuraiTestConfig),
    typeof message === "string" ? { message } : { message },
  );

describe("config.webServer", () => {
  it("accepts one server or a list", () => {
    validateConfig({ webServer: { command: "x", url: "http://localhost:1" } });
    validateConfig({
      webServer: [
        { command: "x", port: 3000, env: { A: "b" }, stdout: "pipe" },
        {
          command: "y",
          url: "https://a.test",
          gracefulShutdown: { signal: "SIGINT", timeout: 0 },
        },
      ],
    });
    assert.equal(
      webServersOf({ webServer: { command: "x", port: 1 } }).length,
      1,
    );
    assert.equal(webServersOf({}).length, 0);
  });

  it("rejects what is wrong, naming the key", () => {
    bad({ webServer: [] }, "config.webServer: the list must not be empty");
    bad({ webServer: "x" }, "config.webServer: must be an object");
    bad(
      { webServer: { command: "x", port: 1, nope: 1 } },
      'config.webServer: unknown key "nope"',
    );
    bad(
      { webServer: { port: 1 } },
      "config.webServer.command: must be a non-empty string",
    );
    bad(
      { webServer: { command: "x" } },
      "config.webServer: give either url or port",
    );
    bad(
      { webServer: { command: "x", port: 1, url: "http://a" } },
      "config.webServer: give either url or port",
    );
    bad(
      {
        webServer: [
          { command: "x", port: 1 },
          { command: "x", url: "ftp://a" },
        ],
      },
      "config.webServer[1].url: must be an http or https URL",
    );
    bad(
      { webServer: { command: "x", port: 0 } },
      "config.webServer.port: must be a whole number from 1 to 65535",
    );
    bad(
      { webServer: { command: "x", port: 1, timeout: -1 } },
      /config\.webServer\.timeout/,
    );
    bad(
      { webServer: { command: "x", port: 1, env: { A: 1 } } },
      'config.webServer.env: "A" must be a string',
    );
    bad(
      { webServer: { command: "x", port: 1, stdout: "inherit" } },
      'config.webServer.stdout: must be "pipe" or "ignore"',
    );
    bad(
      { webServer: { command: "x", port: 1, reuseExistingServer: 1 } },
      "config.webServer.reuseExistingServer: must be true or false",
    );
    bad(
      {
        webServer: {
          command: "x",
          port: 1,
          gracefulShutdown: { signal: "SIGHUP" },
        },
      },
      /gracefulShutdown\.signal/,
    );
  });

  it("checks globalSetup and globalTeardown", () => {
    validateConfig({ globalSetup: "./setup.ts", globalTeardown: () => {} });
    bad(
      { globalSetup: 3 },
      "config.globalSetup: must be a module path or a function",
    );
    bad(
      { globalTeardown: "" },
      "config.globalTeardown: must be a module path or a function",
    );
  });
});
