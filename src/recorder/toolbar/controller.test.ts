import assert from "node:assert/strict";
import { describe, it, type TestContext } from "node:test";
import { ConfigEditError } from "../../project/config-edit.js";
import { ExistsError } from "../../project/variables.js";
import { ElementHandle } from "../../script/element-handle.js";
import type { LocatorCall, LocatorSpec } from "../../steps/model.js";
import type { Observation } from "../normalise.js";
import {
  ToolbarController,
  type ControllerDeps,
  type ControllerOptions,
  type Inspection,
} from "./controller.js";
import type {
  ActionReply,
  PickInfo,
  ToolbarMessage,
  ToolbarState,
} from "./protocol.js";

const SECRET = "hunter2-very-secret";
const NEW_SECRET = "n3w-s3cr3t-value";

const OPTIONS: ControllerOptions = {
  environment: "dev",
  canAddVariables: true,
  variables: { testUser: "dev@example.com", retries: 3 },
  secrets: { ADMIN_PASSWORD: SECRET, API_TOKEN: undefined },
  secretsIgnored: true,
  screenshots: 0,
};

const TARGET = new ElementHandle("el-1");
const CANDIDATES: LocatorCall[] = [
  { method: "getByRole", role: "textbox", name: "Email" },
];
const LOCATOR: LocatorSpec = { chain: [CANDIDATES[0]!], fallbacks: [] };
const COUNT_CALL: LocatorCall = { method: "getByRole", role: "listitem" };
const INFO: PickInfo & { ok: true } = {
  ok: true,
  label: `textbox "Email"`,
  text: "",
  value: "a@b.c",
  attributes: [{ name: "id", value: "email" }],
  first: { matcher: "toHaveValue", expected: "a@b.c" },
  counts: [{ label: "listitem", count: 3 }],
};

const lastOf = <T>(items: T[]): T | undefined => items[items.length - 1];

type Message = ToolbarMessage & { target?: ElementHandle };
const msg = (message: Record<string, unknown>) =>
  ({ type: "toolbar", ...message }) as Message;
const insert = (id: number, kind: "env" | "secret", name: string) =>
  msg({
    action: "insert",
    id,
    target: TARGET,
    candidates: CANDIDATES,
    kind,
    name,
  });
const add = (id: number, kind: "env" | "secret", name: string, value: string) =>
  msg({
    action: "add-insertable",
    id,
    target: TARGET,
    candidates: CANDIDATES,
    kind,
    name,
    value,
  });
const pick = (id: number) =>
  msg({ action: "pick", id, target: TARGET, candidates: CANDIDATES });

/** A controller over fakes that record everything */
function setup(
  options: Partial<ControllerOptions> = {},
  overrides: Partial<ControllerDeps> = {},
) {
  const pushes: ToolbarState[] = [];
  const replies: { id: number; result: PickInfo | ActionReply }[] = [];
  const observed: Observation[] = [];
  const statuses: { state: string; toolbar: boolean }[] = [];
  const calls: string[] = [];
  const page = { url: "http://localhost/a" };
  let controller: ToolbarController;
  const deps: ControllerDeps = {
    push: (state) => pushes.push(structuredClone(state)),
    reply: (id, result) =>
      replies.push({ id, result: structuredClone(result) }),
    currentUrl: async () => page.url,
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

describe("ToolbarController", () => {
  it("starts with the options' state and never sends secret values", () => {
    const { controller, last, noSecretLeaks } = setup();
    controller.loaded();
    assert.deepEqual(last(), {
      status: "recording",
      collapsed: false,
      position: null,
      steps: 0,
      environment: "dev",
      canAddVariables: true,
      variables: [
        { name: "testUser", value: "dev@example.com" },
        { name: "retries", value: "3" },
      ],
      secrets: [
        { name: "ADMIN_PASSWORD", set: true },
        { name: "API_TOKEN", set: false },
      ],
      secretsIgnored: true,
      resumeQuestion: false,
      nextScreenshot: "screenshot-1",
    });
    noSecretLeaks();
    controller.dispose();
  });

  it("pauses: mutes capture, reports paused and ignores tools", async () => {
    const { controller, last, statuses, calls, observed, replies } = setup();
    await controller.handle(msg({ action: "pause" }));
    assert.equal(controller.paused, true);
    assert.ok(calls.includes("mute"));
    assert.equal(last().status, "paused");
    assert.deepEqual(lastOf(statuses), { state: "paused", toolbar: true });

    calls.length = 0;
    await controller.handle(insert(1, "env", "testUser"));
    assert.deepEqual(calls, [], "nothing typed while paused");
    assert.deepEqual(observed, []);
    assert.equal(
      lastOf(replies)?.result.ok,
      false,
      "the view still gets a reply",
    );

    await controller.handle(msg({ action: "wait", kind: "idle" }));
    await controller.handle(
      msg({ action: "screenshot", name: "x", fullPage: false }),
    );
    assert.deepEqual(observed, []);
  });

  it("resumes on the same URL without asking", async () => {
    const { controller, last, statuses, calls } = setup();
    await controller.handle(msg({ action: "pause" }));
    await controller.handle(msg({ action: "resume" }));
    assert.equal(controller.paused, false);
    assert.ok(calls.includes("unmute"));
    assert.equal(last().status, "recording");
    assert.equal(last().resumeQuestion, false);
    assert.deepEqual(lastOf(statuses), { state: "recording", toolbar: true });
  });

  it("asks after resuming on another URL; yes writes a goto, no writes nothing", async () => {
    for (const add of [true, false]) {
      const { controller, last, page, observed } = setup();
      await controller.handle(msg({ action: "pause" }));
      page.url = "http://localhost/b";
      await controller.handle(msg({ action: "resume" }));
      assert.equal(last().resumeQuestion, true);
      await controller.handle(msg({ action: "resume-goto", add }));
      assert.equal(last().resumeQuestion, false);
      assert.deepEqual(
        observed,
        add ? [{ type: "goto", url: "http://localhost/b" }] : [],
      );
      // A second answer finds no question
      await controller.handle(msg({ action: "resume-goto", add: true }));
      assert.equal(observed.length, add ? 1 : 0);
    }
  });

  it("inserts a variable: types its value, then records the reference", async () => {
    const { controller, calls, observed, replies, noSecretLeaks } = setup();
    await controller.handle(insert(5, "env", "testUser"));
    assert.deepEqual(calls, ["type dev@example.com"]);
    assert.deepEqual(observed, [
      {
        type: "insert",
        locator: LOCATOR,
        value: { kind: "env", name: "testUser" },
      },
    ]);
    assert.deepEqual(replies, [{ id: 5, result: { ok: true } }]);
    noSecretLeaks();
  });

  it("inserts a set secret without sending its value to the page", async () => {
    const { controller, calls, observed, replies, noSecretLeaks } = setup();
    await controller.handle(insert(6, "secret", "ADMIN_PASSWORD"));
    assert.deepEqual(calls, [`type ${SECRET}`]);
    assert.deepEqual(observed, [
      {
        type: "insert",
        locator: LOCATOR,
        value: { kind: "secret", name: "ADMIN_PASSWORD" },
      },
    ]);
    assert.deepEqual(replies, [{ id: 6, result: { ok: true } }]);
    noSecretLeaks();
  });

  it("reports a field it couldn't type into and records nothing", async () => {
    const { controller, observed, replies } = setup(
      {},
      {
        type: async () => {
          throw new Error("not editable");
        },
      },
    );
    await controller.handle(insert(7, "env", "testUser"));
    assert.deepEqual(observed, []);
    assert.deepEqual(replies, [
      { id: 7, result: { ok: false, error: "Couldn't type into that field" } },
    ]);
  });

  it("rejects an element no locator identifies", async () => {
    const { controller, observed, replies, calls } = setup(
      {},
      { rank: async () => undefined },
    );
    await controller.handle(insert(8, "env", "testUser"));
    assert.deepEqual(calls, []);
    assert.deepEqual(observed, []);
    assert.deepEqual(replies, [
      {
        id: 8,
        result: {
          ok: false,
          error: "This element can't be identified uniquely",
        },
      },
    ]);
  });

  it("rejects inserting a secret that has no value (the view opens New secret instead)", async () => {
    const { controller, observed, replies, calls } = setup();
    await controller.handle(insert(9, "secret", "API_TOKEN"));
    assert.deepEqual(calls, []);
    assert.deepEqual(observed, []);
    assert.deepEqual(replies, [
      {
        id: 9,
        result: { ok: false, error: "Set a value for API_TOKEN first" },
      },
    ]);
  });

  it("adds a variable to the project, lists it and inserts it", async () => {
    const { controller, calls, observed, replies, last } = setup();
    await controller.handle(add(10, "env", "adminUser", "admin@example.com"));
    assert.deepEqual(calls, [
      "addVariable adminUser=admin@example.com",
      "type admin@example.com",
    ]);
    assert.deepEqual(observed, [
      {
        type: "insert",
        locator: LOCATOR,
        value: { kind: "env", name: "adminUser" },
      },
    ]);
    assert.deepEqual(replies, [{ id: 10, result: { ok: true } }]);
    assert.deepEqual(lastOf(last().variables), {
      name: "adminUser",
      value: "admin@example.com",
    });
  });

  it("shows name errors under the name field", async () => {
    const exists = setup(
      {},
      {
        addVariable: async (name) => {
          throw new ExistsError(`"${name}" already exists`);
        },
      },
    );
    await exists.controller.handle(add(11, "env", "adminUser", "x"));
    assert.deepEqual(exists.replies, [
      {
        id: 11,
        result: {
          ok: false,
          error: `"adminUser" already exists`,
          field: "name",
        },
      },
    ]);
    assert.deepEqual(exists.observed, []);

    const listed = setup();
    await listed.controller.handle(add(12, "env", "testUser", "x"));
    assert.deepEqual(listed.replies, [
      {
        id: 12,
        result: {
          ok: false,
          error: `"testUser" already exists`,
          field: "name",
        },
      },
    ]);
    assert.deepEqual(listed.calls, [], "nothing written");

    const invalid = setup(
      {},
      {
        setSecret: async () => {
          throw new Error(
            "Use letters, digits and _; a secret is UPPER_SNAKE_CASE.",
          );
        },
      },
    );
    await invalid.controller.handle(add(13, "secret", "bad name", NEW_SECRET));
    assert.deepEqual(invalid.replies, [
      {
        id: 13,
        result: {
          ok: false,
          error: "Use letters, digits and _; a secret is UPPER_SNAKE_CASE.",
          field: "name",
        },
      },
    ]);
    invalid.noSecretLeaks();
  });

  it("says so when samurai.config.ts can't be edited, and inserts nothing", async () => {
    const { controller, replies, observed, calls, last } = setup(
      {},
      {
        addVariable: async () => {
          throw new ConfigEditError("not a plain object");
        },
      },
    );
    await controller.handle(add(14, "env", "adminUser", "x"));
    assert.deepEqual(replies, [
      {
        id: 14,
        result: {
          ok: false,
          error:
            "samurai.config.ts can't be changed automatically. Add adminUser to environments.dev.variables yourself.",
        },
      },
    ]);
    assert.deepEqual(observed, []);
    assert.ok(!calls.some((call) => call.startsWith("type")));
    controller.loaded();
    assert.ok(!last().variables.some((v) => v.name === "adminUser"));
    controller.dispose();
  });

  it("refuses to add a variable when the recording has no environment", async () => {
    const { controller, replies, calls } = setup({ canAddVariables: false });
    await controller.handle(add(15, "env", "adminUser", "x"));
    assert.deepEqual(replies, [
      {
        id: 15,
        result: { ok: false, error: "This recording has no environment" },
      },
    ]);
    assert.deepEqual(calls, []);
  });

  it("adds a secret: writes it, lists it as set and types the given value", async () => {
    const { controller, calls, observed, replies, last, noSecretLeaks } =
      setup();
    await controller.handle(add(16, "secret", "API_TOKEN", NEW_SECRET));
    assert.deepEqual(calls, [
      `setSecret API_TOKEN=${NEW_SECRET}`,
      "secretAdded API_TOKEN",
      `type ${NEW_SECRET}`,
    ]);
    assert.deepEqual(observed, [
      {
        type: "insert",
        locator: LOCATOR,
        value: { kind: "secret", name: "API_TOKEN" },
      },
    ]);
    assert.deepEqual(replies, [{ id: 16, result: { ok: true } }]);
    assert.deepEqual(
      last().secrets.find((s) => s.name === "API_TOKEN"),
      { name: "API_TOKEN", set: true },
    );
    // A secret that already has a value is not overwritten from the panel
    await controller.handle(add(17, "secret", "ADMIN_PASSWORD", NEW_SECRET));
    assert.deepEqual(lastOf(replies), {
      id: 17,
      result: {
        ok: false,
        error: `"ADMIN_PASSWORD" already exists`,
        field: "name",
      },
    });
    noSecretLeaks();
  });

  it("never echoes a secret value in an error", async () => {
    const { controller, replies, noSecretLeaks } = setup(
      {},
      {
        setSecret: async (_name, value) => {
          throw new Error(`Could not write ${value}`);
        },
      },
    );
    await controller.handle(add(18, "secret", "NEW_ONE", NEW_SECRET));
    assert.equal(lastOf(replies)?.result.ok, false);
    noSecretLeaks();
  });

  it("answers a pick with what it found, then turns the assert into an expect step", async () => {
    const { controller, replies, observed } = setup();
    await controller.handle(pick(20));
    assert.deepEqual(replies, [{ id: 20, result: INFO }]);
    await controller.handle(
      msg({
        action: "assert",
        id: 20,
        target: TARGET,
        candidates: CANDIDATES,
        matcher: "toHaveText",
        expected: "Sign in",
        not: true,
      }),
    );
    assert.deepEqual(observed, [
      {
        type: "expect",
        locator: LOCATOR,
        not: true,
        expectation: { matcher: "toHaveText", expected: "Sign in" },
      },
    ]);
    assert.deepEqual(lastOf(replies), { id: 20, result: { ok: true } });
  });

  it("builds every matcher; Count uses the chosen count locator", async () => {
    const cases: [Record<string, unknown>, Observation][] = [
      [
        { matcher: "toBeVisible", not: false },
        {
          type: "expect",
          locator: LOCATOR,
          not: false,
          expectation: { matcher: "toBeVisible" },
        },
      ],
      [
        {
          matcher: "toHaveAttribute",
          attribute: "id",
          expected: "email",
          not: false,
        },
        {
          type: "expect",
          locator: LOCATOR,
          not: false,
          expectation: {
            matcher: "toHaveAttribute",
            name: "id",
            expected: "email",
          },
        },
      ],
      [
        { matcher: "toHaveCount", countIndex: 0, expected: "3", not: false },
        {
          type: "expect",
          locator: { chain: [COUNT_CALL], fallbacks: [] },
          not: false,
          expectation: { matcher: "toHaveCount", expected: 3 },
        },
      ],
    ];
    for (const [fields, expected] of cases) {
      const { controller, observed } = setup();
      await controller.handle(pick(21));
      await controller.handle(
        msg({
          action: "assert",
          id: 21,
          target: TARGET,
          candidates: CANDIDATES,
          ...fields,
        }),
      );
      assert.deepEqual(observed, [expected]);
    }
  });

  it("rejects an assert that doesn't match the pending pick", async () => {
    const { controller, replies, observed } = setup();
    await controller.handle(
      msg({
        action: "assert",
        id: 22,
        target: TARGET,
        candidates: CANDIDATES,
        matcher: "toBeVisible",
        not: false,
      }),
    );
    assert.deepEqual(observed, []);
    assert.equal(lastOf(replies)?.id, 22);
    assert.equal(lastOf(replies)?.result.ok, false);
  });

  it("answers an unidentifiable pick with the error", async () => {
    const { controller, replies } = setup({}, { rank: async () => undefined });
    await controller.handle(pick(23));
    assert.deepEqual(replies, [
      {
        id: 23,
        result: {
          ok: false,
          error: "This element can't be identified uniquely",
        },
      },
    ]);
  });

  it("adds one step when the same action arrives twice while the first is in flight", async () => {
    // Two inserts with the same id, the first held in `type`
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const typing = setup({}, { type: async () => gate });
    const first = typing.controller.handle(insert(25, "env", "testUser"));
    const second = typing.controller.handle(insert(25, "env", "testUser"));
    release();
    await Promise.all([first, second]);
    assert.equal(typing.observed.length, 1, "one insert step");
    assert.deepEqual(typing.replies, [{ id: 25, result: { ok: true } }]);

    // Two asserts with the same id (a double click on Add)
    const { controller, observed } = setup();
    await controller.handle(pick(24));
    const assertion = msg({
      action: "assert",
      id: 24,
      target: TARGET,
      candidates: CANDIDATES,
      matcher: "toBeVisible",
      not: false,
    });
    await Promise.all([
      controller.handle(assertion),
      controller.handle(assertion),
    ]);
    assert.equal(observed.length, 1, "one expect step");
  });

  it("processes a retry with the same id after a failed reply", async () => {
    let fail = true;
    const { controller, replies, observed } = setup(
      {},
      {
        type: async () => {
          if (fail) throw new Error("detached");
        },
      },
    );
    await controller.handle(insert(26, "env", "testUser"));
    assert.equal(lastOf(replies)?.result.ok, false);
    fail = false;
    await controller.handle(insert(26, "env", "testUser"));
    assert.deepEqual(lastOf(replies), { id: 26, result: { ok: true } });
    assert.equal(observed.length, 1);
  });

  it("adds wait steps with a toast", async () => {
    const { controller, observed, last } = setup();
    await controller.handle(msg({ action: "wait", kind: "idle" }));
    assert.deepEqual(last().toast?.text, "Wait step added");
    const firstToast = last().toast!.id;
    await controller.handle(msg({ action: "wait", kind: "time", ms: 2000 }));
    assert.notEqual(last().toast!.id, firstToast, "each toast has its own id");
    assert.deepEqual(observed, [
      { type: "wait-idle" },
      { type: "wait-time", ms: 2000 },
    ]);
  });

  it("adds screenshot steps and counts them for the next default name", async () => {
    const { controller, observed, last } = setup();
    controller.loaded();
    assert.equal(last().nextScreenshot, "screenshot-1");
    await controller.handle(
      msg({ action: "screenshot", name: "after sign in!", fullPage: true }),
    );
    assert.deepEqual(observed, [
      { type: "screenshot", name: "after-sign-in", fullPage: true },
    ]);
    assert.equal(last().toast?.text, "Screenshot step added");
    assert.equal(last().nextScreenshot, "screenshot-2");
    assert.equal(last().steps, 1);
    controller.dispose();

    const later = setup({ screenshots: 2 });
    later.controller.loaded();
    assert.equal(later.last().nextScreenshot, "screenshot-3");
    later.controller.dispose();
  });

  it("keeps the rail's position and collapsed state", async () => {
    const { controller, last } = setup();
    await controller.handle(msg({ action: "move", x: 40, y: 50 }));
    await controller.handle(msg({ action: "collapse", collapsed: true }));
    controller.loaded();
    assert.deepEqual(last().position, { x: 40, y: 50 });
    assert.equal(last().collapsed, true);
    controller.dispose();
  });

  it("stop ends the recording", async () => {
    const { controller, calls } = setup();
    await controller.handle(msg({ action: "stop" }));
    assert.deepEqual(calls, ["stop"]);
  });

  it("reports a page whose toolbar isn't ready 2 s after its load", (t: TestContext) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { controller, statuses } = setup();
    controller.loaded();
    t.mock.timers.tick(1999);
    assert.deepEqual(statuses, []);
    t.mock.timers.tick(1);
    assert.deepEqual(statuses, [{ state: "recording", toolbar: false }]);
    void controller.handle(msg({ action: "ready" }));
    assert.deepEqual(lastOf(statuses), { state: "recording", toolbar: true });
    controller.dispose();
  });

  it("counts a ready that came before the load, and extra readies change nothing", (t: TestContext) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { controller, statuses } = setup();
    // The toolbar draws at document start, before the load; Firefox also runs it in a transient about:blank
    void controller.handle(msg({ action: "ready" }));
    void controller.handle(msg({ action: "ready" }));
    controller.loaded();
    t.mock.timers.tick(5000);
    assert.deepEqual(statuses, []);
    // The next document is ready after its load
    controller.loaded();
    void controller.handle(msg({ action: "ready" }));
    t.mock.timers.tick(5000);
    assert.deepEqual(statuses, []);
    controller.dispose();
  });

  it("drops a pick that is pending when the page loads, and pushes the state", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { controller, replies, pushes, observed } = setup(
      {},
      {
        rank: async () => {
          await gate;
          return LOCATOR;
        },
      },
    );
    const picking = controller.handle(pick(30));
    const before = pushes.length;
    controller.loaded();
    assert.equal(pushes.length, before + 1, "the new page gets the state");
    release();
    await picking;
    assert.deepEqual(replies, [], "the late reply is not sent");
    await controller.handle(
      msg({
        action: "assert",
        id: 30,
        target: TARGET,
        candidates: CANDIDATES,
        matcher: "toBeVisible",
        not: false,
      }),
    );
    assert.deepEqual(observed, [], "no stale step");
    controller.dispose();
  });

  it("drops the toast on a new page so it isn't shown again", async () => {
    const { controller, last } = setup();
    await controller.handle(msg({ action: "wait", kind: "idle" }));
    assert.ok(last().toast);
    controller.loaded();
    assert.equal(last().toast, undefined);
    controller.dispose();
  });

  it("mutes the new page's capture while paused", async () => {
    const { controller, calls } = setup();
    await controller.handle(msg({ action: "pause" }));
    calls.length = 0;
    controller.loaded();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(calls, ["mute"]);
    controller.dispose();
  });

  describe("fix round 1", () => {
    const failingType = {
      type: async () => {
        throw new Error("not editable");
      },
    };

    it("shows a toast when typing fails, since the panel is gone by then", async () => {
      const { controller, last, replies } = setup({}, failingType);
      await controller.handle(insert(40, "env", "testUser"));
      assert.equal(last().toast?.text, "Couldn't type into that field");
      assert.deepEqual(replies, [
        {
          id: 40,
          result: { ok: false, error: "Couldn't type into that field" },
        },
      ]);

      const added = setup({}, failingType);
      await added.controller.handle(add(41, "env", "adminUser", "x"));
      assert.equal(
        added.last().toast?.text,
        "Saved adminUser, but couldn't type into that field",
      );
      assert.ok(
        added.last().variables.some((v) => v.name === "adminUser"),
        "the saved variable is listed",
      );
    });

    it("decides at receive time: a repeat in flight or after ok is refused, a retry after a failure is accepted", async () => {
      let fail = true;
      const { controller, observed, replies } = setup(
        {},
        {
          type: async () => {
            if (fail) throw new Error("detached");
          },
        },
      );
      const first = insert(42, "env", "testUser");
      assert.equal(controller.accept(first), true);
      assert.equal(controller.accept(first), false, "in flight");
      await controller.handle(first);
      assert.equal(lastOf(replies)?.result.ok, false);
      fail = false;
      assert.equal(
        controller.accept(first),
        true,
        "a retry after { ok: false }",
      );
      await controller.handle(first);
      assert.deepEqual(lastOf(replies), { id: 42, result: { ok: true } });
      assert.equal(controller.accept(first), false, "already answered ok");
      assert.equal(observed.length, 1);
      assert.equal(
        controller.accept(msg({ action: "wait", kind: "idle" })),
        true,
        "messages without an id always pass",
      );
    });

    it("never sends back a secret that a picked field holds (Review Focus 4)", async () => {
      const { controller, replies, observed, noSecretLeaks } = setup(
        {},
        {
          inspect: async (): Promise<Inspection> => ({
            info: {
              ...INFO,
              text: "",
              value: SECRET,
              attributes: [
                { name: "id", value: "pw" },
                { name: "value", value: SECRET },
              ],
              first: { matcher: "toHaveValue", expected: SECRET },
            },
            counts: [],
          }),
        },
      );
      await controller.handle(pick(43));
      const reply = lastOf(replies)!.result as PickInfo & { ok: true };
      assert.equal(reply.value, undefined);
      assert.deepEqual(reply.first, { matcher: "toBeVisible" });
      assert.deepEqual(reply.attributes, [{ name: "id", value: "pw" }]);
      await controller.handle(
        msg({
          action: "assert",
          id: 43,
          target: TARGET,
          candidates: CANDIDATES,
          matcher: "toBeVisible",
          not: false,
        }),
      );
      assert.ok(!JSON.stringify(observed).includes(SECRET));
      noSecretLeaks();
    });

    it("reports a page whose ready never came, even after a stray ready from the last one", (t: TestContext) => {
      t.mock.timers.enable({ apis: ["setTimeout"] });
      const { controller, statuses } = setup();
      controller.loaded();
      void controller.handle(
        msg({ action: "ready", url: "http://localhost/a" }),
      );
      // A stray extra ready from the old document, then the navigation
      void controller.handle(
        msg({ action: "ready", url: "http://localhost/a" }),
      );
      controller.navigating();
      // Firefox's transient about:blank
      void controller.handle(msg({ action: "ready", url: "about:blank" }));
      controller.loaded();
      t.mock.timers.tick(2000);
      assert.deepEqual(statuses, [{ state: "recording", toolbar: false }]);
      controller.dispose();
    });

    it("tells the recorder a secret was added before it types it, even when typing fails", async () => {
      const { controller, calls } = setup(
        {},
        {
          type: async (_locator, value) => {
            calls.push(`type ${value}`);
            throw new Error("not editable");
          },
        },
      );
      await controller.handle(add(44, "secret", "NEW_ONE", NEW_SECRET));
      assert.deepEqual(calls, [
        `setSecret NEW_ONE=${NEW_SECRET}`,
        "secretAdded NEW_ONE",
        `type ${NEW_SECRET}`,
      ]);
    });
  });
});
