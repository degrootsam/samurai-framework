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
