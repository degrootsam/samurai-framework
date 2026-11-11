import assert from "node:assert/strict";
import { test } from "node:test";
import {
  OPTIONS,
  HOOK,
  waitFor,
  messagesOn,
  install,
  inSandbox,
  update,
  press,
  reply,
  centreOf,
  clickAt,
  readyOn,
  page,
} from "../../testing/toolbar-browser.js";

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

test(
  "keeps a warning's node across renders, so it isn't announced again",
  OPTIONS,
  async () => {
    await install();
    await update({ warnings: [{ id: 7, text: "first" }] });
    await inSandbox(
      `() => { ${HOOK}.root.querySelector('[data-warning="7"]').__kept = true; }`,
    );
    await update({
      saving: "a.png",
      warnings: [
        { id: 7, text: "first" },
        { id: 8, text: "second" },
      ],
    });
    const view = await inSandbox<{
      kept: boolean;
      second: boolean;
      saving: string | null;
    }>(
      `() => {
      const root = ${HOOK}.root;
      const first = root.querySelector('[data-warning="7"]');
      const saving = root.querySelector(".saving");
      return { kept: first.__kept === true, second: !!root.querySelector('[data-warning="8"]'), saving: saving && saving.textContent };
    }`,
    );
    assert.deepEqual(view, {
      kept: true,
      second: true,
      saving: "Saving a.png…",
    });
    await update({ saving: undefined, warnings: [{ id: 8, text: "second" }] });
    const after = await inSandbox<{ first: boolean; saving: boolean }>(
      `() => {
      const root = ${HOOK}.root;
      return { first: !!root.querySelector('[data-warning="7"]'), saving: !!root.querySelector(".saving") };
    }`,
    );
    assert.deepEqual(after, { first: false, saving: false });
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
