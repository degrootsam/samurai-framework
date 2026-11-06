import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { Browser } from "../browser/browser.js";
import type Page from "../browser/page.js";
import { setContent } from "../testing/browser-fixture.js";
import { testBrowser } from "../testing/test-browser.js";
import { Snapshotter, SnapshotRefError } from "./snapshot.js";

let browser: Browser;
let page: Page;

before(async () => {
  ({ browser, page } = await Browser.launch(testBrowser(), {
    port: 9601,
    headless: true,
  }));
  await page.navigateTo("about:blank", "complete");
});

after(async () => {
  await browser?.close();
});

const OPTIONS = { timeout: 30000 };

const FORM = `
  <h1>Sign in</h1>
  <p>Welcome back, please identify yourself.</p>
  <label for="email">Email</label><input id="email" type="email" value="ann@example.com">
  <label for="pw">Password</label><input id="pw" type="password" value="hunter2-secret">
  <label for="pin">PIN</label><input id="pin" class="pin" value="4711-private">
  <label><input type="checkbox" id="rem"> Remember me</label>
  <select id="country" aria-label="Country"><option>Netherlands</option><option selected>Belgium</option></select>
  <button id="go">Sign in</button> <button disabled>Cancel</button>
  <div style="display:none"><button>Hidden button</button></div>
  <button aria-hidden="true">Aria hidden</button>
  <a href="/help">Help</a>`;

test(
  "the snapshot lists roles, names, states and visible text with references",
  OPTIONS,
  async () => {
    await setContent(page, FORM);
    const { text, elements } = await new Snapshotter(page).take();
    assert.match(text, /^url: about:blank\ntitle: /);
    assert.match(text, /\[e\d+\] heading "Sign in" level=1/);
    assert.match(
      text,
      /\[e\d+\] text "Welcome back, please identify yourself\."/,
    );
    assert.match(text, /\[e\d+\] textbox "Email" value="ann@example\.com"/);
    assert.match(text, /\[e\d+\] checkbox "Remember me" unchecked/);
    assert.match(text, /\[e\d+\] combobox "Country" value="Belgium"/);
    assert.match(text, /\[e\d+\] button "Sign in"/);
    assert.match(text, /\[e\d+\] button "Cancel" disabled/);
    assert.match(text, /\[e\d+\] link "Help"/);
    assert.doesNotMatch(text, /Hidden button|Aria hidden/);
    assert.ok(elements >= 8);
  },
);

test(
  "password fields and fields the caller marks secret never show their value",
  OPTIONS,
  async () => {
    await setContent(page, FORM);
    const { text } = await new Snapshotter(page, {
      secretFields: [".pin"],
    }).take();
    assert.match(text, /textbox "Password" value="••••"/);
    assert.match(text, /textbox "PIN" value="••••"/);
    assert.doesNotMatch(text, /hunter2|4711/);
    assert.match(text, /value="ann@example\.com"/);
  },
);

test("a long page is cut at the size cap with a marker", OPTIONS, async () => {
  const items = Array.from(
    { length: 200 },
    (_, i) => `<li>Item number ${i}</li>`,
  ).join("");
  await setContent(page, `<h1>Long</h1><ul>${items}</ul>`);
  const snapshot = await new Snapshotter(page, { maxChars: 800 }).take();
  assert.ok(snapshot.omitted > 100);
  assert.match(
    snapshot.text,
    /… \[snapshot truncated: \d+ more elements not shown\]$/,
  );
  assert.ok(snapshot.text.length < 1100);
  assert.match(snapshot.text, /Item number 0/);
});

test(
  "a reference resolves to a locator for that element",
  OPTIONS,
  async () => {
    await setContent(
      page,
      FORM,
      "window.clicked = 0; document.getElementById('go').addEventListener('click', () => window.clicked++);",
    );
    const snapshotter = new Snapshotter(page);
    const { text } = await snapshotter.take();
    const ref = /\[(e\d+)\] button "Sign in"/.exec(text)![1]!;
    const located = await snapshotter.locate(ref);
    assert.equal(located.description, 'button "Sign in"');
    assert.equal(located.secret, false);
    assert.deepEqual(located.spec.chain, [
      { method: "getByRole", role: "button", name: "Sign in" },
    ]);
    await located.locator.click();
    assert.equal(await page.evaluate("window.clicked"), 1);
  },
);

test("a password field resolves as secret", OPTIONS, async () => {
  await setContent(page, FORM);
  const snapshotter = new Snapshotter(page);
  const { text } = await snapshotter.take();
  const ref = /\[(e\d+)\] textbox "Password"/.exec(text)![1]!;
  assert.equal((await snapshotter.locate(ref)).secret, true);
});

test("the focused field is found", OPTIONS, async () => {
  await setContent(page, FORM);
  const snapshotter = new Snapshotter(page);
  await assert.rejects(snapshotter.locateFocused(), /no field has focus/);
  await page.getByLabel("Email").focus();
  assert.equal(
    (await snapshotter.locateFocused()).description,
    'textbox "Email"',
  );
});

test("references are stable while the element lives", OPTIONS, async () => {
  await setContent(page, FORM);
  const snapshotter = new Snapshotter(page);
  const first = (await snapshotter.take()).text.match(
    /\[(e\d+)\] link "Help"/,
  )![1];
  const second = (await snapshotter.take()).text.match(
    /\[(e\d+)\] link "Help"/,
  )![1];
  assert.equal(first, second);
});

test("bad references give a precise error", OPTIONS, async () => {
  await page.navigateTo("about:blank?bad-references", "complete");
  await setContent(page, FORM);
  const snapshotter = new Snapshotter(page);
  await assert.rejects(snapshotter.locate("e1"), (error: Error) => {
    assert.ok(error instanceof SnapshotRefError);
    assert.match(error.message, /no snapshot has been taken of this page yet/);
    return true;
  });
  const { text } = await snapshotter.take();
  await assert.rejects(snapshotter.locate("e9999"), /e9999 does not exist/);
  await assert.rejects(
    snapshotter.locate("#go"),
    /"#go" is not a snapshot reference/,
  );

  // removed after the snapshot: stale
  const ref = /\[(e\d+)\] link "Help"/.exec(text)![1]!;
  await page.evaluate("document.querySelector('a').remove()");
  await assert.rejects(
    snapshotter.locate(ref),
    new RegExp(`${ref} is no longer on the page`),
  );

  // gone from the next snapshot: it belongs to an earlier one
  await snapshotter.take();
  await assert.rejects(
    snapshotter.locate(ref),
    new RegExp(`${ref} was in an earlier snapshot`),
  );
});

test("a new document starts over", OPTIONS, async () => {
  await setContent(page, FORM);
  const snapshotter = new Snapshotter(page);
  const { text } = await snapshotter.take();
  const ref = /\[(e\d+)\] button "Sign in"/.exec(text)![1]!;
  await page.navigateTo("about:blank?other", "complete");
  await assert.rejects(
    snapshotter.locate(ref),
    /no snapshot has been taken of this page yet/,
  );
});
