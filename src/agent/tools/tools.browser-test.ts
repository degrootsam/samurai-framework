import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { agentToolsFixture, OPTIONS, text } from "../../testing/agent-tools.js";

const fx = agentToolsFixture(9602);
const { setup } = fx;
const page = fx.page;

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
    assert.equal(await page().getByLabel("Email").inputValue(), "");
    assert.equal(await page().getByLabel("I agree").isChecked(), false);
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
    await page().evaluate("document.querySelector('a').remove()");
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
    const refused = await run.call("navigate", { url: `${fx.otherOrigin()}/` });
    assert.equal(refused.ok, false);
    assert.match(text(refused), /not allowed; the person declined/);
    assert.equal(run.questions.length, 1);
    assert.ok(run.questions[0]!.includes(fx.otherOrigin()));
    assert.equal(await page().url(), `${fx.appOrigin()}/`);
    assert.equal(run.steps().length, 1);

    const allowed = await run.call("navigate", { url: `${fx.otherOrigin()}/` });
    assert.equal(allowed.ok, true, text(allowed));
    assert.equal(await page().url(), `${fx.otherOrigin()}/`);
    assert.equal(run.steps().length, 2);
    assert.equal(run.steps()[1]!.kind, "goto");

    // asked once: the origin stays allowed for the run
    assert.equal(
      (await run.call("navigate", { url: `${fx.otherOrigin()}/next` })).ok,
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
