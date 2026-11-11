import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { test } from "node:test";
import { runInLoadedContexts } from "../../script/preload.js";
import { ChannelArg } from "../../script/serialize.js";
import { TOOLBAR_SANDBOX } from "./protocol.js";
import { TOOLBAR_SOURCE } from "./source.js";
import {
  OPTIONS,
  HOOK,
  pause,
  waitFor,
  messagesOn,
  install,
  inSandbox,
  inPage,
  update,
  press,
  centreOf,
  clickAt,
  readyOn,
  hostCount,
  page,
  connector,
} from "../../testing/toolbar-browser.js";

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
    // Not setViewport(null): that is the window's own size, 780×437 in headless Chrome, which the later tests do not fit
    await page.applyDefaultViewport();
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
