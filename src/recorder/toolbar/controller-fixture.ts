import assert from "node:assert/strict";
import { ElementHandle } from "../../script/element-handle.js";
import type { LocatorCall, LocatorSpec } from "../../steps/model.js";
import type { Observation } from "../normalise.js";
import { ToolbarController } from "./controller.js";
import type {
  ActionReply,
  PickInfo,
  ToolbarMessage,
  ToolbarState,
} from "./protocol.js";
import type { ControllerDeps, ControllerOptions, Inspection } from "./types.js";

export const SECRET = "hunter2-very-secret";
export const NEW_SECRET = "n3w-s3cr3t-value";

const OPTIONS: ControllerOptions = {
  environment: "dev",
  canAddVariables: true,
  variables: { testUser: "dev@example.com", retries: 3 },
  secrets: { ADMIN_PASSWORD: SECRET, API_TOKEN: undefined },
  secretsIgnored: true,
  screenshots: 0,
};

export const TARGET = new ElementHandle("el-1");
export const CANDIDATES: LocatorCall[] = [
  { method: "getByRole", role: "textbox", name: "Email" },
];
export const LOCATOR: LocatorSpec = { chain: [CANDIDATES[0]!], fallbacks: [] };
export const COUNT_CALL: LocatorCall = {
  method: "getByRole",
  role: "listitem",
};
export const INFO: PickInfo & { ok: true } = {
  ok: true,
  label: `textbox "Email"`,
  text: "",
  outputText: "",
  value: "a@b.c",
  attributes: [{ name: "id", value: "email" }],
  first: { matcher: "toHaveValue", expected: "a@b.c" },
  counts: [{ label: "listitem", count: 3 }],
  checkable: false,
  disableable: true,
  className: null,
  css: { name: "color", value: "rgb(0, 0, 0)" },
};

export const lastOf = <T>(items: T[]): T | undefined => items[items.length - 1];

export type Message = ToolbarMessage & { target?: ElementHandle };
export const msg = (message: Record<string, unknown>) =>
  ({ type: "toolbar", ...message }) as Message;
export const insert = (id: number, kind: "env" | "secret", name: string) =>
  msg({
    action: "insert",
    id,
    target: TARGET,
    candidates: CANDIDATES,
    kind,
    name,
  });
export const add = (
  id: number,
  kind: "env" | "secret",
  name: string,
  value: string,
) =>
  msg({
    action: "add-insertable",
    id,
    target: TARGET,
    candidates: CANDIDATES,
    kind,
    name,
    value,
  });
export const pick = (id: number) =>
  msg({ action: "pick", id, target: TARGET, candidates: CANDIDATES });

/** A controller over fakes that record everything */
export function setup(
  options: Partial<ControllerOptions> = {},
  overrides: Partial<ControllerDeps> = {},
) {
  const pushes: ToolbarState[] = [];
  const replies: { id: number; result: PickInfo | ActionReply }[] = [];
  const observed: Observation[] = [];
  const statuses: { state: string; toolbar: boolean }[] = [];
  const calls: string[] = [];
  const page = { url: "http://localhost/a", title: "Home" };
  let controller: ToolbarController;
  const deps: ControllerDeps = {
    push: (state) => pushes.push(structuredClone(state)),
    reply: (id, result) =>
      replies.push({ id, result: structuredClone(result) }),
    currentUrl: async () => page.url,
    pageInfo: async () => ({ url: page.url, title: page.title }),
    rank: async () => LOCATOR,
    inspect: async (): Promise<Inspection> => ({
      info: INFO,
      counts: [COUNT_CALL],
    }),
    type: async (_locator, value) => {
      calls.push(`type ${value}`);
    },
    mute: async () => {
      calls.push("mute");
    },
    unmute: async () => {
      calls.push("unmute");
    },
    addVariable: async (name, value) => {
      calls.push(`addVariable ${name}=${value}`);
    },
    setSecret: async (name, value) => {
      calls.push(`setSecret ${name}=${value}`);
    },
    secretAdded: (name) => {
      calls.push(`secretAdded ${name}`);
    },
    // As the recorder does: an observation becomes a step, which is counted
    observe: (observation) => {
      observed.push(observation);
      controller.stepAdded(
        observation.type === "screenshot"
          ? {
              kind: "screenshot",
              name: observation.name,
              fullPage: observation.fullPage,
            }
          : { kind: "waitForNetworkIdle" },
      );
    },
    stop: () => {
      calls.push("stop");
    },
    onStatus: (status) => statuses.push(status),
    ...overrides,
  };
  controller = new ToolbarController(deps, { ...OPTIONS, ...options });
  const last = () => lastOf(pushes)!;
  const noSecretLeaks = () => {
    const sent = JSON.stringify(pushes) + JSON.stringify(replies);
    assert.ok(!sent.includes(SECRET), "a secret value reached the page");
    assert.ok(
      !sent.includes(NEW_SECRET),
      "a new secret value reached the page",
    );
  };
  return {
    controller,
    pushes,
    replies,
    observed,
    statuses,
    calls,
    page,
    last,
    noSecretLeaks,
  };
}

/** Deps whose `type` fails, as a field that can't be typed into does */
export const failingType = {
  type: async () => {
    throw new Error("not editable");
  },
};
