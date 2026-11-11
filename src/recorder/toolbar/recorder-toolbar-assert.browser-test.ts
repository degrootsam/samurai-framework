import assert from "node:assert/strict";
import { test } from "node:test";
import { expect } from "../../assert/expect.js";
import { locatorFromSpec } from "../../steps/build.js";
import { type Step } from "../../steps/model.js";
import { HOOK, pause, waitFor } from "./recorder-toolbar-fixture.js";
import {
  OPTIONS,
  bases,
  pages,
  recorder,
  page,
  inSandbox,
  press,
  pickElement,
  viewState,
  inPage,
  open,
  record,
  pointer,
} from "../../testing/recorder-toolbar-browser.js";

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
    // The state with the new step count closes the picker; pressing Assert before it lands would be undone by it
    await waitFor(
      async () => (await viewState())?.steps === 1,
      "the toolbar showing one step",
    );

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
  "Checked is offered for a checkbox only; Has CSS records the computed value and the step passes",
  OPTIONS,
  async () => {
    pages.set(
      "/styled",
      `<label><input type="checkbox" class="tick"> Agree</label><p style="color:red">Red text</p>`,
    );
    await page.navigateTo(`${bases[0]}/styled`, "complete");
    const { steps } = await record();
    const checkedDisabled = () =>
      inSandbox<boolean>(
        `() => ${HOOK}.root.querySelector('[data-matcher="toBeChecked"]').disabled`,
      );
    const panelReady = () =>
      waitFor(
        () =>
          inSandbox<boolean>(
            `() => Boolean(${HOOK}.root.querySelector('[data-matcher="toBeChecked"]'))`,
          ),
        "the Assert panel's matchers",
      );

    await press("assert");
    await pickElement("input");
    await panelReady();
    assert.equal(await checkedDisabled(), false, "a checkbox can be checked");
    await press("assert");
    await press("assert");
    await pickElement("p");
    await panelReady();
    assert.equal(await checkedDisabled(), true, "a paragraph cannot");

    await press("matcher", { matcher: "toHaveCSS" });
    assert.equal(
      await inSandbox(
        `() => ${HOOK}.root.querySelector('input[data-field="expected"]').value`,
      ),
      "rgb(255, 0, 0)",
      "the computed value, not the written one",
    );
    await press("assert-add");
    await waitFor(() => steps().length === 1, "the expect step");
    const [step] = steps() as [Extract<Step, { kind: "expect" }>];
    assert.deepEqual(step.expectation, {
      matcher: "toHaveCSS",
      name: "color",
      expected: "rgb(255, 0, 0)",
    });
    await expect(locatorFromSpec(page, step.locator)).toHaveCSS(
      step.expectation.name,
      step.expectation.expected as string,
      { timeout: 2000 },
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
    // A pick still being looked up as the page goes (the controller drops its reply) is covered by controller.test.ts;
    // Chrome never answers such a lookup and keeps later commands waiting, so it is not started here
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
