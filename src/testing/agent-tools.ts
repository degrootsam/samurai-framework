import { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { Browser } from "../browser/browser.js";
import type Page from "../browser/page.js";
import { resetSecrets } from "../config/mask.js";
import { StepRecorder } from "../agent/recording.js";
import { Snapshotter } from "../agent/snapshot.js";
import type { ToolContext, ToolResult } from "../agent/tools/context.js";
import { createTools } from "../agent/tools/index.js";
import { OriginPolicy } from "../agent/tools/origins.js";
import type { AgentEvent } from "../agent/types.js";
import { parseSpec } from "../steps/parse.js";
import { testBrowser } from "./test-browser.js";

export const SECRET = "s3cr3t-Value-42";
export const OPTIONS = { timeout: 60000 };

const PAGE = `<!doctype html><title>Shop</title>
  <h1>Sign in</h1>
  <label for="email">Email</label><input id="email" type="email">
  <label for="pw">Password</label><input id="pw" type="password">
  <label for="key">API key</label><input id="key" type="text">
  <label><input type="checkbox" id="agree"> I agree</label>
  <select id="country" aria-label="Country"><option value="nl">Netherlands</option><option value="be">Belgium</option></select>
  <button id="go">Continue</button> <button disabled>Locked</button>
  <p id="note">Ready to go</p>
  <a href="/next">Next page</a>`;

export const text = (result: ToolResult) =>
  result.ok ? result.message : result.error;

const listen = (body: string) =>
  new Promise<[Server, string]>((resolve) => {
    const server = createServer((request, response) => {
      response.setHeader("content-type", "text/html");
      response.end(request.url === "/next" ? "<h1>Next</h1>" : body);
    }).listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      resolve([server, `http://127.0.0.1:${port}`]);
    });
  });

/**
 * Registers the hooks of a browser test file for the agent's tools: a browser, two local sites (the shop the
 * tools may use and another origin) and `setup`, which makes a fresh run with scripted answers to `ask`.
 */
export function agentToolsFixture(port: number) {
  let browser: Browser;
  let page!: Page;
  let app: Server;
  let other: Server;
  let appOrigin = "";
  let otherOrigin = "";
  const dir = mkdtempSync(path.join(os.tmpdir(), "agent-tools-"));
  let counter = 0;

  before(async () => {
    [app, appOrigin] = await listen(PAGE);
    [other, otherOrigin] = await listen("<h1>Elsewhere</h1>");
    ({ browser, page } = await Browser.launch(testBrowser(), {
      port,
      headless: true,
    }));
  });

  after(async () => {
    resetSecrets();
    await browser?.close();
    app?.close();
    other?.close();
  });

  async function setup(
    overrides: Partial<ToolContext> & { answers?: string[] } = {},
  ) {
    await page.navigateTo("about:blank", "complete");
    const file = path.join(dir, `run-${++counter}.spec.ts`);
    const events: AgentEvent[] = [];
    const questions: string[] = [];
    const answers = [...(overrides.answers ?? [])];
    const finished: string[] = [];
    const context: ToolContext = {
      page,
      snapshots: new Snapshotter(page, { secretFields: ["#key"] }),
      steps: new StepRecorder({
        file,
        create: "t",
        baseURL: appOrigin,
        onStep: (event, code, source) =>
          events.push({ type: "step", event, ...(code && { code }), source }),
      }),
      origins: new OriginPolicy([appOrigin]),
      secrets: {
        allowed: ["PASSWORD"],
        get: (name) => (name === "PASSWORD" ? SECRET : undefined),
      },
      vision: false,
      actionTimeout: 1500,
      ask: async (question) => {
        questions.push(question);
        return answers.shift() ?? "deny";
      },
      finish: (summary) => finished.push(summary),
      emit: (event) => events.push(event),
      secretOnScreen: false,
      ...overrides,
    };
    const tools = new Map(
      createTools(context).map((tool) => [tool.name, tool]),
    );
    const results: ToolResult[] = [];
    const call = async (name: string, args: unknown) => {
      const result = await tools.get(name)!.run(args);
      results.push(result);
      return result;
    };
    const steps = () => {
      const tests = parseSpec(readFileSync(file, "utf8"));
      assert.equal(tests.length, 1, "the file parses and holds the test");
      return tests[0]!.steps.map(({ step }) => step);
    };
    const ref = async (pattern: RegExp) => {
      const result = await call("snapshot", {});
      assert.ok(result.ok);
      const found = pattern.exec((result as { message: string }).message);
      assert.ok(found, `${pattern} is in the snapshot`);
      return found[1]!;
    };
    return {
      file,
      events,
      questions,
      finished,
      context,
      call,
      steps,
      results,
      ref,
    };
  }

  return {
    setup,
    page: () => page,
    appOrigin: () => appOrigin,
    otherOrigin: () => otherOrigin,
  };
}
