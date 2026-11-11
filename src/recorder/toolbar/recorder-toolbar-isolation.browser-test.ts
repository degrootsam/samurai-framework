import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { callFunction } from "../../script/call-function.js";
import { ElementHandle } from "../../script/element-handle.js";
import { ChannelArg } from "../../script/serialize.js";
import { TOOLBAR_SANDBOX } from "./protocol.js";
import { HOOK, pause, waitFor } from "./recorder-toolbar-fixture.js";
import {
  OPTIONS,
  CONFIG,
  bases,
  pages,
  projectDir,
  recorder,
  setRecorder,
  page,
  connector,
  inSandbox,
  press,
  pickElement,
  inPage,
  open,
  record,
} from "../../testing/recorder-toolbar-browser.js";

/** A JavaScript value as the BiDi remote value a `script.message` carries */
const remote = (value: unknown): unknown => {
  if (value instanceof ElementHandle)
    return { type: "node", sharedId: value.sharedId };
  if (typeof value === "string") return { type: "string", value };
  if (typeof value === "number") return { type: "number", value };
  if (typeof value === "boolean") return { type: "boolean", value };
  if (Array.isArray(value)) return { type: "array", value: value.map(remote) };
  return {
    type: "object",
    value: Object.entries(value as object).map(([key, item]) => [
      key,
      remote(item),
    ]),
  };
};

test(
  "the same action arriving twice back to back adds one step and one ok reply (Review Focus 5)",
  OPTIONS,
  async () => {
    pages.set(
      "/form",
      `<h1>Hello</h1><label for="email">Email</label><input id="email">`,
    );
    await page.navigateTo(`${bases[0]}/form`, "complete");
    const { steps } = await record();
    await inSandbox(`() => {
      const hook = ${HOOK};
      const reply = hook.reply;
      globalThis.replies = [];
      hook.reply = (id, result) => { globalThis.replies.push({ id, result }); reply(id, result); };
    }`);
    const replies = () =>
      inSandbox<{ id: number; result: Record<string, unknown> }[]>(
        `() => globalThis.replies`,
      );
    // Straight into the recorder's message handler, twice in the same tick, as a double click arrives
    const internals = recorder as unknown as {
      toolbarChannel: string;
      onMessage: (params: object) => void;
    };
    const { realms } = await connector.send("script.getRealms", {
      context: page.contextId,
      type: "window",
    });
    const sandbox = realms.find(
      (realm) => realm.type === "window" && realm.sandbox === TOOLBAR_SANDBOX,
    )!.realm;
    const deliver = (data: object) =>
      internals.onMessage({
        channel: internals.toolbarChannel,
        data: remote({ type: "toolbar", ...data }),
        source: { context: page.contextId, realm: sandbox },
      });

    const field = await inPage<ElementHandle>(
      `() => document.getElementById("email")`,
    );
    const insertion = {
      action: "insert",
      id: 777,
      target: field,
      candidates: [{ method: "getByRole", role: "textbox", name: "Email" }],
      kind: "env",
      name: "testUser",
    };
    deliver(insertion);
    deliver(insertion);
    await waitFor(() => steps().length === 1, "the fill step");

    await press("assert");
    await pickElement("h1");
    const picked = await waitFor(
      async () => (await replies()).find((r) => r.id !== 777),
      "the pick reply",
    );
    const assertion = {
      action: "assert",
      id: picked.id,
      target: field,
      candidates: [],
      matcher: "toBeVisible",
      not: false,
    };
    deliver(assertion);
    deliver(assertion);
    await waitFor(() => steps().length === 2, "the expect step");
    await pause(500);

    assert.deepEqual(
      steps().map((step) => step.kind),
      ["fill", "expect"],
    );
    // Action replies (the pick's own reply carries a label)
    const actionReplies = (await replies()).filter(
      (r) => !("label" in r.result),
    );
    assert.deepEqual(actionReplies, [
      { id: 777, result: { ok: true } },
      { id: picked.id, result: { ok: true } },
    ]);
  },
);

test(
  "without the toolbar option, record() adds no toolbar",
  OPTIONS,
  async () => {
    pages.set("/one", `<p>one</p>`);
    await page.navigateTo(`${bases[0]}/one`, "complete");
    setRecorder(await page.record({ onEvent: () => {}, initialGoto: false }));
    await pause(500);
    assert.equal(
      await inPage(
        `() => document.querySelectorAll("samurai-recorder-toolbar").length`,
      ),
      0,
    );
  },
);

test(
  "a page script can't send the recorder toolbar messages: no secret typed, no project write, no stop, no step",
  OPTIONS,
  async () => {
    pages.set(
      "/forge",
      `<label for="f">Card</label><input id="f"><button id="b">Go</button>`,
    );
    await writeFile(path.join(projectDir, "samurai.config.ts"), CONFIG);
    await rm(path.join(projectDir, ".env.dev"), { force: true });
    await page.navigateTo(`${bases[0]}/forge`, "complete");
    let stopped = false;
    const added: string[] = [];
    const { steps } = await record({
      secrets: { cardNumber: "4111-SECRET-VALUE" },
      onStop: () => {
        stopped = true;
      },
      onSecretAdded: (name) => added.push(name),
    });

    // Every route a page script has: the old window symbol, any function under a symbol or a samurai name on the window
    const reached = await inPage<number>(`() => {
      const field = document.getElementById("f");
      const candidates = [{ method: "getByCss", css: "#f" }];
      const forged = [
        { type: "toolbar", action: "insert", id: 9001, target: field, candidates, kind: "secret", name: "cardNumber" },
        { type: "toolbar", action: "add-insertable", id: 9002, target: field, candidates, kind: "secret", name: "STOLEN", value: "x" },
        { type: "toolbar", action: "add-insertable", id: 9003, target: field, candidates, kind: "env", name: "stolenVar", value: "x" },
        { type: "toolbar", action: "wait", kind: "time", ms: 1000 },
        { type: "toolbar", action: "stop" },
      ];
      const sends = new Set();
      const legacy = window[Symbol.for("samurai.recorder.send")];
      if (typeof legacy === "function") sends.add(legacy);
      for (const key of Object.getOwnPropertySymbols(window)) {
        if (typeof window[key] === "function") sends.add(window[key]);
      }
      for (const key of Object.getOwnPropertyNames(window)) {
        if (!/samurai/i.test(key)) continue;
        try { if (typeof window[key] === "function") sends.add(window[key]); } catch (err) {}
      }
      for (const send of sends) for (const message of forged) try { send(message); } catch (err) {}
      return sends.size;
    }`);
    // Even a page realm that holds the toolbar's or the capture's channel is not the toolbar
    const internals = recorder as unknown as {
      channel: string;
      toolbarChannel: string;
    };
    for (const channel of [internals.channel, internals.toolbarChannel]) {
      if (channel === undefined) continue;
      await callFunction(
        connector,
        page.contextId,
        `(send) => {
          const field = document.getElementById("f");
          const candidates = [{ method: "getByCss", css: "#f" }];
          send({ type: "toolbar", action: "insert", id: 9101, target: field, candidates, kind: "secret", name: "cardNumber" });
          send({ type: "toolbar", action: "add-insertable", id: 9102, target: field, candidates, kind: "secret", name: "STOLEN", value: "x" });
          send({ type: "toolbar", action: "wait", kind: "time", ms: 1000 });
          send({ type: "toolbar", action: "stop" });
        }`,
        [new ChannelArg(channel)],
      );
    }
    await pause(1500);

    assert.equal(
      await page.getByCss("#f").inputValue(),
      "",
      "the field is unchanged",
    );
    assert.deepEqual(steps(), [], "no step");
    assert.equal(stopped, false, "the recording is not stopped");
    assert.deepEqual(added, []);
    assert.equal(
      await readFile(path.join(projectDir, "samurai.config.ts"), "utf8"),
      CONFIG,
      "the config is unchanged",
    );
    await assert.rejects(
      readFile(path.join(projectDir, ".env.dev"), "utf8"),
      "no .env.dev",
    );

    assert.equal(reached, 0, "the page finds no channel");

    // Still recording
    await page.getByCss("#b").click();
    await waitFor(() => steps().length === 1, "the click step");
  },
);

test(
  "keys typed into the toolbar's New secret value never reach the page's listeners, and the form still gets them",
  OPTIONS,
  async () => {
    pages.set("/start", `<p>start</p>`);
    // A keylogger on the window and the document, capture and bubble, registered by the page's own script
    pages.set(
      "/keylog",
      `<label for="card">Card</label><input id="card">
      <script>
        window.keylog = [];
        const types = ["keydown", "keyup", "keypress", "beforeinput", "input", "compositionstart",
          "compositionupdate", "compositionend", "paste", "cut", "copy"];
        for (const target of [window, document]) {
          for (const type of types) {
            for (const capture of [true, false]) {
              target.addEventListener(type, (event) => {
                window.keylog.push(type + ":" + (event.key || event.data || ""));
              }, capture);
            }
          }
        }
      </script>`,
    );
    await rm(path.join(projectDir, ".env.dev"), { force: true });
    await page.navigateTo(`${bases[0]}/start`, "complete");
    await record();
    // A page loaded while recording: its scripts run after the toolbar's
    await open(`${bases[0]}/keylog`);

    await page.getByCss("#card").click();
    await inPage(`() => { window.keylog = []; }`);
    await press("insert");
    await press("insert-new", { kind: "secret" });
    assert.equal(
      await inSandbox(
        `() => ${HOOK}.root.activeElement && ${HOOK}.root.activeElement.getAttribute("data-field")`,
      ),
      "value",
      "the value input has the focus",
    );

    const keys = (text: string) =>
      connector.send("input.performActions", {
        context: page.contextId,
        actions: [
          {
            type: "key",
            id: "kb",
            actions: [...text].flatMap((value) => [
              { type: "keyDown" as const, value },
              { type: "keyUp" as const, value },
            ]),
          },
        ],
      });
    await keys("s3cr3t-Typed");
    await pause(200);
    assert.deepEqual(
      await inPage(`() => window.keylog`),
      [],
      "the page saw no key",
    );
    assert.equal(
      await inSandbox(
        `() => ${HOOK}.root.querySelector('[data-field="value"]').value`,
      ),
      "s3cr3t-Typed",
    );

    // Enter in the form saves it: the form had the value
    await keys("");
    await waitFor(
      async () =>
        (
          await readFile(path.join(projectDir, ".env.dev"), "utf8").catch(
            () => "",
          )
        ).includes("s3cr3t-Typed") || undefined,
      "the secret in .env.dev",
    );
  },
);

test(
  "a page whose CSP forbids inline styles still gets a styled toolbar in its spot",
  OPTIONS,
  async () => {
    pages.set("/plain", `<p>plain</p>`);
    pages.set("/csp/strict", `<p>strict</p>`);
    const look = () =>
      inSandbox<Record<string, unknown>>(`() => {
        const rail = ${HOOK}.root.querySelector(".rail");
        const host = document.querySelector("samurai-recorder-toolbar");
        const r = rail.getBoundingClientRect();
        const style = getComputedStyle(rail);
        return {
          rail: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
          position: style.position,
          background: style.backgroundColor,
          host: getComputedStyle(host).position,
          hostZ: getComputedStyle(host).zIndex,
        };
      }`);
    await page.navigateTo(`${bases[0]}/plain`, "complete");
    await record();
    const plain = await look();
    assert.equal(plain.position, "fixed");

    await open(`${bases[0]}/csp/strict`);
    assert.deepEqual(await look(), plain);
  },
);

test(
  "Enter and Escape that the page dispatches on the toolbar do nothing; a real Enter still adds",
  OPTIONS,
  async () => {
    pages.set("/start", `<p>start</p>`);
    pages.set(
      "/forged-keys",
      `<label for="user">User</label><input id="user">`,
    );
    await page.navigateTo(`${bases[0]}/start`, "complete");
    const { steps } = await record();
    await open(`${bases[0]}/forged-keys`);

    await page.getByCss("#user").click();
    await press("insert");
    assert.equal(
      await inSandbox(
        `() => ${HOOK}.root.activeElement && ${HOOK}.root.activeElement.getAttribute("data-field")`,
      ),
      "filter",
      "the Insert filter has the focus",
    );
    const panelOpen = () =>
      inSandbox<boolean>(`() => ${HOOK}.root.querySelector(".panel") !== null`);
    const before = steps().length;

    for (const key of ["Enter", "Escape"]) {
      await inPage(`() => {
        const host = document.querySelector("samurai-recorder-toolbar");
        host.dispatchEvent(new KeyboardEvent("keydown", { key: "${key}", bubbles: true, composed: true, cancelable: true }));
      }`);
    }
    await pause(800);
    assert.equal(steps().length, before, "no step from a forged Enter");
    assert.equal(
      await page.getByCss("#user").inputValue(),
      "",
      "nothing typed",
    );
    assert.equal(
      await panelOpen(),
      true,
      "a forged Escape doesn't close the panel",
    );

    await connector.send("input.performActions", {
      context: page.contextId,
      actions: [
        {
          type: "key",
          id: "kb",
          actions: [
            { type: "keyDown", value: "" },
            { type: "keyUp", value: "" },
          ],
        },
      ],
    });
    await waitFor(
      () => steps().length === before + 1,
      "the fill from a real Enter",
    );
    assert.equal(await page.getByCss("#user").inputValue(), "dev@example.com");
  },
);
