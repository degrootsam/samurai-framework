import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, before, test } from "node:test";
import { Browser } from "../../browser/browser.js";
import type Page from "../../browser/page.js";
import { parseSpec } from "../../steps/parse.js";
import type { Step } from "../../steps/model.js";
import type { BiDiConnector } from "../../transport/bidi-connection.js";
import { testBrowser } from "../../testing/test-browser.js";
import { applyRecorderEvent } from "../apply.js";
import type { Recorder, RecorderEvent } from "../recorder.js";
import { HOOK, toolbarDriver, waitFor } from "./recorder-toolbar-fixture.js";

let browser: Browser;
let page: Page;
let connector: BiDiConnector;
let projectDir: string;
let recorder: Recorder | undefined;

const HTML = `data:text/html,<label for="e">Email</label><input id="e"><label for="f">Other</label><input id="f">`;

before(async () => {
  projectDir = await mkdtemp(path.join(tmpdir(), "samurai-insert-input-"));
  ({ browser, page } = await Browser.launch(testBrowser(), {
    port: 9259,
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
    await rm(projectDir, { recursive: true, force: true });
  }
});

const OPTIONS = { timeout: 60000 };
const { inSandbox, press, viewState, typeInto } = toolbarDriver(() => ({
  page,
  connector,
}));

/** Records with a toolbar; `source()` is the spec the steps make */
async function record() {
  const events: RecorderEvent[] = [];
  recorder = await page.record({
    onEvent: (event) => events.push(event),
    initialGoto: false,
    toolbar: {
      environment: "dev",
      canAddVariables: true,
      variables: {},
      secrets: {},
      secretsIgnored: true,
      screenshots: 0,
      projectDir,
    },
  });
  await waitFor(
    async () => (await viewState())?.environment === "dev",
    "the toolbar's first state",
  );
  const source = () => {
    let spec = `test("t", async ({ page }) => {\n});\n`;
    for (const event of events) spec = applyRecorderEvent(spec, 0, event);
    return spec;
  };
  const steps = (): Step[] =>
    parseSpec(source())[0]!.steps.map(({ step }) => step);
  return { source, steps };
}

const panelText = () =>
  inSandbox<string | null>(
    `() => { const el = ${HOOK}.root.querySelector(".panel"); return el ? el.textContent : null; }`,
  );

test(
  "Insert: a new input is typed, declared with that default and filled as inputs.<name>; a second field reuses it",
  OPTIONS,
  async () => {
    await page.navigateTo(HTML, "complete");
    const { source, steps } = await record();

    await page.getByLabel("Email").click();
    await press("insert");
    assert.match((await panelText()) ?? "", /Inputs.*No inputs yet\./);
    await press("insert-new", { kind: "input" });
    await typeInto("name", "email");
    await typeInto("value", "a@b.c");
    await press("new-save");
    await waitFor(() => steps().length === 1, "the fill step");

    assert.equal(await page.getByLabel("Email").inputValue(), "a@b.c");
    assert.match(
      source(),
      /test\("t", \{ inputs: \{ email: "a@b\.c" \} \}, async \(\{ page, inputs \}\) => \{/,
    );
    assert.match(source(), /\.fill\(inputs\.email\)/);
    assert.deepEqual(
      (await viewState())?.inputs,
      [{ name: "email", value: "a@b.c" }],
      "the toolbar lists the new input",
    );

    await page.getByLabel("Other").click();
    await press("insert");
    assert.match((await panelText()) ?? "", /Inputs.*email.*a@b\.c/);
    await press("insert-item", { kind: "input", name: "email" });
    await waitFor(() => steps().length === 2, "the second fill step");
    assert.equal(await page.getByLabel("Other").inputValue(), "a@b.c");
    assert.equal(parseSpec(source())[0]!.inputs?.length, 1, "declared once");
  },
);

test(
  "Insert: an input name that is taken is refused and records nothing more",
  OPTIONS,
  async () => {
    await page.navigateTo(HTML, "complete");
    const { steps } = await record();
    await page.getByLabel("Email").click();
    await press("insert");
    await press("insert-new", { kind: "input" });
    await typeInto("name", "email");
    await typeInto("value", "x");
    await press("new-save");
    await waitFor(() => steps().length === 1, "the fill step");

    await page.getByLabel("Other").click();
    await press("insert");
    await press("insert-new", { kind: "input" });
    await typeInto("name", "email");
    await typeInto("value", "y");
    await press("new-save");
    await waitFor(
      async () =>
        ((await panelText()) ?? "").includes(`"email" already exists`),
      "the name error",
    );
    assert.equal(steps().length, 1);
  },
);
