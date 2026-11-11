import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, before } from "node:test";
import { Browser } from "../browser/browser.js";
import type Page from "../browser/page.js";
import { callFunction } from "../script/call-function.js";
import { parseSpec } from "../steps/parse.js";
import type { Step } from "../steps/model.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";
import { applyRecorderEvent } from "../recorder/apply.js";
import type {
  Recorder,
  RecorderEvent,
  ToolbarOptions,
} from "../recorder/recorder.js";
import {
  HOOK,
  toolbarDriver,
  waitFor,
} from "../recorder/toolbar/recorder-toolbar-fixture.js";
import { testBrowser } from "./test-browser.js";

let browser: Browser;
export let page: Page;
export let connector: BiDiConnector;
/** Two servers, so a navigation between them changes origin */
const servers: Server[] = [];
export const bases: string[] = [];
const sockets = new Set<Socket>();
/** Path → HTML, served by both servers */
export const pages = new Map<string, string>();
export let projectDir: string;
export let recorder: Recorder | undefined;

before(async () => {
  for (let i = 0; i < 2; i++) {
    const server = createServer((req, res) => {
      const html = pages.get(req.url ?? "/") ?? "<p>not found</p>";
      // Pages under /csp/ forbid inline styles
      if (req.url?.startsWith("/csp/"))
        res.setHeader("content-security-policy", "style-src 'self'");
      res
        .setHeader("content-type", "text/html")
        .end(`<!doctype html><html><body>${html}</body></html>`);
    });
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    servers.push(server);
    bases.push(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  }
  projectDir = await mkdtemp(path.join(tmpdir(), "samurai-toolbar-"));
  ({ browser, page } = await Browser.launch(testBrowser(), {
    port: 9243,
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
    for (const server of servers)
      await new Promise((resolve) => server.close(resolve));
    await rm(projectDir, { recursive: true, force: true });
  }
});

export const OPTIONS = { timeout: 60000 };

export const CONFIG = `import { defineConfig } from "@itmetsam/samurai-framework";

export default defineConfig({
  environments: {
    dev: {
      variables: {
        testUser: "dev@example.com",
      },
    },
  },
});
`;

export const { inSandbox, press, pickElement, viewState, typeInto } =
  toolbarDriver(() => ({ page, connector }));
export const inPage = <T>(fn: string) =>
  callFunction<T>(connector, page.contextId, fn);

/** Navigates and waits until the new document's toolbar has the recorder's state */
export async function open(url: string) {
  await page.navigateTo(url, "complete");
  await waitFor(
    async () => (await viewState())?.environment === "dev",
    `the toolbar on ${url}`,
  );
}

export async function record(toolbar: Partial<ToolbarOptions> = {}) {
  const events: RecorderEvent[] = [];
  const statuses: { state: string; toolbar: boolean }[] = [];
  recorder = await page.record({
    onEvent: (event) => events.push(event),
    initialGoto: false,
    toolbar: {
      environment: "dev",
      canAddVariables: true,
      variables: { testUser: "dev@example.com" },
      secrets: {},
      secretsIgnored: true,
      screenshots: 0,
      projectDir,
      onStatus: (status) => statuses.push(status),
      ...toolbar,
    },
  });
  await waitFor(
    async () => (await viewState())?.environment === "dev",
    "the toolbar's first state",
  );
  const steps = (): Step[] => {
    let source = `test("t", async ({ page }) => {\n});\n`;
    for (const event of events) source = applyRecorderEvent(source, 0, event);
    return parseSpec(source)[0]!.steps.map(({ step }) => step);
  };
  return { events, statuses, steps };
}

/** Trusted pointer actions at viewport points */
export async function pointer(
  actions: (
    | { type: "pointerMove"; x: number; y: number }
    | { type: "pointerDown" | "pointerUp"; button: 0 }
  )[],
) {
  await connector.send("input.performActions", {
    context: page.contextId,
    actions: [{ type: "pointer", id: "mouse", actions }],
  });
}

export const centreOf = (selector: string) =>
  inSandbox<{ x: number; y: number }>(
    `(selector) => {
      const el = ${HOOK}.root.querySelector(selector);
      if (!el) throw new Error("no " + selector);
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    }`,
    selector,
  );

/** Hands a recorder the test started itself to the `afterEach` that stops it */
export function setRecorder(started: Recorder) {
  recorder = started;
}
