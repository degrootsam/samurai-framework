import assert from "node:assert/strict";
import { test } from "node:test";
import { autoReply, FakeWebSocket } from "../testing/fake-websocket.js";
import { BiDiConnector } from "../transport/bidi-connection.js";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { abandonLaunch, Browser, browserLaunchFlag, ensureBrowserProfile } from "./browser.js";

function fakeBrowser(handlers: Record<string, (params: any) => object | Error> = {}) {
  const ws = new FakeWebSocket();
  const connector = new BiDiConnector(ws as unknown as WebSocket);
  const stop = autoReply(ws, { "browsingContext.getTree": () => ({ contexts: [] }), ...handlers });
  const browser = new Browser({ browserProc: {} as never, biDiConnector: connector });
  return { ws, browser, stop };
}

test("newPage returns a page bound to the created context", async () => {
  const { ws, browser, stop } = fakeBrowser({
    "browsingContext.create": () => ({ context: "ctx-42", userContext: "default" }),
  });
  const page = await browser.newPage({ type: "tab" });
  assert.equal(page.contextId, "ctx-42");
  assert.deepEqual(
    ws.sent.find((m) => m.method === "browsingContext.create")!.params,
    { type: "tab" },
  );
  stop();
});

test("newPage passes background and userContext through", async () => {
  const { ws, browser, stop } = fakeBrowser({
    "browsingContext.create": () => ({ context: "c", userContext: "u1" }),
  });
  await browser.newPage({ type: "window", background: true, userContext: "u1" });
  assert.deepEqual(ws.sent[0]!.params, { type: "window", background: true, userContext: "u1" });
  stop();
});

test("newPage surfaces a failing create as a BiDiError", async () => {
  const { browser, stop } = fakeBrowser({
    "browsingContext.create": () => new Error("no window"),
  });
  await assert.rejects(browser.newPage({ type: "tab" }), { name: "BiDiError", code: "unknown error" });
  stop();
});

test("firefox starts on about:blank, not its privileged home page", () => {
  assert.deepEqual(browserLaunchFlag("firefox", { port: 9300, profileDir: "/tmp/profile", headless: true }), [
    "--no-sandbox",
    "--no-remote",
    "--headless",
    "--remote-debugging-port=9300",
    "--profile",
    "/tmp/profile",
    "about:blank",
  ]);
});

test("a failed launch stops the connection and the browser it started", () => {
  const calls: string[] = [];
  abandonLaunch({ kill: () => calls.push("browser") > 0 }, { kill: () => void calls.push("connector") });
  assert.deepEqual(calls, ["connector", "browser"]);
});

test("a launch that failed before connecting still stops the browser", () => {
  const calls: string[] = [];
  abandonLaunch({ kill: () => calls.push("browser") > 0 }, undefined);
  assert.deepEqual(calls, ["browser"]);
});

test("the firefox profile is written with a blank start page, and an outdated one is rewritten", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "samurai-profile-"));
  try {
    const userJs = path.join(dir, "firefox", "user.js");
    ensureBrowserProfile("firefox", userJs);
    const written = readFileSync(userJs, "utf8");
    assert.match(written, /user_pref\("browser\.startup\.page", 0\);/);
    assert.match(written, /user_pref\("browser\.startup\.homepage", "about:blank"\);/);
    assert.match(written, /user_pref\("browser\.newtabpage\.enabled", false\);/);

    writeFileSync(userJs, 'user_pref("devtools.chrome.enabled", true);');
    ensureBrowserProfile("firefox", userJs);
    assert.equal(readFileSync(userJs, "utf8"), written);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
