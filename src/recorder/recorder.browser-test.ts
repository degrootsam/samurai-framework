import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { Browser } from "../browser/browser.js";
import type Page from "../browser/page.js";
import { setContent } from "../testing/browser-fixture.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";
import { parseSpec } from "../steps/parse.js";
import { applyRecorderEvent } from "./apply.js";
import type { RecorderEvent } from "./recorder.js";

let browser: Browser;
let page: Page;

before(async () => {
  ({ browser, page } = await Browser.launch("firefox", {
    port: 9241,
    headless: true,
  }));
  await page.navigateTo("about:blank", "complete");
});

after(async () => {
  await browser?.close();
});

const OPTIONS = { timeout: 30000 };
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Alt+click at the centre of the element, as a person would */
async function altClick(selectorCss: string) {
  const { x, y, width, height } = await page
    .getByCss(selectorCss)
    .getBoundingClientRect();
  const { biDiConnector, contextId } = page as unknown as {
    biDiConnector: BiDiConnector;
    contextId: string;
  };
  const pause = { type: "pause", duration: 0 } as const;
  // One key source for both the key down and the key up, or Alt stays held for everything that follows
  await biDiConnector.send("input.performActions", {
    context: contextId,
    actions: [
      {
        type: "key",
        id: "kb",
        actions: [
          { type: "keyDown", value: "\uE00A" },
          pause,
          pause,
          { type: "keyUp", value: "\uE00A" },
        ],
      },
      {
        type: "pointer",
        id: "mouse",
        actions: [
          {
            type: "pointerMove",
            x: Math.round(x + width / 2),
            y: Math.round(y + height / 2),
          },
          { type: "pointerDown", button: 0 },
          { type: "pointerUp", button: 0 },
          pause,
        ],
      },
    ],
  });
}

test(
  "records a person's clicks, typing and Alt+click assertions as steps",
  OPTIONS,
  async () => {
    await setContent(
      page,
      `<h1 id="title" onclick="this.dataset.hit=1">Welcome</h1>
     <label for="n">Name</label><input id="n">
     <label>Secret <input type="password" name="pw"></label>
     <button id="clicked" onclick="document.title='clicked'">Save</button>`,
    );
    const events: RecorderEvent[] = [];
    const recorder = await page.record({
      onEvent: (event) => events.push(event),
      initialGoto: false,
    });

    await page.getByLabel("Name").fill("Sam");
    await page.getByLabel("Secret").fill("hunter2");
    await page.getByCss("#clicked").click();
    await altClick("#title");
    await pause(500);
    await recorder.stop();

    let source = `test("t", async ({ page }) => {\n});\n`;
    for (const event of events) source = applyRecorderEvent(source, 0, event);
    const steps = parseSpec(source)[0]!.steps.map(({ step }) => step);

    assert.deepEqual(
      steps.map((step) => step.kind),
      ["fill", "fill", "click", "expect"],
      source,
    );
    const [name, secret, save, title] = steps as [
      Extract<(typeof steps)[number], { kind: "fill" }>,
      Extract<(typeof steps)[number], { kind: "fill" }>,
      Extract<(typeof steps)[number], { kind: "click" }>,
      Extract<(typeof steps)[number], { kind: "expect" }>,
    ];
    assert.deepEqual(name.value, { kind: "literal", value: "Sam" });
    assert.deepEqual(name.locator.chain, [
      { method: "getByRole", role: "textbox", name: "Name" },
    ]);
    assert.ok(
      name.locator.fallbacks.length > 0,
      "keeps the next-best locators as fallbacks",
    );
    assert.deepEqual(secret.value, { kind: "secret", name: "PW" });
    assert.ok(!source.includes("hunter2"), "a password never reaches the spec");
    assert.deepEqual(save.locator.chain, [
      { method: "getByRole", role: "button", name: "Save" },
    ]);
    assert.deepEqual(title.expectation, {
      matcher: "toHaveText",
      expected: "Welcome",
    });
    assert.equal(
      await page.getByCss("#title").getAttribute("data-hit"),
      null,
      "the Alt+click never reached the page",
    );

    // What was recorded can be replayed
    assert.equal(await page.getByLabel("Name").inputValue(), "Sam");
  },
);

test(
  "records a todo list: Enter after each item, and the next item is a new fill",
  OPTIONS,
  async () => {
    await setContent(
      page,
      `<label for="todo">New todo</label><input id="todo"><ul id="items"></ul><button id="add">Add</button>`,
      `const input = document.getElementById("todo");
     const add = () => {
       if (!input.value) return;
       const li = document.createElement("li");
       li.textContent = input.value;
       document.getElementById("items").appendChild(li);
       input.value = "";
     };
     input.addEventListener("keydown", (event) => { if (event.key === "Enter") add(); });
     document.getElementById("add").addEventListener("click", add);`,
    );
    const events: RecorderEvent[] = [];
    const recorder = await page.record({
      onEvent: (event) => events.push(event),
      initialGoto: false,
    });

    await page.getByLabel("New todo").fill("buy milk");
    await page.getByLabel("New todo").press("Enter");
    await page.getByLabel("New todo").fill("walk dog");
    await page.getByLabel("New todo").press("Enter");
    await page.getByLabel("New todo").fill("call mum");
    await pause(600);
    await recorder.stop();

    let source = `test("t", async ({ page }) => {\n});\n`;
    for (const event of events) source = applyRecorderEvent(source, 0, event);
    const steps = parseSpec(source)[0]!.steps.map(({ step }) => step);
    assert.deepEqual(
      steps.map((step) =>
        step.kind === "fill"
          ? `fill ${(step.value as { value: string }).value}`
          : step.kind === "press"
            ? `press ${step.key}`
            : step.kind,
      ),
      [
        "fill buy milk",
        "press Enter",
        "fill walk dog",
        "press Enter",
        "fill call mum",
      ],
      source,
    );
    assert.equal(
      await page.getByCss("#items li").count(),
      2,
      "the app added the two items that were submitted with Enter",
    );
  },
);

test(
  "records navigation keys where they act, and leaves typing and line breaks alone",
  OPTIONS,
  async () => {
    await setContent(
      page,
      `<input id="plain" aria-label="Plain">
     <input id="combo" role="combobox" aria-label="Search">
     <textarea id="area" aria-label="Comment"></textarea>
     <div id="menu" role="listbox" tabindex="0" aria-label="Menu">options</div>`,
    );
    const events: RecorderEvent[] = [];
    const recorder = await page.record({
      onEvent: (event) => events.push(event),
      initialGoto: false,
    });

    await page.getByLabel("Plain").press("ArrowLeft"); // moves the caret: not a step
    await page.getByLabel("Plain").press("Shift+Enter"); // a new line, not a step
    await page.getByLabel("Search").press("ArrowDown"); // moves through the suggestions
    await page.getByLabel("Comment").press("Enter"); // a line break
    await page.getByLabel("Comment").press("Control+Enter"); // submit shortcut
    await page.getByLabel("Menu").press("ArrowDown");
    await page.getByLabel("Menu").press("Escape");
    await page.getByLabel("Menu").press("Shift+Tab");
    await pause(700);
    await recorder.stop();

    let source = `test("t", async ({ page }) => {\n});\n`;
    for (const event of events) source = applyRecorderEvent(source, 0, event);
    const steps = parseSpec(source)[0]!.steps.map(({ step }) => step);
    const pressed = steps.flatMap((step) =>
      step.kind === "press"
        ? [
            `${(step.locator.chain[0] as { name?: string; text?: string }).name ?? (step.locator.chain[0] as { text?: string }).text}: ${step.key}`,
          ]
        : [],
    );
    assert.deepEqual(
      pressed,
      [
        "Search: ArrowDown",
        "Comment: Control+Enter",
        "Menu: ArrowDown",
        "Menu: Escape",
        "Menu: Shift+Tab",
      ],
      source,
    );
  },
);

test("stop ends the recording", OPTIONS, async () => {
  await setContent(page, `<button>Go</button>`);
  const events: RecorderEvent[] = [];
  const recorder = await page.record({
    onEvent: (event) => events.push(event),
    initialGoto: false,
  });
  await page.getByText("Go").click();
  await pause(300);
  await recorder.stop();
  const count = events.length;
  assert.equal(count, 1);
  await page.getByText("Go").click();
  await pause(300);
  assert.equal(events.length, count);
});
