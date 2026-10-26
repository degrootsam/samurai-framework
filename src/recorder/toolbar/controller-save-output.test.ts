import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Inspection } from "./types.js";
import {
  CANDIDATES,
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
        info: { ...INFO, text: TEXT },
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
    for (const name of [
      "",
      "1st",
      "order id",
      "status",
      "durationMs",
      "error",
    ]) {
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
});
