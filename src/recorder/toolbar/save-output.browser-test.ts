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

const HTML = `data:text/html,<h1>Thanks</h1><p data-testid="conf">Order %234521 is placed</p>`;

before(async () => {
  projectDir = await mkdtemp(path.join(tmpdir(), "samurai-save-output-"));
  ({ browser, page } = await Browser.launch(testBrowser(), {
    port: 9258,
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

/** Records with a toolbar and these secrets; `source()` is the spec the steps make */
async function record(secrets: Record<string, string> = {}) {
  const events: RecorderEvent[] = [];
  recorder = await page.record({
    onEvent: (event) => events.push(event),
    initialGoto: false,
    toolbar: {
      environment: "dev",
      canAddVariables: true,
      variables: {},
      secrets,
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

/** The text of the first element matching `selector` in the open panel, null when there is none */
const panelText = (selector: string) =>
  inSandbox<string | null>(
    `(selector) => { const el = ${HOOK}.root.querySelector(".panel " + selector); return el ? el.textContent : null; }`,
    selector,
  );

/** Opens Save as output and picks the confirmation paragraph */
async function pickConfirmation() {
  await press("output");
  assert.equal(await inSandbox(`() => ${HOOK}.picking()`), true);
  await inSandbox(
    `() => { ${HOOK}.press("pick", { target: document.querySelector('[data-testid="conf"]') }); }`,
  );
  await waitFor(
    async () => (await panelText(".out-text")) === "Order #4521 is placed",
    "the element's text in the panel",
  );
}

test(
  "Save as output: pick, name, pattern, save records outputs.save and declares the output",
  OPTIONS,
  async () => {
    await page.navigateTo(HTML, "complete");
    const { source, steps } = await record();
    await pickConfirmation();
    assert.equal(
      await panelText(".out-capture"),
      "Order #4521 is placed",
      "without a pattern the whole text is captured",
    );

    await typeInto("outputName", "orderId");
    await typeInto("outputPattern", "Order #(\\d+)");
    assert.equal(await panelText(".out-capture"), "4521");
    await press("output-save");
    await waitFor(() => steps().length === 1, "the saveOutput step");

    const text = source();
    assert.match(
      text,
      /test\("t", \{ outputs: \["orderId"\] \}, async \(\{ page, outputs \}\) => \{/,
    );
    assert.match(
      text,
      /await outputs\.save\("orderId", page\..+, \/Order #\(\\d\+\)\/\);/,
    );
    assert.deepEqual((steps()[0] as { pattern?: unknown }).pattern, {
      source: "Order #(\\d+)",
      flags: "",
    });
    await waitFor(
      async () => (await panelText(".out-text")) === null,
      "the panel to close",
    );
  },
);

test(
  "Save as output refuses a bad name and a pattern that doesn't match, and records nothing",
  OPTIONS,
  async () => {
    await page.navigateTo(HTML, "complete");
    const { steps } = await record();
    await pickConfirmation();

    await typeInto("outputName", "status");
    await press("output-save");
    await waitFor(
      async () =>
        (await panelText(".field-error")) === 'name: "status" is reserved',
      "the name error",
    );

    await typeInto("outputName", "orderId");
    await typeInto("outputPattern", "Invoice (\\d+)");
    assert.equal(await panelText(".out-capture"), "No match");
    await press("output-save");
    await waitFor(
      async () =>
        (await panelText(".err")) ===
        "pattern doesn't match the element's text",
      "the pattern error",
    );
    assert.deepEqual(steps(), []);
  },
);

test(
  "Save as output reads the text as outputs.save does: line breaks inside it are kept",
  OPTIONS,
  async () => {
    await page.navigateTo(
      `data:text/html,<p data-testid="multi">  Order%0A    %2377  </p>`,
      "complete",
    );
    const { steps } = await record();
    await press("output");
    await inSandbox(
      `() => { ${HOOK}.press("pick", { target: document.querySelector('[data-testid="multi"]') }); }`,
    );
    await waitFor(
      async () => (await panelText(".out-capture")) !== null,
      "the panel",
    );
    const runtime = await page.getByTestId("multi").textContent();
    assert.equal(runtime, "Order\n    #77");
    assert.equal(await panelText(".out-capture"), runtime);

    await typeInto("outputName", "orderId");
    await typeInto("outputPattern", "Order #(\\d+)");
    assert.equal(await panelText(".out-capture"), "No match");
    await press("output-save");
    await waitFor(
      async () =>
        (await panelText(".err")) ===
        "pattern doesn't match the element's text",
      "the pattern error",
    );

    await typeInto("outputPattern", "Order\\s+#(\\d+)");
    assert.equal(await panelText(".out-capture"), "77");
    await press("output-save");
    await waitFor(() => steps().length === 1, "the saveOutput step");
  },
);

test(
  "Save as output with a / in the pattern writes a spec that parses back to the same step",
  OPTIONS,
  async () => {
    await page.navigateTo(
      `data:text/html,<p data-testid="path">orders/4521</p>`,
      "complete",
    );
    const { source, steps } = await record();
    await press("output");
    await inSandbox(
      `() => { ${HOOK}.press("pick", { target: document.querySelector('[data-testid="path"]') }); }`,
    );
    await waitFor(
      async () => (await panelText(".out-text")) === "orders/4521",
      "the element's text in the panel",
    );
    await typeInto("outputName", "orderId");
    await typeInto("outputPattern", "orders/(\\d+)");
    assert.equal(await panelText(".out-capture"), "4521");
    await press("output-save");
    await waitFor(() => steps().length === 1, "the saveOutput step");

    assert.match(source(), /, \/orders\\\/\(\\d\+\)\/\);/);
    assert.deepEqual(steps()[0], {
      kind: "saveOutput",
      locator: (steps()[0] as { locator: unknown }).locator,
      name: "orderId",
      pattern: { source: "orders\\/(\\d+)", flags: "" },
    });
  },
);

const SECRET_PAGE = `data:text/html,<p data-testid="conf">Thank you! Order %2396002 is confirmed for samurai@example.com.</p>`;
const MAY_HOLD =
  "This element shows a secret. The saved output may contain it; use a pattern that captures only the non-secret part.";

/** Records with the email as a secret and picks the confirmation that shows it */
async function pickSecretConfirmation() {
  await page.navigateTo(SECRET_PAGE, "complete");
  const recording = await record({ EMAIL: "samurai@example.com" });
  await press("output");
  await inSandbox(
    `() => { ${HOOK}.press("pick", { target: document.querySelector('[data-testid="conf"]') }); }`,
  );
  await waitFor(
    async () => (await panelText(".out-secret")) === MAY_HOLD,
    "the secret warning",
  );
  return recording;
}

/** Whether the toolbar's DOM holds the secret anywhere */
const toolbarHoldsSecret = () =>
  inSandbox<boolean>(
    `() => ${HOOK}.root.innerHTML.includes("samurai@example.com")`,
  );

test(
  "Save as output on an element that shows a secret warns, previews the captured part and saves",
  OPTIONS,
  async () => {
    const { source, steps } = await pickSecretConfirmation();
    assert.equal(
      await panelText(".out-text"),
      "Thank you! Order #96002 is confirmed for ••••.",
    );
    await waitFor(
      async () =>
        (await panelText(".out-capture")) ===
        "Thank you! Order #96002 is confirmed for ••••.",
      "the masked whole text as the preview",
    );

    await typeInto("outputName", "orderId");
    await typeInto("outputPattern", "Order #(\\d+)");
    await waitFor(
      async () => (await panelText(".out-capture")) === "96002",
      "the recorder's preview",
    );
    assert.equal(await panelText(".out-leak"), null);
    assert.equal(await panelText(".out-secret"), MAY_HOLD);

    await typeInto("outputPattern", "Invoice (\\d+)");
    await waitFor(
      async () => (await panelText(".out-capture")) === "No match",
      "No match for a pattern that doesn't match",
    );
    await typeInto("outputPattern", "Order #(\\d+)");
    await waitFor(
      async () => (await panelText(".out-capture")) === "96002",
      "the preview again",
    );
    assert.equal(await toolbarHoldsSecret(), false);

    await press("output-save");
    await waitFor(() => steps().length === 1, "the saveOutput step");
    assert.match(
      source(),
      /await outputs\.save\("orderId", page\..+, \/Order #\(\\d\+\)\/\);/,
    );
  },
);

test(
  "Save as output with a pattern that captures the secret previews it masked, warns harder and still saves",
  OPTIONS,
  async () => {
    const { steps } = await pickSecretConfirmation();
    await typeInto("outputName", "email");
    await typeInto("outputPattern", "for (\\S+)\\.$");
    await waitFor(
      async () => (await panelText(".out-capture")) === "••••",
      "the masked preview",
    );
    assert.equal(
      await panelText(".out-leak"),
      "The output will contain a secret: reports mask it, but whatever reads the output gets the real value.",
    );
    assert.equal(await toolbarHoldsSecret(), false);

    await press("output-save");
    await waitFor(() => steps().length === 1, "the saveOutput step");
    assert.deepEqual((steps()[0] as { pattern?: unknown }).pattern, {
      source: "for (\\S+)\\.$",
      flags: "",
    });
  },
);
