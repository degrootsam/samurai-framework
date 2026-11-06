import { test } from "node:test";
import assert from "node:assert/strict";
import type { RouteHandler } from "../../network/route.js";
import { installPlanGuard } from "./guard.js";

async function setup() {
  let pattern: unknown;
  let handler: RouteHandler | undefined;
  const blocked: string[] = [];
  await installPlanGuard(
    {
      route: async (p: unknown, h: RouteHandler) => {
        pattern = p;
        handler = h;
      },
    } as never,
    (what) => blocked.push(what),
  );
  const answers: string[] = [];
  const send = async (
    method: string,
    url = "http://x.test/api/feedback?a=1",
    resourceType = "fetch",
  ) =>
    handler!({
      request: () => ({
        method,
        url,
        resourceType,
        navigation: resourceType === "document" ? "n1" : null,
      }),
      continue: async () => void answers.push("continue"),
      abort: async () => void answers.push("abort"),
      fulfill: async (o: { status: number }) =>
        void answers.push(`fulfill ${o.status}`),
    } as never);
  return { pattern: () => pattern, blocked, answers, send };
}

test("the guard routes every url", async () => {
  assert.equal((await setup()).pattern(), "**/*");
});

test("GET, HEAD and OPTIONS continue", async () => {
  const { send, answers, blocked } = await setup();
  for (const method of ["GET", "head", "OPTIONS"]) await send(method);
  assert.deepEqual(answers, ["continue", "continue", "continue"]);
  assert.deepEqual(blocked, []);
});

test("anything else is aborted and reported with its path, without the query", async () => {
  const { send, answers, blocked } = await setup();
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) await send(method);
  assert.deepEqual(answers, ["abort", "abort", "abort", "abort"]);
  assert.deepEqual(blocked, [
    "POST /api/feedback",
    "PUT /api/feedback",
    "PATCH /api/feedback",
    "DELETE /api/feedback",
  ]);
});

test("a form submit (a document request) gets an empty 204, so the page stays where it is", async () => {
  const { send, answers, blocked } = await setup();
  await send("POST", "http://x.test/submit", "document");
  assert.deepEqual(answers, ["fulfill 204"]);
  assert.deepEqual(blocked, ["POST /submit"]);
});
