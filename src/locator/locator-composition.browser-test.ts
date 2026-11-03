import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { Browser } from "../browser/browser.js";
import type Page from "../browser/page.js";
import type Locator from "./locator.js";
import { setContent } from "../testing/browser-fixture.js";
import { testBrowser } from "../testing/test-browser.js";

let browser: Browser;
let page: Page;

before(async () => {
  ({ browser, page } = await Browser.launch(testBrowser(), {
    port: 9396,
    headless: true,
  }));
  await page.navigateTo("about:blank", "complete");
});

after(async () => {
  await browser?.close();
});

const OPTIONS = { timeout: 30000 };

/** The `data-id` of every element a locator matches, in the order `all()` gives them */
async function dataIds(locator: Locator): Promise<Array<string | null>> {
  const items = await locator.all();
  return Promise.all(items.map((item) => item.getAttribute("data-id")));
}

const NESTED = `
  <ul data-id="outer">
    <li data-id="a1">first
      <ul data-id="inner"><li data-id="a1x">x</li><li data-id="a1y">y</li></ul>
    </li>
    <li data-id="a2">second</li>
  </ul>
  <ul data-id="other"><li data-id="b1">third</li></ul>`;

test(
  "nth, first and last follow document order through nested lists",
  OPTIONS,
  async () => {
    await setContent(page, NESTED);
    // The three lists are start nodes of the li search, and two of them overlap
    const items = page.locator("ul").locator("li");
    assert.equal(await items.count(), 5);
    assert.deepEqual(await dataIds(items), ["a1", "a1x", "a1y", "a2", "b1"]);
    assert.equal(await items.first().getAttribute("data-id"), "a1");
    assert.equal(await items.nth(1).getAttribute("data-id"), "a1x");
    assert.equal(await items.nth(3).getAttribute("data-id"), "a2");
    assert.equal(await items.last().getAttribute("data-id"), "b1");
    assert.equal(await items.nth(-2).getAttribute("data-id"), "a2");
    assert.equal(await items.nth(-5).getAttribute("data-id"), "a1");
  },
);

test(
  "nth puts matches that come out of start-node order into document order",
  OPTIONS,
  async () => {
    await setContent(page, NESTED);
    // The parent of a1x (inner) is found before the parent of a2 (outer), which comes first in the document
    const parents = page.locator("[data-id=a1x], [data-id=a2]").locator("..");
    assert.equal(await parents.count(), 2);
    assert.equal(await parents.first().getAttribute("data-id"), "outer");
    assert.equal(await parents.nth(1).getAttribute("data-id"), "inner");
    assert.equal(await parents.last().getAttribute("data-id"), "inner");
  },
);

test(
  "nth, first and last match nothing when out of range or empty",
  OPTIONS,
  async () => {
    await setContent(page, NESTED);
    const items = page.locator("li");
    assert.equal(await items.nth(5).count(), 0);
    assert.equal(await items.nth(-6).count(), 0);
    const none = page.locator("table");
    assert.equal(await none.first().count(), 0);
    assert.equal(await none.last().count(), 0);
    assert.equal(await none.first().textContent(), null);
    assert.equal(await none.last().isVisible(), false);
  },
);

test(
  "filter hasText: string is a case-insensitive substring, RegExp is tested as written",
  OPTIONS,
  async () => {
    await setContent(
      page,
      `<p data-id="1">Order  PAID</p><p data-id="2">Order pending</p><p data-id="3">Refund</p>`,
    );
    const paragraphs = page.locator("p");
    assert.deepEqual(await dataIds(paragraphs.filter({ hasText: "order" })), [
      "1",
      "2",
    ]);
    // Whitespace is collapsed for a string
    assert.deepEqual(
      await dataIds(paragraphs.filter({ hasText: "order paid" })),
      ["1"],
    );
    assert.deepEqual(
      await dataIds(paragraphs.filter({ hasText: /^Refund$/ })),
      ["3"],
    );
    assert.deepEqual(await dataIds(paragraphs.filter({ hasText: /paid/ })), []);
    assert.deepEqual(await dataIds(paragraphs.filter({ hasText: /paid/i })), [
      "1",
    ]);
    assert.deepEqual(
      await dataIds(paragraphs.filter({ hasNotText: "order" })),
      ["3"],
    );
    assert.deepEqual(
      await dataIds(paragraphs.filter({ hasNotText: /pending|refund/i })),
      ["1"],
    );
    assert.deepEqual(
      await dataIds(
        paragraphs.filter({ hasText: "order", hasNotText: "paid" }),
      ),
      ["2"],
    );
    // A global RegExp keeps no state between elements
    assert.deepEqual(await dataIds(paragraphs.filter({ hasText: /Order/g })), [
      "1",
      "2",
    ]);
  },
);

test(
  "filter has / hasNot search inside each element, from a scoped first step",
  OPTIONS,
  async () => {
    await setContent(
      page,
      `<button data-id="outside">Buy</button>
     <div class="card" data-id="c1"><button>Buy</button></div>
     <div class="card" data-id="c2"><span>Sold out</span></div>
     <div class="card" data-id="c3"><p><button>Buy</button></p></div>`,
    );
    const cards = page.locator(".card");
    // An absolute-looking xpath and a page-wide role search still mean "inside the card"
    for (const inner of [
      page.locator("//button"),
      page.locator("button"),
      page.getByRole("button"),
      page.getByText("Buy"),
    ]) {
      assert.deepEqual(await dataIds(cards.filter({ has: inner })), [
        "c1",
        "c3",
      ]);
      assert.deepEqual(await dataIds(cards.filter({ hasNot: inner })), ["c2"]);
    }
    assert.deepEqual(
      await dataIds(page.locator(".card", { has: page.locator("p") })),
      ["c3"],
    );
    assert.deepEqual(
      await dataIds(page.locator(".card", { hasText: "sold" })),
      ["c2"],
    );
    // A chain with several steps works as the inner locator
    assert.deepEqual(
      await dataIds(cards.filter({ has: page.locator("p").locator("button") })),
      ["c3"],
    );
  },
);

test("and keeps what both locators match", OPTIONS, async () => {
  await setContent(
    page,
    `<button data-id="1" class="primary">A</button><button data-id="2">B</button><a data-id="3" class="primary">C</a>`,
  );
  const both = page.locator("button").and(page.locator(".primary"));
  assert.deepEqual(await dataIds(both), ["1"]);
  assert.equal(await both.textContent(), "A");
  assert.equal(await page.locator("button").and(page.locator("a")).count(), 0);
});

test(
  "or gives both in document order, once each, even when one is empty",
  OPTIONS,
  async () => {
    await setContent(page, NESTED);
    // The right-hand side comes first in the document, and one element is in both
    const either = page
      .locator("[data-id=b1], [data-id=a1y]")
      .or(page.locator("[data-id=a1], [data-id=a1y]"));
    assert.deepEqual(await dataIds(either), ["a1", "a1y", "b1"]);
    assert.equal(await either.count(), 3);
    assert.equal(await either.first().getAttribute("data-id"), "a1");
    assert.equal(await either.last().getAttribute("data-id"), "b1");

    const missing = page.locator("table");
    assert.deepEqual(await dataIds(missing.or(page.locator("[data-id=a2]"))), [
      "a2",
    ]);
    assert.deepEqual(await dataIds(page.locator("[data-id=a2]").or(missing)), [
      "a2",
    ]);
    assert.equal(await missing.or(page.locator("hr")).count(), 0);
    // Steps after an or search inside its matches
    assert.deepEqual(
      await dataIds(
        page
          .locator("[data-id=inner]")
          .or(page.locator("[data-id=other]"))
          .locator("li"),
      ),
      ["a1x", "a1y", "b1"],
    );
  },
);

test("locator() reads css and xpath strings", OPTIONS, async () => {
  await setContent(
    page,
    `<main data-id="main"><form><input name="x" data-id="in"><input name="y"></form>
     <a href="/docs" data-id="link">Docs</a><button data-id="btn">Go</button></main>`,
  );
  assert.deepEqual(await dataIds(page.locator("input[name='x']")), ["in"]);
  assert.deepEqual(await dataIds(page.locator("a, button")), ["link", "btn"]);
  assert.deepEqual(await dataIds(page.locator("main")), ["main"]);
  assert.deepEqual(await dataIds(page.locator("css=a[href^='/docs']")), [
    "link",
  ]);
  assert.deepEqual(await dataIds(page.locator("css=input[name='x']")), ["in"]);
  // Everything that was xpath is still xpath
  assert.deepEqual(await dataIds(page.locator("//input[@name='x']")), ["in"]);
  assert.deepEqual(await dataIds(page.locator("xpath=input[@name='x']")), [
    "in",
  ]);
  assert.deepEqual(await dataIds(page.locator("input[@name='x']")), ["in"]);
  assert.deepEqual(await dataIds(page.locator("button[text()='Go']")), ["btn"]);
  assert.deepEqual(await dataIds(page.locator("/html/body/main/a")), ["link"]);
  assert.deepEqual(await dataIds(page.locator("(//input)[2]")), [null]);
  const form = page.locator("form");
  assert.deepEqual(await dataIds(form.locator("./input[@name='x']")), ["in"]);
  assert.deepEqual(await dataIds(form.locator(".//input[@name='x']")), ["in"]);
  assert.deepEqual(await dataIds(form.locator("//input[@name='x']")), ["in"]);
  assert.deepEqual(await dataIds(form.locator("input[name='x']")), ["in"]);
  assert.deepEqual(await dataIds(form.locator("..")), ["main"]);
});

test(
  "strict selectors throw on several matches, and only when on",
  OPTIONS,
  async () => {
    await setContent(
      page,
      `<button data-id="1">Go</button><button data-id="2">Go</button>`,
    );
    const buttons = page.locator("button");
    // Off: the first match is used
    assert.equal(await buttons.getAttribute("data-id"), "1");
    await buttons.click({ timeout: 3000 });

    await assert.rejects(
      buttons.strict().click({ timeout: 3000 }),
      /click\(\): strict mode violation, 2 elements match css=button/,
    );
    await assert.rejects(
      buttons.strict().textContent(),
      /textContent\(\): strict mode violation, 2 elements match/,
    );
    assert.equal(await buttons.strict().first().getAttribute("data-id"), "1");
    assert.equal(await buttons.strict().count(), 2);
    assert.equal(await buttons.strict(false).getAttribute("data-id"), "1");

    page.setStrictSelectors(true);
    try {
      await assert.rejects(
        page.locator("button").getAttribute("data-id"),
        /getAttribute\(\): strict mode violation, 2 elements match/,
      );
      assert.equal(
        await page
          .locator("button")
          .filter({ hasText: "Go" })
          .last()
          .textContent(),
        "Go",
      );
    } finally {
      page.setStrictSelectors(undefined);
    }
    assert.equal(await page.locator("button").getAttribute("data-id"), "1");
  },
);
