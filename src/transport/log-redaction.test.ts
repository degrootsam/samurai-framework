import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { forLog } from "./log-redaction.js";

describe("forLog", () => {
  it("cuts a long string to its start and length, so a 1 MB file chunk is not logged whole", () => {
    const chunk = "A".repeat(1_400_000);
    const logged = forLog({
      type: "success",
      result: { result: { type: "string", value: chunk } },
    } as never) as { result: { result: { value: string } } };
    assert.ok(logged.result.result.value.length < 300);
    assert.match(
      logged.result.result.value,
      /^A{200}… \(1400000 characters\)$/,
    );
  });

  it("leaves short values, numbers, nulls and the original message alone", () => {
    const message = { id: 1, result: { list: ["a", 2, null], text: "short" } };
    assert.deepEqual(forLog(message as never), message);
    const long = { result: "B".repeat(5000) };
    forLog(long as never);
    assert.equal(long.result.length, 5000, "the message itself is not changed");
  });

  it("still hides the private channels' messages", () => {
    const logged = forLog({
      type: "event",
      method: "script.message",
      params: {
        channel: "samurai-recorder-x",
        data: {
          type: "object",
          value: [
            ["type", { type: "string", value: "toolbar" }],
            ["action", { type: "string", value: "fill" }],
          ],
        },
      },
    } as never) as { params: { data: object } };
    assert.deepEqual(logged.params.data, {
      type: "toolbar",
      action: "fill",
      redacted: true,
    });
  });
});
