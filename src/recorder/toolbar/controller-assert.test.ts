import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Observation } from "../normalise.js";
import type { PickInfo } from "./protocol.js";
import type { Inspection } from "./types.js";
import {
  SECRET,
  TARGET,
  CANDIDATES,
  LOCATOR,
  COUNT_CALL,
  INFO,
  lastOf,
  msg,
  pick,
  setup,
} from "./controller-fixture.js";

describe("ToolbarController pick and assert", () => {
  it("answers a pick with what it found, then turns the assert into an expect step", async () => {
    const { controller, replies, observed } = setup();
    await controller.handle(pick(20));
    assert.deepEqual(replies, [{ id: 20, result: INFO }]);
    await controller.handle(
      msg({
        action: "assert",
        id: 20,
        target: TARGET,
        candidates: CANDIDATES,
        matcher: "toHaveText",
        expected: "Sign in",
        not: true,
      }),
    );
    assert.deepEqual(observed, [
      {
        type: "expect",
        locator: LOCATOR,
        not: true,
        expectation: { matcher: "toHaveText", expected: "Sign in" },
      },
    ]);
    assert.deepEqual(lastOf(replies), { id: 20, result: { ok: true } });
  });

  it("builds every matcher; Count uses the chosen count locator", async () => {
    const cases: [Record<string, unknown>, Observation][] = [
      [
        { matcher: "toBeVisible", not: false },
        {
          type: "expect",
          locator: LOCATOR,
          not: false,
          expectation: { matcher: "toBeVisible" },
        },
      ],
      [
        {
          matcher: "toHaveAttribute",
          attribute: "id",
          expected: "email",
          not: false,
        },
        {
          type: "expect",
          locator: LOCATOR,
          not: false,
          expectation: {
            matcher: "toHaveAttribute",
            name: "id",
            expected: "email",
          },
        },
      ],
      [
        { matcher: "toBeHidden", not: false },
        {
          type: "expect",
          locator: LOCATOR,
          not: false,
          expectation: { matcher: "toBeHidden" },
        },
      ],
      [
        { matcher: "toBeEnabled", not: true },
        {
          type: "expect",
          locator: LOCATOR,
          not: true,
          expectation: { matcher: "toBeEnabled" },
        },
      ],
      [
        { matcher: "toBeChecked", not: false },
        {
          type: "expect",
          locator: LOCATOR,
          not: false,
          expectation: { matcher: "toBeChecked" },
        },
      ],
      [
        { matcher: "toHaveClass", expected: "btn primary", not: false },
        {
          type: "expect",
          locator: LOCATOR,
          not: false,
          expectation: { matcher: "toHaveClass", expected: "btn primary" },
        },
      ],
      [
        {
          matcher: "toHaveCSS",
          cssName: "background-color",
          expected: "rgb(255, 0, 0)",
          not: false,
        },
        {
          type: "expect",
          locator: LOCATOR,
          not: false,
          expectation: {
            matcher: "toHaveCSS",
            name: "background-color",
            expected: "rgb(255, 0, 0)",
          },
        },
      ],
      [
        { matcher: "toHaveCount", countIndex: 0, expected: "3", not: false },
        {
          type: "expect",
          locator: { chain: [COUNT_CALL], fallbacks: [] },
          not: false,
          expectation: { matcher: "toHaveCount", expected: 3 },
        },
      ],
    ];
    for (const [fields, expected] of cases) {
      const { controller, observed } = setup();
      await controller.handle(pick(21));
      await controller.handle(
        msg({
          action: "assert",
          id: 21,
          target: TARGET,
          candidates: CANDIDATES,
          ...fields,
        }),
      );
      assert.deepEqual(observed, [expected]);
    }
  });

  it("fails Has CSS without a property name", async () => {
    for (const cssName of [undefined, "", "  "]) {
      const { controller, replies, observed } = setup();
      await controller.handle(pick(24));
      await controller.handle(
        msg({
          action: "assert",
          id: 24,
          target: TARGET,
          candidates: CANDIDATES,
          matcher: "toHaveCSS",
          cssName,
          expected: "red",
          not: false,
        }),
      );
      assert.deepEqual(observed, []);
      assert.deepEqual(lastOf(replies), {
        id: 24,
        result: { ok: false, error: "Choose a CSS property" },
      });
    }
  });

  it('fails Has CSS with an empty value (a typo\'d property computes to "")', async () => {
    for (const expected of [undefined, "", "  "]) {
      const { controller, replies, observed } = setup();
      await controller.handle(pick(25));
      await controller.handle(
        msg({
          action: "assert",
          id: 25,
          target: TARGET,
          candidates: CANDIDATES,
          matcher: "toHaveCSS",
          cssName: "colr",
          expected,
          not: false,
        }),
      );
      assert.deepEqual(observed, []);
      assert.deepEqual(lastOf(replies), {
        id: 25,
        result: { ok: false, error: "Fill in the value" },
      });
    }
  });

  it("rejects an assert that doesn't match the pending pick", async () => {
    const { controller, replies, observed } = setup();
    await controller.handle(
      msg({
        action: "assert",
        id: 22,
        target: TARGET,
        candidates: CANDIDATES,
        matcher: "toBeVisible",
        not: false,
      }),
    );
    assert.deepEqual(observed, []);
    assert.equal(lastOf(replies)?.id, 22);
    assert.equal(lastOf(replies)?.result.ok, false);
  });

  it("answers an unidentifiable pick with the error", async () => {
    const { controller, replies } = setup({}, { rank: async () => undefined });
    await controller.handle(pick(23));
    assert.deepEqual(replies, [
      {
        id: 23,
        result: {
          ok: false,
          error: "This element can't be identified uniquely",
        },
      },
    ]);
  });

  it("never sends back a secret that a picked field holds (Review Focus 4)", async () => {
    const { controller, replies, observed, noSecretLeaks } = setup(
      {},
      {
        inspect: async (): Promise<Inspection> => ({
          info: {
            ...INFO,
            text: "",
            value: SECRET,
            attributes: [
              { name: "id", value: "pw" },
              { name: "value", value: SECRET },
            ],
            first: { matcher: "toHaveValue", expected: SECRET },
            className: `field ${SECRET}`,
            css: { name: "color", value: SECRET },
          },
          counts: [],
        }),
      },
    );
    await controller.handle(pick(43));
    const reply = lastOf(replies)!.result as PickInfo & { ok: true };
    assert.equal(reply.value, undefined);
    assert.deepEqual(reply.first, { matcher: "toBeVisible" });
    assert.deepEqual(reply.attributes, [{ name: "id", value: "pw" }]);
    assert.equal(reply.className, null);
    assert.deepEqual(reply.css, { name: "color", value: "" });
    await controller.handle(
      msg({
        action: "assert",
        id: 43,
        target: TARGET,
        candidates: CANDIDATES,
        matcher: "toBeVisible",
        not: false,
      }),
    );
    assert.ok(!JSON.stringify(observed).includes(SECRET));
    noSecretLeaks();
  });
});

describe("ToolbarController page assertions", () => {
  it("answers page-info with the URL, the URL relative to the base URL, and the title", async () => {
    const { controller, replies, page } = setup(
      {},
      { baseURL: "http://localhost" },
    );
    page.url = "http://localhost/checkout?step=2";
    page.title = "Checkout";
    await controller.handle(msg({ action: "page-info", id: 50 }));
    assert.deepEqual(replies, [
      {
        id: 50,
        result: {
          ok: true,
          url: "http://localhost/checkout?step=2",
          urlPrefill: "/checkout?step=2",
          title: "Checkout",
        },
      },
    ]);
  });

  it("prefills the full URL without a base URL", async () => {
    const { controller, replies } = setup();
    await controller.handle(msg({ action: "page-info", id: 51 }));
    assert.deepEqual(lastOf(replies), {
      id: 51,
      result: {
        ok: true,
        url: "http://localhost/a",
        urlPrefill: "http://localhost/a",
        title: "Home",
      },
    });
  });

  it("turns assert-page into an expectPage observation", async () => {
    const { controller, replies, observed } = setup();
    await controller.handle(
      msg({
        action: "assert-page",
        id: 52,
        matcher: "toHaveURL",
        expected: "/checkout",
        not: false,
      }),
    );
    await controller.handle(
      msg({
        action: "assert-page",
        id: 53,
        matcher: "toHaveTitle",
        expected: "Checkout",
        not: true,
      }),
    );
    assert.deepEqual(observed, [
      {
        type: "expectPage",
        not: false,
        expectation: { matcher: "toHaveURL", expected: "/checkout" },
      },
      {
        type: "expectPage",
        not: true,
        expectation: { matcher: "toHaveTitle", expected: "Checkout" },
      },
    ]);
    assert.deepEqual(replies, [
      { id: 52, result: { ok: true } },
      { id: 53, result: { ok: true } },
    ]);
  });

  it("refuses an empty expected value", async () => {
    const { controller, replies, observed } = setup();
    await controller.handle(
      msg({
        action: "assert-page",
        id: 54,
        matcher: "toHaveTitle",
        expected: "  ",
        not: false,
      }),
    );
    assert.deepEqual(observed, []);
    assert.deepEqual(replies, [
      { id: 54, result: { ok: false, error: "Fill in the value" } },
    ]);
  });

  it("a double click on Add writes one step", async () => {
    const { controller, observed } = setup();
    const add = msg({
      action: "assert-page",
      id: 55,
      matcher: "toHaveTitle",
      expected: "Home",
      not: false,
    });
    assert.equal(controller.accept(add), true);
    assert.equal(controller.accept(add), false);
    await controller.handle(add);
    assert.equal(observed.length, 1);
  });

  it("never sends back a URL or title that holds a secret", async () => {
    const { controller, replies, page, noSecretLeaks } = setup();
    page.url = `http://localhost/reset?token=${SECRET}`;
    page.title = `Hello ${SECRET}`;
    await controller.handle(msg({ action: "page-info", id: 56 }));
    assert.deepEqual(lastOf(replies), {
      id: 56,
      result: { ok: true, url: "", urlPrefill: "", title: "" },
    });
    noSecretLeaks();
  });
});
