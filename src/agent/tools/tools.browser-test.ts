import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { Browser } from "../../browser/browser.js";
import type Page from "../../browser/page.js";
import { resetSecrets } from "../../config/mask.js";
import { testBrowser } from "../../testing/test-browser.js";
import { parseSpec } from "../../steps/parse.js";
import { StepRecorder } from "../recording.js";
import { Snapshotter } from "../snapshot.js";
import type { AgentEvent } from "../types.js";
import type { ToolContext, ToolResult } from "./context.js";
import { createTools } from "./index.js";
import { OriginPolicy } from "./origins.js";

const SECRET = "s3cr3t-Value-42";
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

let browser: Browser;
let page: Page;
let app: Server;
let other: Server;
let appOrigin: string;
let otherOrigin: string;
const dir = mkdtempSync(path.join(os.tmpdir(), "agent-tools-"));

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

before(async () => {
  [app, appOrigin] = await listen(PAGE);
  [other, otherOrigin] = await listen("<h1>Elsewhere</h1>");
  ({ browser, page } = await Browser.launch(testBrowser(), {
    port: 9602,
    headless: true,
  }));
});

after(async () => {
  resetSecrets();
  await browser?.close();
  app?.close();
  other?.close();
});

const OPTIONS = { timeout: 60000 };
let counter = 0;

/** A fresh run: its own spec file, events and scripted answers to `ask` */
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
  const tools = new Map(createTools(context).map((tool) => [tool.name, tool]));
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

const text = (result: ToolResult) =>
  result.ok ? result.message : result.error;

test(
  "navigate and act write typed steps, and the file is valid after every call",
  OPTIONS,
  async () => {
    const run = await setup();
    const opened = await run.call("navigate", { url: "/" });
    assert.equal(opened.ok, true, text(opened));
    assert.deepEqual(run.steps(), [{ kind: "goto", url: "/" }]);

    const email = await run.ref(/\[(e\d+)\] textbox "Email"/);
    const kinds = [
      ["fill", email, "ann@example.com"],
      ["check", await run.ref(/\[(e\d+)\] checkbox "I agree"/)],
      ["select", await run.ref(/\[(e\d+)\] combobox "Country"/), "Belgium"],
      ["hover", await run.ref(/\[(e\d+)\] button "Continue"/)],
      ["dblclick", await run.ref(/\[(e\d+)\] button "Continue"/)],
      ["press", email, "Tab"],
      ["clear", email],
      ["uncheck", await run.ref(/\[(e\d+)\] checkbox "I agree"/)],
      ["click", await run.ref(/\[(e\d+)\] button "Continue"/)],
    ] as const;
    let expected = 1;
    for (const [kind, target, value] of kinds) {
      const result = await run.call("act", {
        kind,
        target,
        ...(value !== undefined && { value }),
      });
      assert.equal(result.ok, true, text(result));
      expected++;
      assert.equal(run.steps().length, expected, `${kind} wrote one step`);
      assert.ok(run.steps().every((step) => step.kind !== "custom"));
    }
    assert.deepEqual(
      run.steps().map((step) => step.kind),
      [
        "goto",
        "fill",
        "check",
        "selectOption",
        "hover",
        "dblclick",
        "press",
        "clear",
        "uncheck",
        "click",
      ],
    );
    const source = readFileSync(run.file, "utf8");
    assert.match(
      source,
      /getByRole\("button", \{ name: "Continue" \}\)[^\n]*\.click\(\)/,
    );
    assert.match(source, /selectOption\("Belgium"\)/);
    assert.equal(await page.getByLabel("Email").inputValue(), "");
    assert.equal(await page.getByLabel("I agree").isChecked(), false);
    assert.equal(
      run.events.filter((e) => e.type === "tool-call").length > 10,
      true,
    );
  },
);

test("a step is only written when the action worked", OPTIONS, async () => {
  const run = await setup();
  await run.call("navigate", { url: "/" });
  const locked = await run.ref(/\[(e\d+)\] button "Locked" disabled/);
  const before = readFileSync(run.file, "utf8");
  const result = await run.call("act", { kind: "click", target: locked });
  assert.equal(result.ok, false);
  assert.match(text(result), /^act\(\): /);
  assert.equal(readFileSync(run.file, "utf8"), before);
});

test(
  "a stale, unknown or malformed reference is a precise error and writes nothing",
  OPTIONS,
  async () => {
    const run = await setup();
    await run.call("navigate", { url: "/" });
    const link = await run.ref(/\[(e\d+)\] link "Next page"/);
    const before = readFileSync(run.file, "utf8");
    await page.evaluate("document.querySelector('a').remove()");
    assert.match(
      text(await run.call("act", { kind: "click", target: link })),
      new RegExp(`${link} is no longer on the page`),
    );
    assert.match(
      text(await run.call("act", { kind: "click", target: "e9999" })),
      /e9999 does not exist/,
    );
    assert.match(
      text(await run.call("act", { kind: "click", target: "#go" })),
      /not a snapshot reference/,
    );
    await run.call("snapshot", {});
    assert.match(
      text(await run.call("act", { kind: "click", target: link })),
      /was in an earlier snapshot/,
    );
    assert.equal(readFileSync(run.file, "utf8"), before);
  },
);

test(
  "arguments are validated with messages the model can act on",
  OPTIONS,
  async () => {
    const run = await setup();
    await run.call("navigate", { url: "/" });
    const email = await run.ref(/\[(e\d+)\] textbox "Email"/);
    assert.match(
      text(await run.call("act", { kind: "wave", target: email })),
      /act\(\): invalid arguments \(kind: /,
    );
    assert.match(
      text(await run.call("act", { kind: "fill", target: email })),
      /fill needs a value/,
    );
    assert.match(
      text(await run.call("act", { kind: "click", target: email, value: "x" })),
      /click takes no value/,
    );
    assert.match(
      text(
        await run.call("expect", {
          target: email,
          matcher: "toHaveCount",
          expected: "1",
        }),
      ),
      /invalid arguments \(matcher: /,
    );
    assert.match(
      text(await run.call("expect", { target: email, matcher: "toHaveText" })),
      /toHaveText needs expected/,
    );
    assert.match(
      text(
        await run.call("expect", {
          target: email,
          matcher: "toHaveURL",
          expected: "/",
        }),
      ),
      /about the page/,
    );
    assert.equal(run.steps().length, 1);
  },
);

test(
  "navigate keeps to the allowed origins and asks about others",
  OPTIONS,
  async () => {
    const run = await setup({ answers: ["deny", "allow"] });
    await run.call("navigate", { url: "/" });
    const refused = await run.call("navigate", { url: `${otherOrigin}/` });
    assert.equal(refused.ok, false);
    assert.match(text(refused), /not allowed; the person declined/);
    assert.equal(run.questions.length, 1);
    assert.ok(run.questions[0]!.includes(otherOrigin));
    assert.equal(await page.url(), `${appOrigin}/`);
    assert.equal(run.steps().length, 1);

    const allowed = await run.call("navigate", { url: `${otherOrigin}/` });
    assert.equal(allowed.ok, true, text(allowed));
    assert.equal(await page.url(), `${otherOrigin}/`);
    assert.equal(run.steps().length, 2);
    assert.equal(run.steps()[1]!.kind, "goto");

    // asked once: the origin stays allowed for the run
    assert.equal(
      (await run.call("navigate", { url: `${otherOrigin}/next` })).ok,
      true,
    );
    assert.equal(run.questions.length, 2);

    for (const url of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "data:text/html,hi",
    ]) {
      const result = await run.call("navigate", { url });
      assert.equal(result.ok, false);
      assert.match(text(result), /only http and https/);
    }
  },
);

test(
  "a secret the caller did not allow is refused, and an unset one says so",
  OPTIONS,
  async () => {
    const run = await setup({
      secrets: {
        allowed: ["PASSWORD", "TOKEN"],
        get: (name) => (name === "PASSWORD" ? SECRET : undefined),
      },
    });
    await run.call("navigate", { url: "/" });
    const refused = await run.call("useSecret", { name: "ADMIN_PASSWORD" });
    assert.match(
      text(refused),
      /ADMIN_PASSWORD is not available to the agent; available: PASSWORD, TOKEN/,
    );
    assert.match(
      text(await run.call("useSecret", { name: "TOKEN" })),
      /TOKEN has no value in this environment/,
    );
    assert.equal(run.steps().length, 1);
  },
);

test(
  "useSecret fills the focused field locally and the value appears nowhere",
  OPTIONS,
  async () => {
    const run = await setup({ vision: true });
    await run.call("navigate", { url: "/" });
    assert.match(
      text(await run.call("useSecret", { name: "PASSWORD" })),
      /no field has focus/,
    );

    const password = await run.ref(/\[(e\d+)\] textbox "Password"/);
    await run.call("act", { kind: "click", target: password });
    const filled = await run.call("useSecret", { name: "PASSWORD" });
    assert.equal(filled.ok, true, text(filled));
    assert.equal(await page.getByLabel("Password").inputValue(), SECRET);

    // the typed step reads the secret by name
    assert.match(readFileSync(run.file, "utf8"), /fill\(secrets\.PASSWORD\)/);
    // a password field cannot be filled with text the model typed, nor its value checked
    assert.match(
      text(
        await run.call("act", {
          kind: "fill",
          target: password,
          value: "guess",
        }),
      ),
      /holds a secret/,
    );
    assert.match(
      text(
        await run.call("expect", {
          target: password,
          matcher: "toHaveValue",
          expected: "x",
        }),
      ),
      /holds a secret/,
    );

    // a field the caller marked secret, and one that was typed into with a secret: snapshots show a mask
    const key = await run.ref(/\[(e\d+)\] textbox "API key"/);
    await run.call("act", { kind: "click", target: key });
    await run.call("useSecret", { name: "PASSWORD" });
    const snapshot = text(await run.call("snapshot", {}));
    assert.match(snapshot, /textbox "Password" value="••••"/);
    assert.match(snapshot, /textbox "API key" value="••••"/);

    // the secret is in no tool result and no event, and images are off once it may be on screen
    const everything = JSON.stringify([run.results, run.events]);
    assert.equal(everything.includes(SECRET), false);
    assert.equal(readFileSync(run.file, "utf8").includes(SECRET), false);
    assert.match(
      text(await run.call("screenshot", {})),
      /images are off for this run/,
    );
  },
);

test(
  "a secret in a visible field is masked in the next snapshot even when the caller did not mark it",
  OPTIONS,
  async () => {
    const run = await setup();
    await run.call("navigate", { url: "/" });
    await run.call("act", {
      kind: "click",
      target: await run.ref(/\[(e\d+)\] textbox "Email"/),
    });
    await run.call("useSecret", { name: "PASSWORD" });
    const snapshot = text(await run.call("snapshot", {}));
    assert.equal(snapshot.includes(SECRET), false);
    assert.match(snapshot, /textbox "Email" value="••••"/);
  },
);

test(
  "expect adds a check only when it holds on the live page",
  OPTIONS,
  async () => {
    const run = await setup();
    await run.call("navigate", { url: "/" });
    const note = await run.ref(/\[(e\d+)\] text "Ready to go"/);
    const passed = await run.call("expect", {
      target: note,
      matcher: "toHaveText",
      expected: "Ready to go",
    });
    assert.equal(passed.ok, true, text(passed));
    assert.equal(run.steps().slice(-1)[0]!.kind, "expect");
    const negated = await run.call("expect", {
      target: note,
      matcher: "toBeHidden",
      not: true,
    });
    assert.equal(negated.ok, true, text(negated));
    const page_ = await run.call("expect", {
      target: "page",
      matcher: "toHaveTitle",
      expected: "Shop",
    });
    assert.equal(page_.ok, true, text(page_));
    assert.equal(run.steps().slice(-1)[0]!.kind, "expectPage");
    const count = run.steps().length;

    const failed = await run.call("expect", {
      target: note,
      matcher: "toHaveText",
      expected: "Not there",
    });
    assert.equal(failed.ok, false);
    assert.match(text(failed), /did not hold on e\d+ .*so it was not added/);
    const wrongTitle = await run.call("expect", {
      target: "page",
      matcher: "toHaveTitle",
      expected: "Other",
    });
    assert.equal(wrongTitle.ok, false);
    assert.equal(run.steps().length, count);
  },
);

test(
  "screenshot needs a vision model; ask and finish are plumbing",
  OPTIONS,
  async () => {
    const run = await setup({ answers: ["the staging one"] });
    await run.call("navigate", { url: "/" });
    assert.match(
      text(await run.call("screenshot", {})),
      /cannot look at images/,
    );
    run.context.vision = true;
    const shot = await run.call("screenshot", {});
    assert.equal(shot.ok, true);
    assert.ok(shot.ok && shot.image?.data.startsWith("iVBOR"));

    const answer = await run.call("ask", {
      question: "Which account?",
      options: ["staging", "prod"],
    });
    assert.equal(text(answer), "The person answered: the staging one");
    assert.deepEqual(run.questions, ["Which account?"]);

    assert.equal((await run.call("finish", { summary: "Signed in" })).ok, true);
    assert.deepEqual(run.finished, ["Signed in"]);
    assert.match(text(await run.call("finish", {})), /invalid arguments/);
  },
);
