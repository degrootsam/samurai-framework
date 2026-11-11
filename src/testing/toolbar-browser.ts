import { randomUUID } from "node:crypto";
import { after, afterEach, before } from "node:test";
import { Browser } from "../browser/browser.js";
import type Page from "../browser/page.js";
import { callFunction } from "../script/call-function.js";
import { addPreload, type PreloadHandle } from "../script/preload.js";
import { ChannelArg, fromRemoteValue } from "../script/serialize.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";
import {
  TOOLBAR_KEY,
  TOOLBAR_SANDBOX,
  type ToolbarState,
} from "../recorder/toolbar/protocol.js";
import { TOOLBAR_SOURCE } from "../recorder/toolbar/source.js";
import { testBrowser } from "./test-browser.js";

let browser: Browser;
export let page: Page;
export let connector: BiDiConnector;
/** Every toolbar message, with the channel it came on */
const received: {
  channel: string;
  context: string | undefined;
  data: Record<string, unknown>;
}[] = [];
const handles: PreloadHandle[] = [];

before(async () => {
  ({ browser, page } = await Browser.launch(testBrowser(), {
    port: 9242,
    headless: true,
  }));
  connector = (page as unknown as { biDiConnector: BiDiConnector })
    .biDiConnector;
  connector.onEvent("script.message", (params) => {
    received.push({
      channel: params.channel,
      context: params.source.context,
      data: fromRemoteValue(
        params.data as Parameters<typeof fromRemoteValue>[0],
      ) as Record<string, unknown>,
    });
  });
  await connector.subscribe(["script.message"]);
});

afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.dispose();
});

after(async () => {
  await browser?.close();
});

export const OPTIONS = { timeout: 30000 };
export const HOOK = `globalThis[Symbol.for("${TOOLBAR_KEY}")]`;
export const pause = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

const STATE: ToolbarState = {
  status: "recording",
  collapsed: false,
  position: null,
  steps: 0,
  environment: "dev",
  canAddVariables: true,
  variables: [{ name: "testUser", value: "dev@example.com" }],
  secrets: [
    { name: "ADMIN_PASSWORD", set: true },
    { name: "API_TOKEN", set: false },
  ],
  inputs: [{ name: "email", value: "a@b.c" }],
  secretsIgnored: true,
  resumeQuestion: false,
  nextScreenshot: "screenshot-1",
  warnings: [],
};

export async function waitFor<T>(
  probe: () => T | undefined | Promise<T | undefined>,
  what: string,
  ms = 5000,
): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await probe();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await pause(50);
  }
}

export const messagesOn = (channel: string, action?: string) =>
  received.filter(
    (m) =>
      m.channel === channel &&
      (action === undefined || m.data.action === action),
  );

export async function install(): Promise<string> {
  const channel = `toolbar-test-${randomUUID()}`;
  handles.push(
    await addPreload(connector, {
      source: TOOLBAR_SOURCE,
      sandbox: TOOLBAR_SANDBOX,
      contexts: [page.contextId],
      arguments: [new ChannelArg(channel)],
    }),
  );
  return channel;
}

export const inSandbox = <T>(fn: string, ...args: unknown[]) =>
  callFunction<T>(connector, page.contextId, fn, args, {
    sandbox: TOOLBAR_SANDBOX,
  });
export const inPage = <T>(fn: string) =>
  callFunction<T>(connector, page.contextId, fn);
export const update = (state: Partial<ToolbarState> = {}) =>
  inSandbox(`(state) => { ${HOOK}.update(state); }`, { ...STATE, ...state });
export const press = (action: string, detail?: object) =>
  inSandbox(
    `(action, detail) => { ${HOOK}.press(action, detail); }`,
    action,
    detail,
  );
export const reply = (id: number, result: object) =>
  inSandbox(`(id, result) => { ${HOOK}.reply(id, result); }`, id, result);

/** The centre of the first toolbar control matching `selector`, in viewport pixels */
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

/** Trusted clicks at the point, `count` times in quick succession */
export async function clickAt({ x, y }: { x: number; y: number }, count = 1) {
  const click = [
    { type: "pointerDown", button: 0 },
    { type: "pointerUp", button: 0 },
  ] as const;
  await connector.send("input.performActions", {
    context: page.contextId,
    actions: [
      {
        type: "pointer",
        id: "mouse",
        actions: [
          { type: "pointerMove", x, y },
          ...Array.from({ length: count }, () => click).flat(),
        ],
      },
    ],
  });
}

export async function readyOn(channel: string, count = 1) {
  await waitFor(
    () => messagesOn(channel, "ready").length >= count,
    `ready #${count} on ${channel}`,
  );
}

export const hostCount = () =>
  inPage<number>(
    `() => document.querySelectorAll("samurai-recorder-toolbar").length`,
  );
