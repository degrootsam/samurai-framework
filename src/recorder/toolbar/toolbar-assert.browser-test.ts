import assert from "node:assert/strict";
import { test } from "node:test";
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
  reply,
  centreOf,
  clickAt,
  readyOn,
  page,
  connector,
} from "../../testing/toolbar-browser.js";

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
      checkable: false,
      disableable: false,
      className: null,
      css: { name: "color", value: "rgb(0, 0, 0)" },
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
  "the Assert panel offers only the element matchers that fit; Has CSS re-reads the value for another property",
  OPTIONS,
  async () => {
    await page.navigateTo(
      `data:text/html,<input type="checkbox" id="c" class="tick"><p id="p" style="color:red;background-color:blue">text</p>`,
      "complete",
    );
    const channel = await install();
    await readyOn(channel);
    await update();
    const base = {
      ok: true,
      text: "",
      attributes: [{ name: "id", value: "c" }],
      first: { matcher: "toBeVisible" },
      counts: [],
    };
    const MATCHERS = [
      "toBeHidden",
      "toBeEnabled",
      "toBeChecked",
      "toHaveClass",
      "toHaveCSS",
    ];
    const disabled = () =>
      inSandbox<Record<string, boolean | null>>(
        `(matchers) => Object.fromEntries(matchers.map((m) => {
          const button = ${HOOK}.root.querySelector('[data-matcher="' + m + '"]');
          return [m, button ? button.disabled : null];
        }))`,
        MATCHERS,
      );
    const pickById = async (id: string, count: number) => {
      // Assert closes an open Assert panel; the second press starts picking
      await press("assert");
      if (!(await inSandbox(`() => ${HOOK}.picking()`))) await press("assert");
      await inSandbox(
        `(id) => { ${HOOK}.press("pick", { target: document.getElementById(id) }); }`,
        id,
      );
      return waitFor(() => messagesOn(channel, "pick")[count - 1], "pick");
    };

    const box = await pickById("c", 1);
    await reply(box.data.id as number, {
      ...base,
      label: "checkbox",
      checkable: true,
      disableable: true,
      className: "tick",
      css: { name: "color", value: "rgb(0, 0, 0)" },
    });
    assert.deepEqual(await disabled(), {
      toBeHidden: false,
      toBeEnabled: false,
      toBeChecked: false,
      toHaveClass: false,
      toHaveCSS: false,
    });
    await press("matcher", { matcher: "toHaveClass" });
    assert.equal(
      await inSandbox(
        `() => ${HOOK}.root.querySelector('input[data-field="expected"]').value`,
      ),
      "tick",
    );
    await press("matcher", { matcher: "toBeChecked" });
    assert.equal(
      await inSandbox(
        `() => ${HOOK}.root.querySelector('input[data-field="expected"]')`,
      ),
      null,
      "Checked takes no value",
    );

    const text = await pickById("p", 2);
    await reply(text.data.id as number, {
      ...base,
      label: "p",
      checkable: false,
      disableable: false,
      className: null,
      css: { name: "color", value: "rgb(255, 0, 0)" },
    });
    assert.deepEqual(await disabled(), {
      toBeHidden: false,
      toBeEnabled: true,
      toBeChecked: true,
      toHaveClass: true,
      toHaveCSS: false,
    });
    await press("matcher", { matcher: "toHaveCSS" });
    const fields = () =>
      inSandbox<{ name: string; expected: string }>(`() => ({
        name: ${HOOK}.root.querySelector('input[data-field="cssName"]').value,
        expected: ${HOOK}.root.querySelector('input[data-field="expected"]').value,
      })`);
    assert.deepEqual(await fields(), {
      name: "color",
      expected: "rgb(255, 0, 0)",
    });
    await inSandbox(`() => {
      const el = ${HOOK}.root.querySelector('input[data-field="cssName"]');
      el.value = "background-color";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }`);
    assert.deepEqual(await fields(), {
      name: "background-color",
      expected: "rgb(0, 0, 255)",
    });
    await press("assert-add");
    const [sent] = await waitFor(
      () =>
        messagesOn(channel, "assert").length
          ? messagesOn(channel, "assert")
          : undefined,
      "the assert",
    );
    assert.deepEqual(
      { ...sent!.data, target: undefined, candidates: undefined },
      {
        type: "toolbar",
        action: "assert",
        id: text.data.id,
        target: undefined,
        candidates: undefined,
        matcher: "toHaveCSS",
        cssName: "background-color",
        expected: "rgb(0, 0, 255)",
        not: false,
      },
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
