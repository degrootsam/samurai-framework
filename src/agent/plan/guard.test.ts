import { test } from "node:test";
import assert from "node:assert/strict";
import type { RouteHandler } from "../../network/route.js";
import { installPlanGuard } from "./guard.js";
import type { PlanSendOutcome, PlanSendQuestion } from "./send-question.js";

interface Options {
  /** What the person answers; left out means nobody can be asked */
  answers?: (string | Error)[];
  reason?: string;
}

async function setup(options: Options = {}) {
  let pattern: unknown;
  let handler: RouteHandler | undefined;
  const outcomes: PlanSendOutcome[] = [];
  const asked: PlanSendQuestion[] = [];
  const log: string[] = [];
  const answers = options.answers;
  await installPlanGuard(
    {
      route: async (p: unknown, h: RouteHandler) => {
        pattern = p;
        handler = h;
      },
      url: async () => "http://x.test/form?secret=1#top",
      evaluate: async () => "Send reset link",
      startBodyCollection: async () => undefined,
      waitForResponse: async () => {
        throw new Error("no response in the unit test");
      },
    } as never,
    (outcome) => outcomes.push(outcome),
    {
      ...(answers && {
        ask: async (question: PlanSendQuestion) => {
          asked.push(question);
          log.push("asked");
          const next = answers.shift();
          if (next instanceof Error) throw next;
          return next ?? "decline";
        },
      }),
      reason: () => options.reason,
    },
  );
  const send = async (
    method: string,
    url = "http://x.test/api/feedback?a=1",
    resourceType = "fetch",
  ) =>
    handler!({
      request: () => ({
        id: "r1",
        method,
        url,
        resourceType,
        navigation: resourceType === "document" ? "n1" : null,
      }),
      continue: async () => void log.push("continue"),
      abort: async () => void log.push("abort"),
      fulfill: async (o: { status: number }) =>
        void log.push(`fulfill ${o.status}`),
    } as never);
  return { pattern: () => pattern, outcomes, asked, log, send };
}

test("the guard routes every url", async () => {
  assert.equal((await setup()).pattern(), "**/*");
});

test("GET, HEAD and OPTIONS continue without asking", async () => {
  const { send, log, outcomes, asked } = await setup({ answers: [] });
  for (const method of ["GET", "head", "OPTIONS"]) await send(method);
  assert.deepEqual(log, ["continue", "continue", "continue"]);
  assert.deepEqual(outcomes, []);
  assert.deepEqual(asked, []);
});

test("a declined request is aborted, never sent, and reported with its path only", async () => {
  const { send, log, outcomes } = await setup({
    answers: ["decline", "no", "", "SEND IT"],
  });
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) await send(method);
  assert.deepEqual(log, [
    "asked",
    "abort",
    "asked",
    "abort",
    "asked",
    "abort",
    "asked",
    "abort",
  ]);
  assert.deepEqual(
    outcomes.map((o) => [o.outcome, o.method, o.url]),
    ["POST", "PUT", "PATCH", "DELETE"].map((m) => [
      "declined",
      m,
      "http://x.test/api/feedback",
    ]),
  );
});

test("the question carries the request, the page, the label and the reason, without queries", async () => {
  const { send, asked } = await setup({
    answers: ["decline"],
    reason: "see the answer",
  });
  await send("POST", "http://x.test/password/reset?token=abc");
  assert.deepEqual(asked, [
    {
      method: "POST",
      url: "http://x.test/password/reset",
      page: "http://x.test/form",
      label: "Send reset link",
      reason: "see the answer",
    },
  ]);
});

test("only an answer of send lets that one request continue, and it is held until then", async () => {
  const { send, log, outcomes } = await setup({ answers: ["send"] });
  await send("POST");
  assert.deepEqual(log, ["asked", "continue"]);
  assert.equal(outcomes[0]?.outcome, "sent");
});

test("a second form asks again", async () => {
  const { send, log, asked } = await setup({ answers: ["send", "decline"] });
  await send("POST");
  await send("POST");
  assert.equal(asked.length, 2);
  assert.deepEqual(log, ["asked", "continue", "asked", "abort"]);
});

test("nobody to ask: aborted as unasked", async () => {
  const { send, log, outcomes } = await setup();
  await send("POST");
  assert.deepEqual(log, ["abort"]);
  assert.equal(outcomes[0]?.outcome, "unasked");
});

test("a question that fails (the run ended) never lets the request through", async () => {
  const { send, log, outcomes } = await setup({
    answers: [new Error("agent run ended")],
  });
  await send("POST");
  assert.deepEqual(log, ["asked", "abort"]);
  assert.equal(outcomes[0]?.outcome, "declined");
});

test("a held request is not answered before the person answers", async () => {
  let answer!: (text: string) => void;
  let handler: RouteHandler | undefined;
  const log: string[] = [];
  await installPlanGuard(
    {
      route: async (_p: unknown, h: RouteHandler) => void (handler = h),
      url: async () => "http://x.test/",
      evaluate: async () => null,
      startBodyCollection: async () => undefined,
      waitForResponse: async () => {
        throw new Error("none");
      },
    } as never,
    () => undefined,
    { ask: () => new Promise<string>((resolve) => (answer = resolve)) },
  );
  const held = handler!({
    request: () => ({
      id: "r",
      method: "POST",
      url: "http://x.test/a",
      resourceType: "fetch",
      navigation: null,
    }),
    continue: async () => void log.push("continue"),
    abort: async () => void log.push("abort"),
    fulfill: async () => void log.push("fulfill"),
  } as never);
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(log, []);
  answer("send");
  await held;
  assert.deepEqual(log, ["continue"]);
});

test("a declined form submit (a document request) gets an empty 204, so the page stays where it is", async () => {
  const { send, log, outcomes } = await setup({ answers: ["decline"] });
  await send("POST", "http://x.test/submit", "document");
  assert.deepEqual(log, ["asked", "fulfill 204"]);
  assert.equal(outcomes[0]?.url, "http://x.test/submit");
});
