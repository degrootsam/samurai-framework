import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { resetWarnOnce, warnOnce } from "../logger/warn-once.js";
import logger from "../logger/index.js";
import {
  autoReply,
  FakeWebSocket,
  makeConnector,
} from "../testing/fake-websocket.js";
import { cdpSend } from "./cdp.js";
import { ensureBrowserProfile } from "./launch-flags.js";
import { sessionCapabilities } from "./session-capabilities.js";
import { cookiesOf } from "./storage-state.js";
import { loadStorageState } from "../config/storage-state-file.js";
import { UseApplier } from "./use-applier.js";
import { applyViewport } from "./viewport.js";

const dirs: string[] = [];
const stops: Array<() => void> = [];
afterEach(() => {
  dirs
    .splice(0)
    .forEach((dir) => rmSync(dir, { recursive: true, force: true }));
  stops.splice(0).forEach((stop) => stop());
});
const tmp = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "samurai-use-unit-"));
  dirs.push(dir);
  return dir;
};

function cdpSetup() {
  const ws = new FakeWebSocket();
  const connector = makeConnector(ws);
  let sessions = 0;
  stops.push(
    autoReply(ws, {
      "goog:cdp.getSession": () => ({ session: `s${++sessions}` }),
      "goog:cdp.sendCommand": () => ({ result: {} }),
      "browsingContext.setViewport": () => ({}),
    }),
  );
  const sent = (method: string) =>
    ws.sent.filter((m) => m.method === method).map((m) => m.params as any);
  return { connector, sent };
}

describe("warnOnce", () => {
  it("warns the first time a key is seen and not again", () => {
    resetWarnOnce();
    const lines: string[] = [];
    const warn = logger.warn.bind(logger);
    logger.warn = ((message: string) => (lines.push(message), logger)) as never;
    try {
      warnOnce("a", "first");
      warnOnce("a", "first");
      warnOnce("b", "second");
    } finally {
      logger.warn = warn;
      resetWarnOnce();
    }
    assert.deepEqual(lines, ["first", "second"]);
  });
});

describe("storage state", () => {
  it("reads a file relative to the folder and checks it", () => {
    const dir = tmp();
    writeFileSync(path.join(dir, "s.json"), '{"cookies":[]}');
    assert.deepEqual(loadStorageState("s.json", dir), { cookies: [] });
    assert.throws(
      () => loadStorageState("missing.json", dir),
      /^Error: use\(\): storageState file "missing\.json" could not be read/,
    );
    writeFileSync(path.join(dir, "bad.json"), "[]");
    assert.throws(
      () => loadStorageState("bad.json", dir),
      /must hold an object/,
    );
    writeFileSync(path.join(dir, "bad2.json"), '{"cookies":[{"name":"a"}]}');
    assert.throws(
      () => loadStorageState("bad2.json", dir),
      /use\(\): every storageState cookie/,
    );
    const state = { origins: [] };
    assert.equal(loadStorageState(state, dir), state);
  });

  it("turns Playwright cookies into context cookies", () => {
    assert.deepEqual(
      cookiesOf({
        cookies: [
          { name: "a", value: "1", domain: ".example.com", expires: -1 },
          {
            name: "b",
            value: "2",
            domain: "example.com",
            path: "/x",
            expires: 1900000000,
            httpOnly: true,
            secure: true,
            sameSite: "Lax",
          },
        ],
      }),
      [
        { name: "a", value: "1", domain: ".example.com" },
        {
          name: "b",
          value: "2",
          domain: "example.com",
          path: "/x",
          expiry: 1900000000,
          httpOnly: true,
          secure: true,
          sameSite: "lax",
        },
      ],
    );
  });
});

describe("what is fixed when the browser starts", () => {
  it("acceptInsecureCerts joins the session capabilities only when chosen", () => {
    assert.equal(
      "acceptInsecureCerts" in sessionCapabilities().alwaysMatch,
      false,
    );
    assert.equal(
      sessionCapabilities({ acceptInsecureCerts: true }).alwaysMatch
        .acceptInsecureCerts,
      true,
    );
    assert.deepEqual(
      sessionCapabilities().alwaysMatch.unhandledPromptBehavior,
      { default: "ignore" },
    );
  });

  it("Firefox's profile always names JavaScript and the colour scheme, so one run cannot leak into the next", () => {
    const file = path.join(tmp(), "user.js");
    ensureBrowserProfile("firefox", file);
    const plain = readFileSync(file, "utf8");
    assert.match(plain, /"javascript\.enabled", true/);
    assert.match(plain, /content-override", 2/);

    ensureBrowserProfile("firefox", file, {
      javaScriptEnabled: false,
      colorScheme: "dark",
    });
    const chosen = readFileSync(file, "utf8");
    assert.match(chosen, /"javascript\.enabled", false/);
    assert.match(chosen, /content-override", 0/);

    ensureBrowserProfile("firefox", file, { colorScheme: "light" });
    assert.match(readFileSync(file, "utf8"), /content-override", 1/);
    ensureBrowserProfile("firefox", file);
    assert.equal(readFileSync(file, "utf8"), plain);
  });
});

describe("Chrome's phone layout", () => {
  it("sizes a mobile page through CDP and reuses the page's session", async () => {
    const { connector, sent } = cdpSetup();
    await applyViewport(
      connector,
      "ctx",
      { width: 390, height: 844, devicePixelRatio: 3 },
      true,
    );
    await applyViewport(connector, "ctx", null, true);
    assert.deepEqual(
      sent("goog:cdp.sendCommand").map((p) => [p.method, p.params, p.session]),
      [
        [
          "Emulation.setDeviceMetricsOverride",
          { width: 390, height: 844, deviceScaleFactor: 3, mobile: true },
          "s1",
        ],
        [
          "Emulation.setDeviceMetricsOverride",
          { width: 0, height: 0, deviceScaleFactor: 0, mobile: true },
          "s1",
        ],
      ],
    );
    assert.equal(sent("goog:cdp.getSession").length, 1);
    assert.equal(sent("browsingContext.setViewport").length, 0);
  });

  it("a page that is not mobile is still sized through BiDi", async () => {
    const { connector, sent } = cdpSetup();
    await applyViewport(connector, "ctx", { width: 500, height: 600 });
    assert.equal(sent("browsingContext.setViewport").length, 1);
    assert.equal(sent("goog:cdp.sendCommand").length, 0);
  });

  it("cdpSend names the page's session", async () => {
    const { connector, sent } = cdpSetup();
    await cdpSend(connector, "p1", "Emulation.setEmulatedMedia", {
      features: [],
    });
    await cdpSend(connector, "p2", "Emulation.setEmulatedMedia", {
      features: [],
    });
    assert.deepEqual(
      sent("goog:cdp.sendCommand").map((p) => p.session),
      ["s1", "s2"],
    );
  });
});

describe("UseApplier", () => {
  const applier = (browser: "firefox" | "chrome", options: object) =>
    new UseApplier(cdpSetup().connector, browser, options, tmp());

  it("reports isMobile and hasTouch only where the browser can do them", () => {
    resetWarnOnce();
    const both = { isMobile: true, hasTouch: true };
    assert.equal(applier("chrome", both).isMobile, true);
    assert.equal(applier("chrome", both).hasTouch, true);
    assert.equal(applier("firefox", both).isMobile, false);
    assert.equal(applier("firefox", both).hasTouch, false);
    assert.equal(applier("chrome", {}).isMobile, false);
  });

  describe("context(): the options that go through BiDi", () => {
    const run = async (
      browser: "firefox" | "chrome",
      options: object,
      handlers: Record<string, () => object | Error> = {},
    ) => {
      const ws = new FakeWebSocket();
      stops.push(
        autoReply(ws, {
          "emulation.setLocaleOverride": () => ({}),
          "emulation.setTimezoneOverride": () => ({}),
          "emulation.setGeolocationOverride": () => ({}),
          "emulation.setNetworkConditions": () => ({}),
          "emulation.setScreenOrientationOverride": () => ({}),
          "emulation.setScreenSettingsOverride": () => ({}),
          "emulation.setTouchOverride": () => ({}),
          "emulation.setScriptingEnabled": () => ({}),
          ...handlers,
        }),
      );
      const use = new UseApplier(makeConnector(ws), browser, options, tmp());
      await use.context({ id: "u1", setRequestDefaults() {} } as never);
      return ws.sent.map((m) => m.method);
    };

    it("sends every declared option, but nothing that changes nothing or is null", async () => {
      resetWarnOnce();
      assert.deepEqual(
        await run("chrome", {
          locale: "nl-NL",
          timezone: "UTC",
          userAgent: null,
          geolocation: { latitude: 1, longitude: 2 },
          offline: false,
          orientation: "portrait",
          screen: { width: 800, height: 600 },
          hasTouch: true,
          javaScriptEnabled: false,
        }),
        [
          "emulation.setLocaleOverride",
          "emulation.setTimezoneOverride",
          "emulation.setGeolocationOverride",
          "emulation.setScreenOrientationOverride",
          "emulation.setScreenSettingsOverride",
          "emulation.setTouchOverride",
          "emulation.setScriptingEnabled",
        ],
      );
    });

    it("leaves Chrome-only touch and the Firefox profile setting JavaScript out on Firefox", async () => {
      resetWarnOnce();
      assert.deepEqual(
        await run("firefox", { hasTouch: true, javaScriptEnabled: false }),
        [],
      );
    });

    it("an option the browser does not support is skipped with a one-time warning, the rest is applied", async () => {
      resetWarnOnce();
      const lines: string[] = [];
      const warn = logger.warn.bind(logger);
      logger.warn = ((message: string) => (
        lines.push(message),
        logger
      )) as never;
      try {
        const options = { orientation: "portrait", offline: true };
        const failing = {
          "emulation.setScreenOrientationOverride": () =>
            Object.assign(new Error("nope"), { code: "unknown command" }),
        };
        assert.deepEqual(await run("firefox", options, failing), [
          "emulation.setNetworkConditions",
          "emulation.setScreenOrientationOverride",
        ]);
        await run("firefox", options, failing);
      } finally {
        logger.warn = warn;
      }
      assert.equal(
        lines.filter((l) => l.includes("use.orientation")).length,
        1,
      );
    });
  });

  it("reads a storage state file at once, so a wrong path fails before the test", () => {
    assert.throws(
      () => applier("chrome", { storageState: "missing.json" }),
      /use\(\): storageState file "missing\.json"/,
    );
  });
});
