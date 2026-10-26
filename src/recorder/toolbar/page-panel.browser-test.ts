import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, before, test } from "node:test";
import { expect } from "../../assert/expect.js";
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
let server: Server;
let origin: string;
const sockets = new Set<Socket>();
let projectDir: string;
let recorder: Recorder | undefined;

before(async () => {
  server = createServer((_req, res) => {
    res
      .setHeader("content-type", "text/html")
      .end(
        `<!doctype html><html><head><title>Checkout</title></head><body><p>Pay</p></body></html>`,
      );
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  projectDir = await mkdtemp(path.join(tmpdir(), "samurai-page-panel-"));
  ({ browser, page } = await Browser.launch(testBrowser(), {
    port: 9249,
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
    sockets.forEach((socket) => socket.destroy());
    await new Promise((resolve) => server.close(resolve));
    await rm(projectDir, { recursive: true, force: true });
  }
});

const OPTIONS = { timeout: 60000 };
const { inSandbox, press, viewState, typeInto } = toolbarDriver(() => ({
  page,
  connector,
}));

/** Records with a toolbar against `baseURL`; `source()` is the spec the steps make */
async function record(baseURL: string) {
  const events: RecorderEvent[] = [];
  recorder = await page.record({
    onEvent: (event) => events.push(event),
    initialGoto: false,
    baseURL,
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

/** The Page panel's expected value once the recorder has answered */
const expectedValue = () =>
  inSandbox<string | null>(
    `() => { const el = ${HOOK}.root.querySelector('[data-field="pageExpected"]'); return el ? el.value : null; }`,
  );
const panelError = () =>
  inSandbox<string | null>(
    `() => { const el = ${HOOK}.root.querySelector(".panel .err"); return el ? el.textContent : null; }`,
  );

test(
  "the Page panel asserts the URL relative to the base URL, and the title",
  OPTIONS,
  async () => {
    const base = `${origin}/app`;
    await page.navigateTo(`${base}/checkout?step=2`, "complete");
    const { source, steps } = await record(base);

    await press("page");
    await waitFor(
      async () => (await expectedValue()) === "/app/checkout?step=2",
      "the URL, relative to the base URL",
    );
    await press("page-add");
    await waitFor(() => steps().length === 1, "the URL step");
    assert.ok(
      source().includes(
        `await expect(page).toHaveURL("/app/checkout?step=2");`,
      ),
      source(),
    );
    assert.equal(
      new URL("/app/checkout?step=2", base).href,
      await page.url(),
      "resolves back to the page's URL",
    );
    await waitFor(
      async () => (await expectedValue()) === null,
      "the panel to close",
    );

    await press("page");
    await waitFor(
      async () => (await expectedValue()) !== null,
      "the Page panel",
    );
    await press("page-matcher", { matcher: "toHaveTitle" });
    assert.equal(await expectedValue(), "Checkout", "the title is prefilled");
    await press("page-add");
    await waitFor(() => steps().length === 2, "the title step");
    assert.deepEqual(steps()[1], {
      kind: "expectPage",
      not: false,
      expectation: { matcher: "toHaveTitle", expected: "Checkout" },
    });
    await expect(page).toHaveTitle("Checkout", { timeout: 2000 });

    await press("page");
    await waitFor(
      async () => (await expectedValue()) !== null,
      "the Page panel",
    );
    await press("page-matcher", { matcher: "toHaveTitle" });
    await typeInto("pageExpected", "Cart");
    await press("page-not");
    await press("page-add");
    await waitFor(() => steps().length === 3, "the negated title step");
    assert.ok(
      source().includes(`await expect(page).not.toHaveTitle("Cart");`),
      source(),
    );
  },
);

test("an empty value is refused and leaves no step", OPTIONS, async () => {
  await page.navigateTo(`${origin}/home`, "complete");
  const { steps } = await record(origin);
  await press("page");
  await waitFor(
    async () => (await expectedValue()) === "/home",
    "the Page panel",
  );
  await typeInto("pageExpected", "");
  await press("page-add");
  await waitFor(
    async () => (await panelError()) === "Fill in the value",
    "the error",
  );
  assert.deepEqual(steps(), []);
});
