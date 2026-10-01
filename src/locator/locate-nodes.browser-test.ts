import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Browser } from "../browser/browser.js";
import type Page from "../browser/page.js";
import { setContent } from "../testing/browser-fixture.js";
import { InvalidSelectorError } from "./locator.js";

let browser: Browser;
let page: Page;

before(async () => {
  ({ browser, page } = await Browser.launch("firefox", { port: 9235, headless: true }));
  await page.navigateTo("about:blank", "complete");
});

after(async () => {
  await page.dispose();
  await browser?.close();
});

const OPTIONS = { timeout: 20000 };

const FORMS = `
  <form id="login"><h2>Login</h2>
    <input type="text" name="user" placeholder="user">
    <button type="submit">Sign in</button>
  </form>
  <form id="signup"><h2>Sign up</h2>
    <input type="text" name="user" placeholder="new user">
    <button type="submit">Create account</button>
  </form>`;

test("css locators find elements and count them", OPTIONS, async () => {
  await setContent(page, FORMS);
  assert.equal(await page.getByCss("form input[name=user]").count(), 2);
  assert.equal(await page.getByCss("#signup button").textContent(), "Create account");
});

test("xpath locators behave as before", OPTIONS, async () => {
  await setContent(page, FORMS);
  assert.equal(await page.locator("button[text()='Sign in']").count(), 1);
  assert.equal(await page.locator("//form[@id='login']//input").getAttribute("placeholder"), "user");
});

test("text locators match fully by default, partially and case-insensitively on request", OPTIONS, async () => {
  await setContent(page, FORMS);
  assert.equal(await page.getByText("Sign in").count(), 1);
  assert.equal(await page.getByText("Sign").count(), 0, "full match by default");
  assert.equal(await page.getByText("Sign", { match: "partial" }).count(), 2, "Sign in + Sign up");
  assert.equal(await page.getByText("sign in").count(), 0);
  assert.equal(await page.getByText("sign in", { ignoreCase: true }).count(), 1);
});

test("a chained locator is scoped to its parent", OPTIONS, async () => {
  await setContent(page, FORMS);
  const signup = page.locator("//form[@id='signup']");
  assert.equal(await signup.getByCss("input").getAttribute("placeholder"), "new user");
  assert.equal(await signup.locator("input").getAttribute("placeholder"), "new user");
  assert.equal(await signup.locator("//input").getAttribute("placeholder"), "new user", "// is relative to the parent");
  assert.equal(await signup.getByText("Sign in").count(), 0, "the login button is outside the signup form");
  assert.equal(await page.getByCss("form").getByCss("button").count(), 2, "several parents");
});

test("actions work through chained locators", OPTIONS, async () => {
  await setContent(
    page,
    FORMS,
    `document.querySelectorAll("button").forEach((b) =>
       b.addEventListener("click", (e) => { e.preventDefault(); b.dataset.clicked = "yes"; }));`,
  );
  await page.locator("//form[@id='signup']").getByCss("button").click({ timeout: 5000 });
  assert.equal(await page.getByCss("#signup button").getAttribute("data-clicked"), "yes");
  assert.equal(await page.getByCss("#login button").getAttribute("data-clicked"), null);
  await page.locator("//form[@id='login']").getByCss("input").fill("sam", { timeout: 5000 });
  assert.equal(await page.getByCss("#login input").inputValue(), "sam");
});

test("all() on a css locator gives locators for each element", OPTIONS, async () => {
  await setContent(page, `<ul><li>a</li><li>b</li><li>c</li></ul>`);
  const items = await page.getByCss("li").all();
  assert.equal(items.length, 3);
  assert.deepEqual(
    await Promise.all(items.map((item) => item.textContent())),
    ["a", "b", "c"],
  );
});

test("the element is re-resolved every poll: a replaced element is found and clicked", OPTIONS, async () => {
  await setContent(
    page,
    `<button id="b" disabled>old</button>`,
    `setTimeout(() => {
       document.body.innerHTML = '<button id="b">new</button>';
       document.getElementById("b").addEventListener("click", (e) => { e.target.dataset.clicked = "yes"; });
     }, 300);`,
  );
  const button = page.getByCss("#b");
  await button.click({ timeout: 5000 });
  assert.equal(await button.textContent(), "new");
  assert.equal(await button.getAttribute("data-clicked"), "yes");
});

test("a removed element is not attached even though the browser can still resolve it", OPTIONS, async () => {
  await setContent(page, `<p id="p">x</p>`);
  const paragraph = page.getByCss("#p");
  await paragraph.waitFor({ state: "visible", timeout: 2000 });
  await setContent(page, ``);
  await paragraph.waitFor({ state: "detached", timeout: 2000 });
  assert.equal(await paragraph.isVisible(), false);
});

test("the first match is re-evaluated: a new earlier element becomes the target", OPTIONS, async () => {
  await setContent(
    page,
    `<p class="x">second</p>`,
    `setTimeout(() => document.body.insertAdjacentHTML("afterbegin", '<p class="x">first</p>'), 300);`,
  );
  const first = page.getByCss("p.x");
  assert.equal(await first.textContent(), "second");
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(await first.textContent(), "first");
});

test("an invalid css selector fails at once with the selector in the message", OPTIONS, async () => {
  await setContent(page, FORMS);
  const started = Date.now();
  await assert.rejects(page.getByCss("form[").click({ timeout: 5000 }), (err) => {
    assert.ok(err instanceof InvalidSelectorError, String(err));
    assert.equal(err.selector, "css=form[");
    return true;
  });
  assert.ok(Date.now() - started < 3000, "not retried until the timeout");
});

test("role locators use the browser's accessibility tree", OPTIONS, async () => {
  await setContent(
    page,
    FORMS + `<a href="/x">Docs</a><div role="button" aria-label="Custom">x</div>`,
  );
  assert.equal(await page.getByRole("button", { name: "Sign in" }).count(), 1);
  assert.equal(await page.getByRole("button").count(), 3, "two submit buttons and the role=button div");
  assert.equal(await page.getByRole("link", { name: "Docs" }).getAttribute("href"), "/x");
  assert.equal(await page.getByRole("button", { name: "Custom" }).count(), 1, "aria-label is the name");
  assert.equal(
    await page.locator("//form[@id='signup']").getByRole("button").textContent(),
    "Create account",
  );
  assert.equal(await page.getByRole("textbox").count(), 2);
});

test("text search finds the innermost element, also without the browser's innerText locator", OPTIONS, async () => {
  await setContent(page, `<div id="wrap"><span id="inner">  Save   draft </span></div><p>Save</p>`);
  const found = page.getByText("Save draft");
  assert.equal(await found.count(), 1);
  assert.equal(await found.getAttribute("id"), "inner", "not the wrapping div");
  assert.equal(await page.getByText("Save").count(), 1, "full match: only the paragraph");
  assert.equal(await page.getByText("save", { match: "partial", ignoreCase: true }).count(), 2);
});

test("text locators are re-evaluated on every poll", OPTIONS, async () => {
  await setContent(
    page,
    `<p>Loading</p>`,
    `setTimeout(() => { document.body.innerHTML = '<button id="b">Done</button>'; }, 300);`,
  );
  const done = page.getByText("Done");
  await done.waitFor({ state: "visible", timeout: 5000 });
  assert.equal(await done.getAttribute("id"), "b");
});

test("label locators find controls by <label>, aria-labelledby and aria-label", OPTIONS, async () => {
  await setContent(
    page,
    `<label for="e">Email address</label><input id="e">
     <label>Password <input id="p" type="password"></label>
     <h2 id="h">Billing</h2><input id="b" aria-labelledby="h">
     <input id="s" aria-label="Search">`,
  );
  assert.equal(await page.getByLabel("Email address").getAttribute("id"), "e");
  assert.equal(await page.getByLabel("Password").getAttribute("id"), "p", "label wrapping its input");
  assert.equal(await page.getByLabel("Billing").getAttribute("id"), "b");
  assert.equal(await page.getByLabel("search", { ignoreCase: true }).getAttribute("id"), "s");
  assert.equal(await page.getByLabel("Email").count(), 0, "full match");
  assert.equal(await page.getByLabel("Email", { match: "partial" }).count(), 1);
});

test("test id locators match data-testid exactly", OPTIONS, async () => {
  await setContent(page, `<button data-testid="save">Save</button><button data-testid="save-all">All</button>`);
  assert.equal(await page.getByTestId("save").count(), 1);
  assert.equal(await page.getByTestId("save").textContent(), "Save");
  assert.equal(await page.getByTestId("nope").count(), 0);
});

test("a fallback locator takes over when the primary matches nothing", OPTIONS, async () => {
  await setContent(page, `<button aria-label="Go">Go</button>`);
  const go = page.getByTestId("go").withFallbacks(page.getByRole("button", { name: "Go" }), page.getByText("Go"));
  await go.click({ timeout: 3000 });
  assert.equal(go.matchedBy?.index, 1);
});
