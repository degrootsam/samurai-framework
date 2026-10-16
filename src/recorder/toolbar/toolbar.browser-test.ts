import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { Browser } from "../../browser/browser.js";
import type Page from "../../browser/page.js";
import { callFunction } from "../../script/call-function.js";
import {
  addPreload,
  runInLoadedContexts,
  type PreloadHandle,
} from "../../script/preload.js";
import { ChannelArg, fromRemoteValue } from "../../script/serialize.js";
import type { BiDiConnector } from "../../transport/bidi-connection.js";
import { TOOLBAR_KEY, TOOLBAR_SANDBOX, type ToolbarState } from "./protocol.js";
import { TOOLBAR_SOURCE } from "./source.js";

let browser: Browser;
let page: Page;
let connector: BiDiConnector;
/** Every toolbar message, with the channel it came on */
const received: {
  channel: string;
  context: string | undefined;
  data: Record<string, unknown>;
}[] = [];
const handles: PreloadHandle[] = [];

before(async () => {
  ({ browser, page } = await Browser.launch("firefox", {
    port: 9242,
    headless: true,
  }));
  connector = (page as unknown as { biDiConnector: BiDiConnector })
    .biDiConnector;
  connector.onEvent("script.message", (params) => {
    received.push({
      channel: params.channel,
      context: params.source.context,
      data: fromRemoteValue(
        params.data as Parameters<typeof fromRemoteValue>[0],
      ) as Record<string, unknown>,
    });
  });
  await connector.subscribe(["script.message"]);
});

afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.dispose();
});

after(async () => {
  await browser?.close();
});

const OPTIONS = { timeout: 30000 };
const HOOK = `globalThis[Symbol.for("${TOOLBAR_KEY}")]`;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const STATE: ToolbarState = {
  status: "recording",
  collapsed: false,
  position: null,
  steps: 0,
  environment: "dev",
  canAddVariables: true,
  variables: [{ name: "testUser", value: "dev@example.com" }],
  secrets: [
    { name: "ADMIN_PASSWORD", set: true },
    { name: "API_TOKEN", set: false },
  ],
  secretsIgnored: true,
  resumeQuestion: false,
  nextScreenshot: "screenshot-1",
  warnings: [],
};

async function waitFor<T>(
  probe: () => T | undefined | Promise<T | undefined>,
  what: string,
  ms = 5000,
): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await probe();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await pause(50);
  }
}

const messagesOn = (channel: string, action?: string) =>
  received.filter(
    (m) =>
      m.channel === channel &&
      (action === undefined || m.data.action === action),
  );

async function install(): Promise<string> {
  const channel = `toolbar-test-${randomUUID()}`;
  handles.push(
    await addPreload(connector, {
      source: TOOLBAR_SOURCE,
      sandbox: TOOLBAR_SANDBOX,
      contexts: [page.contextId],
      arguments: [new ChannelArg(channel)],
    }),
  );
  return channel;
}

const inSandbox = <T>(fn: string, ...args: unknown[]) =>
  callFunction<T>(connector, page.contextId, fn, args, {
    sandbox: TOOLBAR_SANDBOX,
  });
const inPage = <T>(fn: string) =>
  callFunction<T>(connector, page.contextId, fn);
const update = (state: Partial<ToolbarState> = {}) =>
  inSandbox(`(state) => { ${HOOK}.update(state); }`, { ...STATE, ...state });
const press = (action: string, detail?: object) =>
  inSandbox(
    `(action, detail) => { ${HOOK}.press(action, detail); }`,
    action,
    detail,
  );
const reply = (id: number, result: object) =>
  inSandbox(`(id, result) => { ${HOOK}.reply(id, result); }`, id, result);

/** The centre of the first toolbar control matching `selector`, in viewport pixels */
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

/** Trusted clicks at the point, `count` times in quick succession */
async function clickAt({ x, y }: { x: number; y: number }, count = 1) {
  const click = [
    { type: "pointerDown", button: 0 },
    { type: "pointerUp", button: 0 },
  ] as const;
  await connector.send("input.performActions", {
    context: page.contextId,
    actions: [
      {
        type: "pointer",
        id: "mouse",
        actions: [
          { type: "pointerMove", x, y },
          ...Array.from({ length: count }, () => click).flat(),
        ],
      },
    ],
  });
}

async function readyOn(channel: string, count = 1) {
  await waitFor(
    () => messagesOn(channel, "ready").length >= count,
    `ready #${count} on ${channel}`,
  );
}

const hostCount = () =>
  inPage<number>(
    `() => document.querySelectorAll("samurai-recorder-toolbar").length`,
  );

test(
  "draws in a closed shadow root and says it is ready, once per document",
  OPTIONS,
  async () => {
    await page.navigateTo("data:text/html,<p>one</p>", "complete");
    const channel = await install();
    await readyOn(channel);
    assert.equal(await hostCount(), 1);
    assert.equal(
      await inPage(
        `() => document.querySelector("samurai-recorder-toolbar").shadowRoot`,
      ),
      null,
      "the page cannot reach into the toolbar",
    );
    assert.equal(
      await inPage(
        `() => document.querySelector("samurai-recorder-toolbar").parentNode === document.documentElement`,
      ),
      true,
    );

    // A new document gets its own toolbar from the preload registration
    await page.navigateTo("data:text/html,<p>two</p>", "complete");
    await readyOn(channel, 2);
    assert.equal(await hostCount(), 1);

    // A second run in the same document keeps the one host and reports on the new channel
    const second = `toolbar-test-${randomUUID()}`;
    await runInLoadedContexts(connector, {
      source: TOOLBAR_SOURCE,
      sandbox: TOOLBAR_SANDBOX,
      contexts: [page.contextId],
      arguments: [new ChannelArg(second)],
    });
    await readyOn(second);
    assert.equal(await hostCount(), 1);
    await press("pause");
    await waitFor(
      () => messagesOn(second, "pause").length === 1,
      "pause on the new channel",
    );
    assert.equal(messagesOn(channel, "pause").length, 0);
  },
);

test("stays out of iframes", OPTIONS, async () => {
  await page.navigateTo(
    `data:text/html,<iframe srcdoc="<p>inner</p>"></iframe>`,
    "complete",
  );
  const channel = await install();
  await readyOn(channel);
  await page.navigateTo(
    `data:text/html,<iframe srcdoc="<p>inner again</p>"></iframe>`,
    "complete",
  );
  await readyOn(channel, 2);
  await pause(300);
  // Firefox may pass through a transient about:blank in the top context, which reports too
  assert.deepEqual(
    [...new Set(messagesOn(channel, "ready").map((m) => m.context))],
    [page.contextId],
    "only top-level documents report",
  );
  assert.equal(
    await inPage(
      `() => document.querySelector("iframe").contentDocument.querySelectorAll("samurai-recorder-toolbar").length`,
    ),
    0,
  );
});

test(
  "works on a page that patches the DOM globals (Review Focus 1)",
  OPTIONS,
  async () => {
    const patch = `Element.prototype.attachShadow = () => { throw new Error("nope"); };
    EventTarget.prototype.addEventListener = () => {};
    JSON.stringify = () => "x";`;
    await page.navigateTo(
      `data:text/html,<p>patched</p><script>${encodeURIComponent(patch)}</script>`,
      "complete",
    );
    assert.equal(
      await inPage(`() => JSON.stringify({})`),
      "x",
      "the page did patch its globals",
    );

    // The immediate run, in a document whose globals are already patched
    const channel = await install();
    await readyOn(channel);
    await update();
    await clickAt(await centreOf(`[data-action="pause"]`));
    await waitFor(() => messagesOn(channel, "pause").length === 1, "pause");
    assert.deepEqual(messagesOn(channel, "pause")[0]!.data, {
      type: "toolbar",
      action: "pause",
    });
  },
);

test(
  "while paused, the tools are disabled and Resume is offered",
  OPTIONS,
  async () => {
    await page.navigateTo("data:text/html,<p>paused</p>", "complete");
    const channel = await install();
    await readyOn(channel);
    await update({ status: "paused" });
    const controls = await inSandbox<Record<string, boolean>>(
      `() => {
      const root = ${HOOK}.root;
      const out = {};
      for (const action of ["assert", "insert", "wait", "screenshot", "resume", "stop"]) {
        const el = root.querySelector('[data-action="' + action + '"]');
        out[action] = el ? el.disabled : "missing";
      }
      out.note = root.textContent.includes("Nothing you do now is recorded.");
      out.pause = Boolean(root.querySelector('[data-action="pause"]'));
      return out;
    }`,
    );
    assert.deepEqual(controls, {
      assert: true,
      insert: true,
      wait: true,
      screenshot: true,
      resume: false,
      stop: false,
      note: true,
      pause: false,
    });
    await press("wait");
    assert.equal(
      await inSandbox(`() => ${HOOK}.root.querySelector(".panel") === null`),
      true,
      "a disabled tool opens nothing",
    );
    await clickAt(await centreOf(`[data-action="resume"]`));
    await waitFor(() => messagesOn(channel, "resume").length === 1, "resume");
  },
);

test(
  "a double click on Add sends one wait (Review Focus 5)",
  OPTIONS,
  async () => {
    await page.navigateTo("data:text/html,<p>wait</p>", "complete");
    const channel = await install();
    await readyOn(channel);
    await update();
    await clickAt(await centreOf(`[data-action="wait"]`));
    await waitFor(
      () =>
        inSandbox<boolean>(
          `() => ${HOOK}.root.querySelector(".panel") !== null`,
        ),
      "the Wait panel",
    );
    await clickAt(await centreOf(`[data-action="wait-add"]`), 2);
    await pause(400);
    assert.deepEqual(
      messagesOn(channel, "wait").map((m) => m.data),
      [{ type: "toolbar", action: "wait", kind: "idle" }],
    );

    // The next update closes the panel; the time choice sends milliseconds
    await update({ steps: 1 });
    assert.equal(
      await inSandbox(`() => ${HOOK}.root.querySelector(".panel") === null`),
      true,
    );
    await press("wait");
    await inSandbox(`() => {
    const root = ${HOOK}.root;
    root.querySelector('input[data-field="waitKind"][value="time"]').click();
    const seconds = root.querySelector('input[data-field="seconds"]');
    seconds.value = "1.5";
    seconds.dispatchEvent(new Event("input", { bubbles: true }));
  }`);
    await press("wait-add");
    await waitFor(
      () => messagesOn(channel, "wait").length === 2,
      "the second wait",
    );
    assert.deepEqual(messagesOn(channel, "wait")[1]!.data, {
      type: "toolbar",
      action: "wait",
      kind: "time",
      ms: 1500,
    });
  },
);

test("the rail stays inside the window", OPTIONS, async () => {
  await page.navigateTo("data:text/html,<p>clamp</p>", "complete");
  const channel = await install();
  await readyOn(channel);
  const inside = () =>
    inSandbox<{ inside: boolean; rect: object }>(`() => {
      const r = ${HOOK}.root.querySelector(".rail, .chip").getBoundingClientRect();
      return {
        inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && r.width > 0,
        rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: innerWidth, h: innerHeight },
      };
    }`);

  await update();
  const spot = await inSandbox<{
    right: number;
    top: number;
    width: number;
  }>(`() => {
    const r = ${HOOK}.root.querySelector(".rail").getBoundingClientRect();
    return { right: r.right, top: r.top, width: document.documentElement.clientWidth };
  }`);
  assert.equal(spot.top, 12, "default spot: 12 px from the top");
  assert.equal(
    Math.round(spot.width - spot.right),
    12,
    "default spot: 12 px from the right",
  );

  await update({ position: { x: 5000, y: 5000 } });
  assert.ok((await inside()).inside, JSON.stringify(await inside()));

  await page.setViewport({ width: 600, height: 400 });
  try {
    await waitFor(
      async () => (await inside()).inside,
      "the rail inside a 600×400 window",
    );
    await update({ position: { x: 5000, y: 5000 }, collapsed: true });
    assert.ok((await inside()).inside, "the chip too");
    assert.equal(
      await inSandbox(
        `() => ${HOOK}.root.querySelector(".chip").textContent.includes("Rec · 0 steps")`,
      ),
      true,
    );
  } finally {
    await page.setViewport(null);
  }
});

test(
  "dragging the grip moves the rail and reports where it was dropped",
  OPTIONS,
  async () => {
    await page.navigateTo("data:text/html,<p>drag</p>", "complete");
    const channel = await install();
    await readyOn(channel);
    await update({ position: { x: 300, y: 200 } });
    const grip = await centreOf(`[data-grip]`);
    await connector.send("input.performActions", {
      context: page.contextId,
      actions: [
        {
          type: "pointer",
          id: "mouse",
          actions: [
            { type: "pointerMove", x: grip.x, y: grip.y },
            { type: "pointerDown", button: 0 },
            {
              type: "pointerMove",
              x: grip.x - 100,
              y: grip.y + 50,
              duration: 100,
            },
            { type: "pointerUp", button: 0 },
          ],
        },
      ],
    });
    const move = await waitFor(() => messagesOn(channel, "move")[0], "move");
    assert.deepEqual(move.data, {
      type: "toolbar",
      action: "move",
      x: 200,
      y: 250,
    });
    // The dropped spot holds until the controller echoes it
    await update({ position: { x: 200, y: 250 } });
    const left = await inSandbox<number>(
      `() => ${HOOK}.root.querySelector(".rail").getBoundingClientRect().left`,
    );
    assert.equal(left, 200);
  },
);

test(
  "Assert picks an element without the page seeing the click, and adds from the reply",
  OPTIONS,
  async () => {
    await page.navigateTo(
      `data:text/html,<h1 id="title" onclick="this.dataset.hit=1">Sign in</h1>`,
      "complete",
    );
    const channel = await install();
    await readyOn(channel);
    await update();
    await clickAt(await centreOf(`[data-action="assert"]`));
    assert.equal(
      await inSandbox(
        `() => ${HOOK}.root.textContent.includes("Click an element · Esc cancels")`,
      ),
      true,
    );
    const title = await inPage<{ x: number; y: number }>(`() => {
    const r = document.getElementById("title").getBoundingClientRect();
    return { x: Math.round(r.x + 20), y: Math.round(r.y + r.height / 2) };
  }`);
    await clickAt(title);
    const pick = await waitFor(() => messagesOn(channel, "pick")[0], "pick");
    assert.equal(
      await inPage(`() => document.getElementById("title").dataset.hit`),
      undefined,
      "the click never reached the page",
    );
    assert.deepEqual((pick.data.candidates as object[])[0], {
      method: "getByRole",
      role: "heading",
      name: "Sign in",
    });
    assert.equal(
      typeof (pick.data.target as { sharedId?: string }).sharedId,
      "string",
    );

    await reply(pick.data.id as number, {
      ok: true,
      label: `heading "Sign in"`,
      text: "Sign in",
      attributes: [{ name: "id", value: "title" }],
      first: { matcher: "toHaveText", expected: "Sign in" },
      counts: [],
    });
    const panel = await inSandbox<{
      text: string;
      value: string;
      hasValue: boolean;
      count: boolean;
    }>(`() => {
    const root = ${HOOK}.root;
    return {
      text: root.querySelector(".panel").textContent,
      value: root.querySelector('input[data-field="expected"]').value,
      hasValue: root.querySelector('[data-matcher="toHaveValue"]').disabled,
      count: root.querySelector('[data-matcher="toHaveCount"]').disabled,
    };
  }`);
    assert.match(panel.text, /heading "Sign in"/);
    assert.equal(panel.value, "Sign in");
    assert.equal(panel.hasValue, true, "no value to assert on a heading");
    assert.equal(panel.count, true, "nothing to count");

    await press("not");
    await press("assert-add");
    await press("assert-add");
    await pause(200);
    const asserts = messagesOn(channel, "assert");
    assert.equal(asserts.length, 1);
    assert.deepEqual(
      { ...asserts[0]!.data, target: undefined, candidates: undefined },
      {
        type: "toolbar",
        action: "assert",
        id: pick.data.id,
        target: undefined,
        candidates: undefined,
        matcher: "toHaveText",
        expected: "Sign in",
        not: true,
      },
    );
    await reply(pick.data.id as number, { ok: true });
    assert.equal(
      await inSandbox(`() => ${HOOK}.root.querySelector(".panel") === null`),
      true,
    );
  },
);

test(
  "Escape cancels picking without reaching the page; an unidentifiable element offers no Add",
  OPTIONS,
  async () => {
    await page.navigateTo(
      `data:text/html,<p id="p">text</p><script>window.keys = []; document.addEventListener("keydown", (e) => keys.push(e.key), true);</script>`,
      "complete",
    );
    const channel = await install();
    await readyOn(channel);
    await update();
    await press("assert");
    await connector.send("input.performActions", {
      context: page.contextId,
      actions: [
        {
          type: "key",
          id: "kb",
          actions: [
            { type: "keyDown", value: "" },
            { type: "keyUp", value: "" },
          ],
        },
      ],
    });
    await waitFor(
      () =>
        inSandbox<boolean>(
          `() => !${HOOK}.root.textContent.includes("Click an element")`,
        ),
      "picking to end",
    );
    assert.deepEqual(
      await inPage(`() => window.keys`),
      [],
      "Escape is the toolbar's",
    );

    await press("assert");
    await inSandbox(
      `() => { ${HOOK}.press("pick", { target: document.getElementById("p") }); }`,
    );
    const pick = await waitFor(() => messagesOn(channel, "pick")[0], "pick");
    await reply(pick.data.id as number, {
      ok: false,
      error: "This element can't be identified uniquely",
    });
    const shown = await inSandbox<{ text: string; add: boolean }>(`() => ({
    text: ${HOOK}.root.querySelector(".panel").textContent,
    add: Boolean(${HOOK}.root.querySelector('[data-action="assert-add"]')),
  })`);
    assert.match(shown.text, /This element can't be identified uniquely/);
    assert.equal(shown.add, false);
  },
);

test(
  "Insert types into the field that had focus, and adds a variable from the filter",
  OPTIONS,
  async () => {
    await page.navigateTo(
      `data:text/html,<label for="e">Email</label><input id="e"><button id="b">Go</button>`,
      "complete",
    );
    const channel = await install();
    await readyOn(channel);
    await update();

    await press("insert");
    assert.match(
      await inSandbox<string>(
        `() => ${HOOK}.root.querySelector(".panel").textContent`,
      ),
      /Click into a field first/,
    );
    await press("insert");

    await page.getByLabel("Email").click();
    await press("insert");
    const list = await inSandbox<string>(
      `() => ${HOOK}.root.querySelector(".panel").textContent`,
    );
    assert.match(list, /Insert into "Email"/);
    assert.match(list, /Environment: dev/);
    assert.match(list, /testUser.*dev@example\.com/);
    assert.match(list, /ADMIN_PASSWORD••••••/);
    assert.match(list, /API_TOKENnot set/);
    assert.ok(!list.includes("hunter"), "no secret value is in the page");

    await press("insert-item", { kind: "env", name: "testUser" });
    const insert = await waitFor(
      () => messagesOn(channel, "insert")[0],
      "insert",
    );
    assert.equal(insert.data.kind, "env");
    assert.equal(insert.data.name, "testUser");
    assert.deepEqual((insert.data.candidates as object[])[0], {
      method: "getByRole",
      role: "textbox",
      name: "Email",
    });
    await reply(insert.data.id as number, { ok: true });
    assert.equal(
      await inSandbox(`() => ${HOOK}.root.querySelector(".panel") === null`),
      true,
    );

    // Nothing matches the filter: the add actions carry it
    await press("insert");
    await inSandbox(`() => {
    const filter = ${HOOK}.root.querySelector('input[data-field="filter"]');
    filter.value = "adminUser";
    filter.dispatchEvent(new Event("input", { bubbles: true }));
  }`);
    const empty = await inSandbox<string>(
      `() => ${HOOK}.root.querySelector(".panel").textContent`,
    );
    assert.match(empty, /\+ Add variable "adminUser"/);
    assert.match(empty, /\+ Add secret "ADMIN_USER"/);

    await press("insert-new", { kind: "env" });
    await inSandbox(`() => {
    const value = ${HOOK}.root.querySelector('input[data-field="value"]');
    value.value = "admin@example.com";
    value.dispatchEvent(new Event("input", { bubbles: true }));
  }`);
    await press("new-save");
    const added = await waitFor(
      () => messagesOn(channel, "add-insertable")[0],
      "add-insertable",
    );
    assert.deepEqual(
      { kind: added.data.kind, name: added.data.name, value: added.data.value },
      { kind: "env", name: "adminUser", value: "admin@example.com" },
    );
    await reply(added.data.id as number, {
      ok: false,
      error: "adminUser already exists",
      field: "name",
    });
    assert.match(
      await inSandbox<string>(
        `() => ${HOOK}.root.querySelector(".field-error").textContent`,
      ),
      /adminUser already exists/,
    );

    // A secret that is not set opens the New secret form; without environments, no variable can be saved
    await press("new-cancel");
    await update({ canAddVariables: false, secretsIgnored: false });
    await press("insert-item", { kind: "secret", name: "API_TOKEN" });
    const form = await inSandbox<{
      text: string;
      name: string;
      type: string;
    }>(`() => ({
    text: ${HOOK}.root.querySelector(".panel").textContent,
    name: ${HOOK}.root.querySelector('input[data-field="name"]').value,
    type: ${HOOK}.root.querySelector('input[data-field="value"]').type,
  })`);
    assert.equal(form.name, "API_TOKEN");
    assert.equal(form.type, "password");
    assert.match(
      form.text,
      /Add \.env\.dev to \.gitignore before committing\./,
    );
    await press("new-kind", { kind: "env" });
    const variable = await inSandbox<{ text: string; save: boolean }>(`() => ({
    text: ${HOOK}.root.querySelector(".panel").textContent,
    save: Boolean(${HOOK}.root.querySelector('[data-action="new-save"]')),
  })`);
    assert.match(variable.text, /This recording has no environment/);
    assert.equal(variable.save, false);
  },
);

test(
  "Screenshot sends its name and size; the resume question and the toast show",
  OPTIONS,
  async () => {
    await page.navigateTo("data:text/html,<p>shot</p>", "complete");
    const channel = await install();
    await readyOn(channel);
    await update({ nextScreenshot: "screenshot-3" });
    await press("screenshot");
    assert.equal(
      await inSandbox(
        `() => ${HOOK}.root.querySelector('input[data-field="shotName"]').value`,
      ),
      "screenshot-3",
    );
    await inSandbox(
      `() => ${HOOK}.root.querySelector('input[data-field="fullPage"][value="true"]').click()`,
    );
    await press("screenshot-add");
    const shot = await waitFor(
      () => messagesOn(channel, "screenshot")[0],
      "screenshot",
    );
    assert.deepEqual(shot.data, {
      type: "toolbar",
      action: "screenshot",
      name: "screenshot-3",
      fullPage: true,
    });

    await update({
      resumeQuestion: true,
      toast: { id: 1, text: "Screenshot step added" },
    });
    const text = await inSandbox<string>(`() => ${HOOK}.root.textContent`);
    assert.match(text, /Add a step that opens this page\?/);
    assert.match(text, /Screenshot step added/);
    await press("resume-yes");
    const goto = await waitFor(
      () => messagesOn(channel, "resume-goto")[0],
      "resume-goto",
    );
    assert.deepEqual(goto.data, {
      type: "toolbar",
      action: "resume-goto",
      add: true,
    });

    await press("collapse");
    const collapse = await waitFor(
      () => messagesOn(channel, "collapse")[0],
      "collapse",
    );
    assert.deepEqual(collapse.data, {
      type: "toolbar",
      action: "collapse",
      collapsed: true,
    });
    await press("stop");
    await waitFor(() => messagesOn(channel, "stop")[0], "stop");
  },
);

test("shows the saving line and warnings with Dismiss", OPTIONS, async () => {
  const channel = await install();
  await update({
    saving: "avatar.png",
    warnings: [{ id: 7, text: "big.mov is 300 MB." }],
  });
  const view = await inSandbox<{
    saving: string | null;
    warning: string | null;
  }>(
    `() => {
      const root = ${HOOK}.root;
      const saving = root.querySelector(".saving");
      const warning = root.querySelector('[data-warning="7"]');
      return { saving: saving && saving.textContent, warning: warning && warning.textContent };
    }`,
  );
  assert.equal(view.saving, "Saving avatar.png…");
  assert.match(view.warning ?? "", /big\.mov is 300 MB\./);
  await clickAt(await centreOf('[data-warning="7"] .dismiss'));
  const message = await waitFor(
    () => messagesOn(channel, "dismiss")[0],
    "dismiss",
  );
  assert.equal(message.data.id, 7);
});
