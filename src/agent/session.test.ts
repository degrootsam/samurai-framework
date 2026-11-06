import { test } from "node:test";
import assert from "node:assert/strict";
import { AgentController } from "./session.js";
import type { AgentEvent, AgentResult } from "./types.js";

const result: AgentResult = {
  reason: "finished",
  file: "a.spec.ts",
  test: "t",
  steps: 0,
  secrets: [],
  tokens: 0,
};
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const hooks = () => {
  const calls: string[] = [];
  return {
    calls,
    hooks: {
      begin: async () => void calls.push("begin"),
      end: async () => (calls.push("end"), "note"),
    },
  };
};

test("ended is emitted once and the event stream then closes", async () => {
  const controller = new AgentController(hooks().hooks);
  controller.emit({ type: "plan", text: "go" });
  controller.end(result);
  controller.end({ ...result, reason: "error" });
  controller.emit({ type: "plan", text: "late" });
  const seen: AgentEvent[] = [];
  for await (const event of controller.events) seen.push(event);
  assert.deepEqual(
    seen.map((e) => e.type),
    ["plan", "ended"],
  );
  assert.equal(seen[1]!.type === "ended" && seen[1]!.result.reason, "finished");
});

test("a listener that throws does not stop the run", () => {
  const controller = new AgentController(hooks().hooks, () => {
    throw new Error("boom");
  });
  assert.doesNotThrow(() => controller.emit({ type: "plan", text: "x" }));
});

test("a paused run holds the gate until it is resumed", async () => {
  const controller = new AgentController(hooks().hooks);
  controller.pause();
  let open = false;
  const waiting = controller.gate().then(() => (open = true));
  await pause(30);
  assert.equal(open, false);
  controller.resume();
  await waiting;
  assert.equal(open, true);
});

test("stop releases a held gate with an error and rejects open questions", async () => {
  const controller = new AgentController(hooks().hooks);
  controller.pause();
  const held = assert.rejects(controller.gate(), /ended: stopped/);
  const asked = assert.rejects(controller.ask("Which?"), /agent run ended/);
  controller.stop();
  await held;
  await asked;
  assert.equal(controller.stopReason, "stopped");
});

test("takeOver begins the person's recording and handBack ends it, with a note", async () => {
  const { hooks: h, calls } = hooks();
  const controller = new AgentController(h);
  controller.takeOver();
  let open = false;
  const waiting = controller.gate().then(() => (open = true));
  await pause(30);
  assert.equal(open, false);
  controller.handBack();
  await waiting;
  assert.deepEqual(calls, ["begin", "end"]);
  assert.equal(controller.takeNote(), "note");
  assert.equal(controller.takeNote(), undefined);
});

test("questions get ids, are answered by id, and an unknown id is an error", async () => {
  const controller = new AgentController(hooks().hooks);
  const answer = controller.ask("Which account?", ["a", "b"]);
  const asked = (await take(controller, 1).next()).value as Extract<
    AgentEvent,
    { type: "question" }
  >;
  assert.deepEqual(
    [asked.id, asked.question, asked.options],
    ["q1", "Which account?", ["a", "b"]],
  );
  assert.throws(() => controller.answer("q9", "x"), /no open question q9/);
  controller.answer("q1", "b");
  assert.equal(await answer, "b");
});

async function* take(controller: AgentController, count: number) {
  let n = 0;
  for await (const event of controller.events) {
    yield event;
    if (++n === count) return;
  }
}

test("time spent waiting for an answer, paused or taken over is not active time", async () => {
  const controller = new AgentController(hooks().hooks);
  void controller.ask("Wait?").catch(() => undefined);
  await pause(120);
  controller.answer("q1", "ok");
  const afterAsk = controller.activeMs();
  assert.ok(
    afterAsk < 80,
    `waiting for an answer is not counted (${afterAsk})`,
  );
  controller.pause();
  await pause(120);
  controller.resume();
  assert.ok(controller.activeMs() < 100, "paused time is not counted");
  controller.takeOver();
  await pause(120);
  controller.handBack();
  await controller.settle();
  assert.ok(controller.activeMs() < 140, "time taken over is not counted");
});

test("the time limit aborts the run with its own reason", async () => {
  const controller = new AgentController(hooks().hooks);
  const stop = controller.watchTime(60);
  await pause(250);
  stop();
  assert.equal(controller.stopReason, "time-limit");
  assert.equal(controller.signal.aborted, true);
});

test("the time limit does not run out while a question is open", async () => {
  const controller = new AgentController(hooks().hooks);
  const stop = controller.watchTime(60);
  void controller.ask("Still there?").catch(() => undefined);
  await pause(250);
  stop();
  assert.equal(controller.stopReason, undefined);
});
