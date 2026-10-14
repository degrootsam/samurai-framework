import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, before, test } from "node:test";
import { Browser } from "../../browser/browser.js";
import type Page from "../../browser/page.js";
import { callFunction } from "../../script/call-function.js";
import { ElementHandle } from "../../script/element-handle.js";
import { ChannelArg } from "../../script/serialize.js";
import { parseSpec } from "../../steps/parse.js";
import type { Step } from "../../steps/model.js";
import type { BiDiConnector } from "../../transport/bidi-connection.js";
import { applyRecorderEvent } from "../apply.js";
import type { Recorder, RecorderEvent, ToolbarOptions } from "../recorder.js";
import { TOOLBAR_KEY, TOOLBAR_SANDBOX, type ToolbarState } from "./protocol.js";

let browser: Browser;
let page: Page;
let connector: BiDiConnector;
/** Two servers, so a navigation between them changes origin */
const servers: Server[] = [];
const bases: string[] = [];
const sockets = new Set<Socket>();
/** Path → HTML, served by both servers */
const pages = new Map<string, string>();
let projectDir: string;
let recorder: Recorder | undefined;

before(async () => {
  for (let i = 0; i < 2; i++) {
    const server = createServer((req, res) => {
      const html = pages.get(req.url ?? "/") ?? "<p>not found</p>";
      res
        .setHeader("content-type", "text/html")
        .end(`<!doctype html><html><body>${html}</body></html>`);
    });
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    servers.push(server);
    bases.push(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  }
  projectDir = await mkdtemp(path.join(tmpdir(), "samurai-toolbar-"));
  ({ browser, page } = await Browser.launch("firefox", {
    port: 9243,
    headless: true,
  }));
  connector = (page as unknown as { biDiConnector: BiDiConnector })
    .biDiConnector;
});

afterEach(async () => {
  await recorder?.stop();
  recorder = undefined;
});

after(async () => {
  try {
    await browser?.close().catch(() => {});
  } finally {
    sockets.forEach((socket) => socket.destroy());
    for (const server of servers)
      await new Promise((resolve) => server.close(resolve));
    await rm(projectDir, { recursive: true, force: true });
  }
});

const OPTIONS = { timeout: 60000 };
const HOOK = `globalThis[Symbol.for("${TOOLBAR_KEY}")]`;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const CONFIG = `import { defineConfig } from "@itmetsam/samurai-framework";

export default defineConfig({
  environments: {
    dev: {
      variables: {
        testUser: "dev@example.com",
      },
    },
  },
});
`;

async function waitFor<T>(
  probe: () => T | undefined | Promise<T | undefined>,
  what: string,
  ms = 8000,
): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await probe();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await pause(50);
  }
}

const inSandbox = <T>(fn: string, ...args: unknown[]) =>
  callFunction<T>(connector, page.contextId, fn, args as never[], {
    sandbox: TOOLBAR_SANDBOX,
  });
const inPage = <T>(fn: string) =>
  callFunction<T>(connector, page.contextId, fn);
const press = (action: string, detail?: object) =>
  inSandbox(
    `(action, detail) => { ${HOOK}.press(action, detail); }`,
    action,
    detail,
  );
/** Runs the picker's click on the first element matching `selector` */
const pickElement = (selector: string) =>
  inSandbox(
    `(selector) => { ${HOOK}.press("pick", { target: document.querySelector(selector) }); }`,
    selector,
  );
const viewState = () =>
  inSandbox<ToolbarState | null>(`() => ${HOOK} ? ${HOOK}.state() : null`);
/** Sets a toolbar form input as typing into it would */
const typeInto = (field: string, value: string) =>
  inSandbox(
    `(field, value) => {
      const el = ${HOOK}.root.querySelector('[data-field="' + field + '"]');
      if (!el) throw new Error("no field " + field);
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }`,
    field,
    value,
  );

/** Navigates and waits until the new document's toolbar has the recorder's state */
async function open(url: string) {
  await page.navigateTo(url, "complete");
  await waitFor(
    async () => (await viewState())?.environment === "dev",
    `the toolbar on ${url}`,
  );
}

async function record(toolbar: Partial<ToolbarOptions> = {}) {
  const events: RecorderEvent[] = [];
  const statuses: { state: string; toolbar: boolean }[] = [];
  recorder = await page.record({
    onEvent: (event) => events.push(event),
    initialGoto: false,
    toolbar: {
      environment: "dev",
      canAddVariables: true,
      variables: { testUser: "dev@example.com" },
      secrets: {},
      secretsIgnored: true,
      screenshots: 0,
      projectDir,
      onStatus: (status) => statuses.push(status),
      ...toolbar,
    },
  });
  await waitFor(
    async () => (await viewState())?.environment === "dev",
    "the toolbar's first state",
  );
  const steps = (): Step[] => {
    let source = `test("t", async ({ page }) => {\n});\n`;
    for (const event of events) source = applyRecorderEvent(source, 0, event);
    return parseSpec(source)[0]!.steps.map(({ step }) => step);
  };
  return { events, statuses, steps };
}

/** Trusted pointer actions at viewport points */
async function pointer(
  actions: (
    | { type: "pointerMove"; x: number; y: number }
    | { type: "pointerDown" | "pointerUp"; button: 0 }
  )[],
) {
  await connector.send("input.performActions", {
    context: page.contextId,
    actions: [{ type: "pointer", id: "mouse", actions }],
  });
}

const centreOf = (selector: string) =>
  inSandbox<{ x: number; y: number }>(
    `(selector) => {
      const el = ${HOOK}.root.querySelector(selector);
      if (!el) throw new Error("no " + selector);
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    }`,
    selector,
  );

test(
  "pause records nothing; resuming on another page asks and writes the goto",
  OPTIONS,
  async () => {
    pages.set(
      "/one",
      `<button id="b" onclick="this.dataset.hit = Number(this.dataset.hit || 0) + 1">Go</button>`,
    );
    pages.set("/two", `<p>two</p>`);
    await page.navigateTo(`${bases[0]}/one`, "complete");
    const { statuses, steps } = await record();

    // The one real click on the toolbar
    const { x, y } = await centreOf(`[data-action="pause"]`);
    await pointer([
      { type: "pointerMove", x, y },
      { type: "pointerDown", button: 0 },
      { type: "pointerUp", button: 0 },
    ]);
    await waitFor(
      () => statuses.some((s) => s.state === "paused"),
      "the paused status",
    );
    assert.equal((await viewState())?.status, "paused");

    await page.getByCss("#b").click();
    assert.equal(
      await page.getByCss("#b").getAttribute("data-hit"),
      "1",
      "the page got the click",
    );
    await open(`${bases[1]}/two`);
    assert.equal((await viewState())?.status, "paused", "still paused there");
    await pause(300);
    assert.deepEqual(steps(), [], "nothing recorded while paused");

    await press("resume");
    await waitFor(
      async () => (await viewState())?.resumeQuestion === true,
      "the resume question",
    );
    await press("resume-yes");
    await waitFor(() => steps().length === 1, "the goto step");
    assert.deepEqual(steps(), [{ kind: "goto", url: `${bases[1]}/two` }]);
    assert.equal((await viewState())?.resumeQuestion, false);

    // The pages' toolbars all said ready in time
    await pause(2300);
    assert.ok(
      statuses.every((s) => s.toolbar),
      JSON.stringify(statuses),
    );
  },
);

test(
  "the rail's spot and collapsed state survive navigation to another origin",
  OPTIONS,
  async () => {
    pages.set("/one", `<p>one</p>`);
    pages.set("/two", `<p>two</p>`);
    await page.navigateTo(`${bases[0]}/one`, "complete");
    await record();

    // Drag the rail by its grip
    const grip = await centreOf("[data-grip]");
    await pointer([
      { type: "pointerMove", x: grip.x, y: grip.y },
      { type: "pointerDown", button: 0 },
      { type: "pointerMove", x: 120, y: 140 },
      { type: "pointerMove", x: 100, y: 120 },
      { type: "pointerUp", button: 0 },
    ]);
    const moved = await waitFor(
      async () => (await viewState())?.position ?? undefined,
      "the moved position",
    );
    await press("collapse");
    await waitFor(
      async () => (await viewState())?.collapsed === true,
      "collapsed",
    );
    const before = await viewState();

    await open(`${bases[1]}/two`);
    const after = await viewState();
    assert.deepEqual({ ...after, steps: 0 }, { ...before, steps: 0 });
    assert.equal(after?.steps, 1, "the navigation is a goto step");
    assert.deepEqual(after?.position, moved);
    assert.equal(
      await inSandbox(`() => ${HOOK}.root.querySelector(".chip") !== null`),
      true,
      "drawn as the chip",
    );
  },
);

test(
  "insert types the variable's value into a controlled field and records one fill with the reference (Review Focus 3)",
  OPTIONS,
  async () => {
    // The page owns the value and replaces the field on every input, as a framework's re-render would
    pages.set(
      "/form",
      `<div id="host"></div>
      <script>
        let value = "";
        const render = () => {
          const old = document.getElementById("email");
          const input = document.createElement("input");
          input.id = "email";
          input.setAttribute("aria-label", "Email");
          input.value = value;
          input.addEventListener("input", (event) => { value = event.target.value; render(); });
          if (old) {
            old.replaceWith(input);
            input.focus();
            input.setSelectionRange(value.length, value.length);
          } else {
            document.getElementById("host").appendChild(input);
          }
        };
        render();
      </script>`,
    );
    await page.navigateTo(`${bases[0]}/form`, "complete");
    const { steps } = await record();

    await inPage(`() => document.getElementById("email").focus()`);
    await press("insert");
    await press("insert-item", { kind: "env", name: "testUser" });
    await waitFor(() => steps().length === 1, "the fill step");
    await pause(500);

    assert.equal(
      await inPage(`() => document.getElementById("email").value`),
      "dev@example.com",
    );
    assert.deepEqual(
      steps().map((step) => step.kind),
      ["fill"],
      "exactly one fill, no literal one",
    );
    const [fill] = steps() as [Extract<Step, { kind: "fill" }>];
    assert.deepEqual(fill.value, { kind: "env", name: "testUser" });
    assert.deepEqual(fill.locator.chain, [
      { method: "getByRole", role: "textbox", name: "Email" },
    ]);
  },
);

test(
  "adding a variable from the panel writes the config, fills the field and records the reference",
  OPTIONS,
  async () => {
    await writeFile(path.join(projectDir, "samurai.config.ts"), CONFIG);
    pages.set("/admin", `<label for="user">User</label><input id="user">`);
    await page.navigateTo(`${bases[0]}/admin`, "complete");
    const { steps } = await record();

    await inPage(`() => document.getElementById("user").focus()`);
    await press("insert");
    await press("insert-new", { kind: "env" });
    await typeInto("name", "adminUser");
    await typeInto("value", "admin@example.com");
    await press("new-save");
    await waitFor(() => steps().length === 1, "the fill step");

    const config = await readFile(
      path.join(projectDir, "samurai.config.ts"),
      "utf8",
    );
    assert.match(config, /adminUser: "admin@example\.com"/);
    assert.equal(
      await inPage(`() => document.getElementById("user").value`),
      "admin@example.com",
    );
    const [fill] = steps() as [Extract<Step, { kind: "fill" }>];
    assert.deepEqual(fill.value, { kind: "env", name: "adminUser" });
    assert.ok(
      (await viewState())?.variables.some((v) => v.name === "adminUser"),
      "the panel lists it",
    );
  },
);

test(
  "the Assert pick is prefilled with the element's text and Count offers the list items",
  OPTIONS,
  async () => {
    pages.set(
      "/list",
      `<h1>Welcome back</h1><ul><li>One</li><li>Two</li><li>Three</li></ul>`,
    );
    await page.navigateTo(`${bases[0]}/list`, "complete");
    const { steps } = await record();
    // Keep every reply the recorder sends to the view
    await inSandbox(`() => {
      const hook = ${HOOK};
      const reply = hook.reply;
      globalThis.replies = [];
      hook.reply = (id, result) => { globalThis.replies.push(result); reply(id, result); };
    }`);
    const replies = () =>
      inSandbox<Record<string, unknown>[]>(`() => globalThis.replies`);

    await press("assert");
    await pickElement("h1");
    const [heading] = await waitFor(
      async () =>
        (await replies()).length === 1 ? await replies() : undefined,
      "the heading's pick reply",
    );
    assert.equal(heading!.ok, true);
    assert.equal(heading!.label, `heading "Welcome back"`);
    assert.equal(heading!.text, "Welcome back");
    assert.deepEqual(heading!.first, {
      matcher: "toHaveText",
      expected: "Welcome back",
    });
    await press("assert-add");
    await waitFor(() => steps().length === 1, "the expect step");

    await press("assert");
    await pickElement("li");
    const item = await waitFor(
      async () => (await replies())[2],
      "the list item's pick reply",
    );
    assert.deepEqual((item.counts as { label: string; count: number }[])[0], {
      label: "listitem",
      count: 3,
    });
    await press("matcher", { matcher: "toHaveCount" });
    await press("assert-add");
    await waitFor(() => steps().length === 2, "the count step");

    assert.deepEqual(
      steps().map((step) =>
        step.kind === "expect"
          ? { chain: step.locator.chain, expectation: step.expectation }
          : step,
      ),
      [
        {
          chain: [
            { method: "getByRole", role: "heading", name: "Welcome back" },
          ],
          expectation: { matcher: "toHaveText", expected: "Welcome back" },
        },
        {
          chain: [{ method: "getByRole", role: "listitem" }],
          expectation: { matcher: "toHaveCount", expected: 3 },
        },
      ],
    );
  },
);

test(
  "a navigation while picking leaves no step and no picker on the new page (Review Focus 2)",
  OPTIONS,
  async () => {
    pages.set("/one", `<h1>One</h1>`);
    pages.set("/two", `<h1>Two</h1>`);
    await page.navigateTo(`${bases[0]}/one`, "complete");
    const { steps } = await record();

    await press("assert");
    assert.equal(await inSandbox(`() => ${HOOK}.picking()`), true);
    await pickElement("h1");
    await open(`${bases[1]}/two`);
    await pause(500);

    assert.equal(await inSandbox(`() => ${HOOK}.picking()`), false);
    assert.equal(
      await inSandbox(`() => ${HOOK}.root.querySelector(".panel") === null`),
      true,
      "no panel either",
    );
    assert.equal(steps().filter((step) => step.kind === "expect").length, 0);
    // The new page's Assert starts from scratch
    await press("assert");
    await pickElement("h1");
    // Add is enabled once the pick's reply is in
    await waitFor(async () => {
      await press("assert-add");
      return steps().some((step) => step.kind === "expect");
    }, "the new page's expect");
  },
);

test(
  "Stop while picking ends the recording and leaves the page clickable",
  OPTIONS,
  async () => {
    pages.set(
      "/one",
      `<button id="b" onclick="this.dataset.hit = 1">Go</button>`,
    );
    await page.navigateTo(`${bases[0]}/one`, "complete");
    let stopped = false;
    await record({
      onStop: () => {
        stopped = true;
      },
    });

    await press("assert");
    assert.equal(await inSandbox(`() => ${HOOK}.picking()`), true);
    await press("stop");
    await waitFor(() => stopped, "onStop");
    // The app stops the recording; the window stays open
    await recorder!.stop();

    assert.equal(
      await inPage(
        `() => document.querySelectorAll("samurai-recorder-toolbar").length`,
      ),
      0,
      "the toolbar is gone",
    );
    assert.equal(await inSandbox(`() => ${HOOK} === undefined`), true);
    await page.getByCss("#b").click();
    assert.equal(
      await page.getByCss("#b").getAttribute("data-hit"),
      "1",
      "the page got the click",
    );
  },
);

test(
  "Stop from the app while picking leaves no click-swallowing listeners behind",
  OPTIONS,
  async () => {
    pages.set(
      "/one",
      `<button id="b" onclick="this.dataset.hit = 1">Go</button>`,
    );
    await page.navigateTo(`${bases[0]}/one`, "complete");
    await record();
    await press("assert");
    assert.equal(await inSandbox(`() => ${HOOK}.picking()`), true);
    await recorder!.stop();

    const box = await page.getByCss("#b").getBoundingClientRect();
    await pointer([
      {
        type: "pointerMove",
        x: Math.round(box.x + box.width / 2),
        y: Math.round(box.y + box.height / 2),
      },
      { type: "pointerDown", button: 0 },
      { type: "pointerUp", button: 0 },
    ]);
    assert.equal(
      await page.getByCss("#b").getAttribute("data-hit"),
      "1",
      "the page got the click",
    );
  },
);

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
    recorder = await page.record({ onEvent: () => {}, initialGoto: false });
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
