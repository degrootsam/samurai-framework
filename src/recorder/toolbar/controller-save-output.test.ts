import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Inspection } from "./types.js";
import { MASK } from "../../config/mask.js";
import type { PickInfo } from "./protocol.js";
import {
  CANDIDATES,
  SECRET,
  COUNT_CALL,
  INFO,
  LOCATOR,
  TARGET,
  lastOf,
  msg,
  pick,
  setup,
} from "./controller-fixture.js";

const TEXT = "Order #4521 is placed";

/** A controller whose picked element reads `TEXT` */
const withText = () =>
  setup(
    {},
    {
      inspect: async (): Promise<Inspection> => ({
        info: { ...INFO, text: TEXT, outputText: TEXT },
        counts: [COUNT_CALL],
      }),
    },
  );

const save = (id: number, name: string, pattern?: string) =>
  msg({
    action: "save-output",
    id,
    target: TARGET,
    candidates: CANDIDATES,
    name,
    ...(pattern !== undefined && { pattern }),
  });

describe("ToolbarController save as output", () => {
  it("turns save-output into a saveOutput observation for the picked element", async () => {
    const { controller, replies, observed } = withText();
    await controller.handle(pick(40));
    await controller.handle(save(40, "orderId", "Order #(\\d+)"));
    assert.deepEqual(observed, [
      {
        type: "saveOutput",
        locator: LOCATOR,
        name: "orderId",
        pattern: { source: "Order #(\\d+)", flags: "" },
      },
    ]);
    assert.deepEqual(lastOf(replies), { id: 40, result: { ok: true } });
  });

  it("leaves the pattern out when none (or only spaces) is given, and trims the name", async () => {
    const { controller, observed } = withText();
    await controller.handle(pick(41));
    await controller.handle(save(41, " ref ", ""));
    assert.deepEqual(observed, [
      { type: "saveOutput", locator: LOCATOR, name: "ref" },
    ]);
  });

  it("refuses a name that breaks the name rules, on the name field", async () => {
    for (const name of ["", "1st", "order id"]) {
      const { controller, replies, observed } = withText();
      await controller.handle(pick(42));
      await controller.handle(save(42, name));
      assert.deepEqual(
        lastOf(replies),
        {
          id: 42,
          result: {
            ok: false,
            error: "name: use letters, digits and _",
            field: "name",
          },
        },
        name,
      );
      assert.deepEqual(observed, [], name);
    }
  });

  it("says a reserved name is reserved, on the name field", async () => {
    for (const name of ["status", "durationMs", "error", "__proto__"]) {
      const { controller, replies, observed } = withText();
      await controller.handle(pick(42));
      await controller.handle(save(42, name));
      assert.deepEqual(
        lastOf(replies),
        {
          id: 42,
          result: {
            ok: false,
            error: `name: "${name}" is reserved`,
            field: "name",
          },
        },
        name,
      );
      assert.deepEqual(observed, [], name);
    }
  });

  it("sends the pattern with a / escaped, so the spec it writes compiles", async () => {
    const { controller, observed } = setup(
      {},
      {
        inspect: async (): Promise<Inspection> => ({
          info: { ...INFO, text: "orders/4521", outputText: "orders/4521" },
          counts: [COUNT_CALL],
        }),
      },
    );
    await controller.handle(pick(50));
    await controller.handle(save(50, "orderId", "orders/(\\d+)"));
    assert.deepEqual(observed, [
      {
        type: "saveOutput",
        locator: LOCATOR,
        name: "orderId",
        pattern: { source: "orders\\/(\\d+)", flags: "" },
      },
    ]);
  });

  it("refuses an element with no text when there is no pattern", async () => {
    const { controller, replies, observed } = setup(
      {},
      {
        inspect: async (): Promise<Inspection> => ({
          info: { ...INFO, text: "", outputText: "" },
          counts: [COUNT_CALL],
        }),
      },
    );
    await controller.handle(pick(51));
    await controller.handle(save(51, "orderId"));
    assert.deepEqual(lastOf(replies), {
      id: 51,
      result: { ok: false, error: "the element has no text" },
    });
    assert.deepEqual(observed, []);
  });

  it("refuses a pattern that is not valid", async () => {
    const { controller, replies, observed } = withText();
    await controller.handle(pick(43));
    await controller.handle(save(43, "orderId", "Order #(\\d+"));
    assert.deepEqual(lastOf(replies), {
      id: 43,
      result: { ok: false, error: "pattern is not a valid regular expression" },
    });
    assert.deepEqual(observed, []);
  });

  it("refuses a pattern that doesn't match the element's text now", async () => {
    const { controller, replies, observed } = withText();
    await controller.handle(pick(44));
    await controller.handle(save(44, "orderId", "Invoice #(\\d+)"));
    assert.deepEqual(lastOf(replies), {
      id: 44,
      result: { ok: false, error: "pattern doesn't match the element's text" },
    });
    assert.deepEqual(observed, []);
    // A retry with a pattern that matches is accepted
    await controller.handle(save(44, "orderId", "#(\\d+)"));
    assert.equal(observed.length, 1);
    assert.deepEqual(lastOf(replies), { id: 44, result: { ok: true } });
  });

  it("asks for the element again when it wasn't the one picked, and refuses while paused", async () => {
    const { controller, replies, observed } = withText();
    await controller.handle(pick(45));
    await controller.handle(save(46, "orderId"));
    assert.deepEqual(lastOf(replies), {
      id: 46,
      result: { ok: false, error: "Pick the element again" },
    });
    await controller.handle(msg({ action: "pause" }));
    await controller.handle(save(45, "orderId"));
    assert.deepEqual(lastOf(replies), {
      id: 45,
      result: { ok: false, error: "Nothing you do now is recorded." },
    });
    assert.deepEqual(observed, []);
  });

  it("drops a double click's second copy", async () => {
    const { controller, replies, observed } = withText();
    await controller.handle(pick(47));
    const first = save(47, "orderId");
    assert.equal(controller.accept(first), true);
    await controller.handle(first);
    const again = save(47, "orderId");
    assert.equal(controller.accept(again), false);
    assert.equal(observed.length, 1);
    assert.equal(replies.filter((r) => r.id === 47).length, 2); // the pick and one save
  });

  it("checks the pattern against the text as outputs.save reads it, not the whitespace-collapsed display text", async () => {
    const { controller, replies, observed } = setup(
      {},
      {
        inspect: async (): Promise<Inspection> => ({
          info: {
            ...INFO,
            text: "Order #4521",
            outputText: "Order\n    #4521",
          },
          counts: [COUNT_CALL],
        }),
      },
    );
    await controller.handle(pick(48));
    assert.equal(
      (lastOf(replies)!.result as PickInfo & { ok: true }).outputText,
      "Order\n    #4521",
    );
    await controller.handle(save(48, "orderId", "Order #(\\d+)"));
    assert.deepEqual(lastOf(replies), {
      id: 48,
      result: { ok: false, error: "pattern doesn't match the element's text" },
    });
    await controller.handle(save(48, "orderId", "Order\\s+#(\\d+)"));
    assert.deepEqual(lastOf(replies), { id: 48, result: { ok: true } });
    assert.equal(observed.length, 1);
  });

  it("masks a secret the output text holds, previews on the recorder's side and still saves", async () => {
    const { controller, replies, observed, noSecretLeaks } = setup(
      {},
      {
        inspect: async (): Promise<Inspection> => ({
          info: {
            ...INFO,
            text: "",
            outputText: `Order #96002 for ${SECRET}.`,
          },
          counts: [COUNT_CALL],
        }),
      },
    );
    await controller.handle(pick(49));
    const info = lastOf(replies)!.result as PickInfo & { ok: true };
    assert.equal(info.outputText, `Order #96002 for ${MASK}.`);
    assert.equal(info.showsSecret, true);

    const preview = async (pattern: string) => {
      await controller.handle(
        msg({ action: "output-preview", id: 49, pattern }),
      );
      return lastOf(replies)!;
    };
    assert.deepEqual(await preview("Order #(\\d+)"), {
      id: 49,
      result: {
        preview: true,
        pattern: "Order #(\\d+)",
        ok: true,
        value: "96002",
        secret: false,
      },
    });
    assert.deepEqual((await preview("for (.+)\\.")).result, {
      preview: true,
      pattern: "for (.+)\\.",
      ok: true,
      value: MASK,
      secret: true,
    });
    assert.deepEqual((await preview("")).result, {
      preview: true,
      pattern: "",
      ok: true,
      value: `Order #96002 for ${MASK}.`,
      secret: true,
    });
    assert.deepEqual((await preview("Invoice (\\d+)")).result, {
      preview: true,
      pattern: "Invoice (\\d+)",
      ok: false,
      error: "No match",
    });
    assert.deepEqual((await preview("(")).result, {
      preview: true,
      pattern: "(",
      ok: false,
      error: "Not a valid pattern",
    });
    noSecretLeaks();

    await controller.handle(save(49, "orderId", "Order #(\\d+)"));
    assert.deepEqual(lastOf(replies), { id: 49, result: { ok: true } });
    assert.deepEqual(observed, [
      {
        type: "saveOutput",
        locator: LOCATOR,
        name: "orderId",
        pattern: { source: "Order #(\\d+)", flags: "" },
      },
    ]);
  });

  it("previews only for the element picked with the same id", async () => {
    const { controller, replies } = withText();
    await controller.handle(
      msg({ action: "output-preview", id: 7, pattern: "" }),
    );
    assert.deepEqual(lastOf(replies), {
      id: 7,
      result: {
        preview: true,
        pattern: "",
        ok: false,
        error: "Pick the element again",
      },
    });
  });

  it("previews as outputs.save keeps: the first group, else the whole match", async () => {
    const { controller, replies } = withText();
    await controller.handle(pick(50));
    await controller.handle(
      msg({ action: "output-preview", id: 50, pattern: "#\\d+" }),
    );
    assert.equal((lastOf(replies)!.result as { value: string }).value, "#4521");
    await controller.handle(
      msg({ action: "output-preview", id: 50, pattern: "(x)?#(\\d+)" }),
    );
    assert.equal((lastOf(replies)!.result as { value: string }).value, "#4521");
  });
});
