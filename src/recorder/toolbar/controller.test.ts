import assert from "node:assert/strict";
import { describe, it, type TestContext } from "node:test";
import {
  TARGET,
  CANDIDATES,
  LOCATOR,
  lastOf,
  msg,
  insert,
  pick,
  setup,
} from "./controller-fixture.js";

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
      inputs: [{ name: "email", value: "a@b.c" }],
      secretsIgnored: true,
      resumeQuestion: false,
      nextScreenshot: "screenshot-1",
      warnings: [],
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

  it("keeps a wait for time between 0.1 and 60 seconds", async () => {
    const { controller, observed } = setup();
    for (const ms of [5, 100, 1234.4, 60000, 3600000, -1, Number.NaN])
      await controller.handle(msg({ action: "wait", kind: "time", ms }));
    assert.deepEqual(
      observed.map((o) => (o.type === "wait-time" ? o.ms : o.type)),
      [100, 100, 1234, 60000, 60000],
    );
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

  it("stops waiting for a pick whose commands are never answered once the page is left (Chrome)", async () => {
    const { controller, replies } = setup(
      {},
      { rank: () => new Promise<never>(() => {}) },
    );
    const picking = controller.handle(pick(31));
    controller.navigating();
    await picking; // resolves although rank never does
    assert.deepEqual(replies, []);
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
  });
});

describe("files", () => {
  it("shows the file being saved, then clears it", () => {
    const { controller, pushes } = setup();
    controller.saving("avatar.png");
    assert.equal(lastOf(pushes)?.saving, "avatar.png");
    controller.saving(undefined);
    assert.equal(lastOf(pushes)?.saving, undefined);
  });

  it("keeps warnings until each is dismissed, also across page loads", async () => {
    const { controller, pushes } = setup();
    controller.warn("big.mov is 300 MB.");
    controller.warn("huge.iso is 4 GB.");
    controller.loaded();
    const warnings = lastOf(pushes)!.warnings;
    assert.deepEqual(
      warnings.map((w) => w.text),
      ["big.mov is 300 MB.", "huge.iso is 4 GB."],
    );
    await controller.handle(msg({ action: "dismiss", id: warnings[0]!.id }));
    assert.deepEqual(
      lastOf(pushes)!.warnings.map((w) => w.text),
      ["huge.iso is 4 GB."],
    );
    controller.dispose();
  });
});
