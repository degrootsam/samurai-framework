import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { Browser } from "../browser/browser.js";
import type Page from "../browser/page.js";
import { callFunction } from "../script/call-function.js";
import { setContent } from "../testing/browser-fixture.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";
import { parseSpec } from "../steps/parse.js";
import { applyRecorderEvent } from "./apply.js";
import type { RecorderEvent } from "./recorder.js";
import { testBrowser } from "../testing/test-browser.js";

let browser: Browser;
let page: Page;

before(async () => {
  ({ browser, page } = await Browser.launch(testBrowser(), {
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

test("ignores the toolbar and can be muted", OPTIONS, async () => {
  await setContent(
    page,
    `<samurai-recorder-toolbar><button id="t">t</button></samurai-recorder-toolbar><button id="b">b</button>`,
  );
  const events: RecorderEvent[] = [];
  const recorder = await page.record({
    onEvent: (event) => events.push(event),
    initialGoto: false,
  });
  await page.getByCss("#t").click();
  await pause(300);
  assert.equal(events.length, 0, "a click in the toolbar is not recorded");
  await page.getByCss("#b").click();
  await pause(300);
  assert.equal(events.length, 1);
  await recorder.mute();
  await page.getByCss("#b").click();
  await pause(300);
  assert.equal(events.length, 1, "muted: nothing recorded");
  await recorder.unmute();
  await page.getByCss("#b").click();
  await pause(300);
  assert.equal(events.length, 2);
  await recorder.stop();
});

test(
  "a second recording of the same document records each action once, Alt+clicks too",
  OPTIONS,
  async () => {
    await setContent(page, `<button id="b">Go</button><h1>Title</h1>`);
    const first = await page.record({ onEvent: () => {}, initialGoto: false });
    await first.stop();
    const events: RecorderEvent[] = [];
    const second = await page.record({
      onEvent: (event) => events.push(event),
      initialGoto: false,
    });
    await page.getByCss("#b").click();
    await altClick("h1");
    await pause(300);
    await second.stop();
    assert.deepEqual(
      events.map((event) =>
        event.op === "insert" ? event.step.kind : event.op,
      ),
      ["click", "expect"],
    );
    assert.equal(
      await callFunction(
        (page as unknown as { biDiConnector: BiDiConnector }).biDiConnector,
        page.contextId,
        `() => typeof window[Symbol.for("samurai.recorder.send")]`,
      ),
      "undefined",
      "the channel is not on the page's window",
    );
  },
);

/** The steps `events` write into an empty test */
function stepsOf(events: RecorderEvent[]) {
  let source = `test("t", async ({ page }) => {\n});\n`;
  for (const event of events) source = applyRecorderEvent(source, 0, event);
  return parseSpec(source)[0]!.steps.map(({ step }) => step);
}

/** A sign-in form that, like a React app after a successful login, replaces itself on submit */
const SIGN_IN = [
  `<form id="f"><label for="email">Email</label><input id="email" type="email">
   <label for="pw">Password</label><input id="pw" type="password">
   <button type="submit">Sign in</button></form>`,
  `document.getElementById("f").addEventListener("submit", (event) => {
     event.preventDefault();
     document.body.innerHTML = "<p>Welcome</p><button>Sign out</button>";
   });`,
] as const;

test(
  "records a click on a button that its own click removes, like Sign in after a login",
  OPTIONS,
  async () => {
    await setContent(page, ...SIGN_IN);
    const events: RecorderEvent[] = [];
    const recorder = await page.record({
      onEvent: (event) => events.push(event),
      initialGoto: false,
    });
    await page.getByLabel("Email").fill("sam@example.com");
    await page.getByLabel("Password").fill("samurai");
    await page.getByRole("button", { name: "Sign in" }).click();
    await pause(500);
    await recorder.stop();

    const steps = stepsOf(events);
    assert.deepEqual(
      steps.map((step) => step.kind),
      ["fill", "fill", "click"],
    );
    const click = steps[2] as Extract<
      (typeof steps)[number],
      { kind: "click" }
    >;
    assert.deepEqual(click.locator.chain, [
      { method: "getByRole", role: "button", name: "Sign in" },
    ]);
  },
);

test(
  "records an Enter that submits a form which then removes itself",
  OPTIONS,
  async () => {
    await setContent(page, ...SIGN_IN);
    // Filled before the recording (a browser's autofill): the Enter is the first the recorder sees of it
    await page.getByLabel("Password").fill("samurai");
    const events: RecorderEvent[] = [];
    const recorder = await page.record({
      onEvent: (event) => events.push(event),
      initialGoto: false,
    });
    await page.getByLabel("Password").press("Enter");
    await pause(500);
    await recorder.stop();

    const steps = stepsOf(events);
    assert.deepEqual(
      steps.map((step) => step.kind),
      ["press"],
    );
    const press = steps[0] as Extract<
      (typeof steps)[number],
      { kind: "press" }
    >;
    assert.deepEqual(press.locator.chain, [
      { method: "getByLabel", text: "Password" },
    ]);
  },
);

test(
  "a removed button gets only locators that matched it alone when it was clicked",
  OPTIONS,
  async () => {
    await setContent(
      page,
      `<ul><li>Milk <button id="del-1">Delete</button></li><li>Eggs <button id="del-2">Delete</button></li></ul>`,
      `for (const button of document.querySelectorAll("button"))
         button.addEventListener("click", () => button.parentElement.remove());`,
    );
    const events: RecorderEvent[] = [];
    const recorder = await page.record({
      onEvent: (event) => events.push(event),
      initialGoto: false,
    });
    await page.getByCss("#del-1").click();
    await pause(500);
    await recorder.stop();

    const steps = stepsOf(events);
    assert.deepEqual(
      steps.map((step) => step.kind),
      ["click"],
    );
    const click = steps[0] as Extract<
      (typeof steps)[number],
      { kind: "click" }
    >;
    assert.deepEqual(
      click.locator.chain,
      [{ method: "getByCss", css: "#del-1" }],
      "two buttons were named Delete: role and text did not pick this one out",
    );
  },
);

test(
  "an Enter that submits a form is one press, not also a click on its submit button",
  OPTIONS,
  async () => {
    await setContent(
      page,
      `<form id="f"><label for="q">Search</label><input id="q"><button type="submit">Go</button></form>`,
      `document.getElementById("f").addEventListener("submit", (event) => event.preventDefault());`,
    );
    await page.getByLabel("Search").fill("milk");
    const events: RecorderEvent[] = [];
    const recorder = await page.record({
      onEvent: (event) => events.push(event),
      initialGoto: false,
    });
    await page.getByLabel("Search").press("Enter");
    await pause(500);
    await page.getByRole("button", { name: "Go" }).click();
    await pause(500);
    await recorder.stop();

    assert.deepEqual(
      stepsOf(events).map((step) => step.kind),
      ["press", "click"],
      "the Enter's own submit click is dropped; a real click on the button is kept",
    );
  },
);
