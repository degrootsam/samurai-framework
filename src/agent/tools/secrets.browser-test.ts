import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  agentToolsFixture,
  OPTIONS,
  SECRET,
  text,
} from "../../testing/agent-tools.js";

const fx = agentToolsFixture(9604);
const { setup } = fx;
const page = fx.page;

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
    assert.equal(await page().getByLabel("Password").inputValue(), SECRET);

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
  "a screenshot is refused while a field the caller marked secret shows its value",
  OPTIONS,
  async () => {
    const run = await setup({ vision: true });
    await run.call("navigate", { url: "/" });
    // the password input draws dots: images stay on
    const password = await run.ref(/\[(e\d+)\] textbox "Password"/);
    await run.call("act", { kind: "click", target: password });
    await run.call("useSecret", { name: "PASSWORD" });
    assert.equal((await run.call("screenshot", {})).ok, true);

    // #key is marked secret and is plain text: with a value in it, no image is taken
    await page().evaluate(
      "document.getElementById('key').value = 'not-for-the-model'",
    );
    const refused = await run.call("screenshot", {});
    assert.equal(refused.ok, false);
    assert.match(
      text(refused),
      /shows the value of a field marked secret \(#key\)/,
    );
    assert.equal(
      JSON.stringify(run.results).includes("not-for-the-model"),
      false,
    );

    await page().evaluate("document.getElementById('key').value = ''");
    assert.equal((await run.call("screenshot", {})).ok, true);
  },
);
