import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { type Step } from "../../steps/model.js";
import { HOOK, pause, waitFor } from "./recorder-toolbar-fixture.js";
import {
  OPTIONS,
  CONFIG,
  bases,
  pages,
  projectDir,
  page,
  inSandbox,
  press,
  viewState,
  typeInto,
  inPage,
  open,
  record,
  pointer,
  centreOf,
} from "../../testing/recorder-toolbar-browser.js";

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
    // The status is reported as the state is pushed to the page, which lands a moment later
    await waitFor(
      async () => (await viewState())?.status === "paused",
      "the toolbar showing paused",
    );

    await page.getByCss("#b").click();
    assert.equal(
      await page.getByCss("#b").getAttribute("data-hit"),
      "1",
      "the page got the click",
    );
    await open(`${bases[1]}/two`);
    await waitFor(
      async () => (await viewState())?.status === "paused",
      "still paused on the other page",
    );
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
    await waitFor(
      async () => (await viewState())?.resumeQuestion === false,
      "the resume question gone",
    );

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
