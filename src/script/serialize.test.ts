import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RemoteValue } from "../types/bidi-modules/script.js";
import { ElementHandle } from "./element-handle.js";
import { fromRemoteValue, RemoteObject, toLocalValue } from "./serialize.js";

describe("toLocalValue", () => {
  it("serializes primitives", () => {
    assert.deepEqual(toLocalValue(undefined), { type: "undefined" });
    assert.deepEqual(toLocalValue(null), { type: "null" });
    assert.deepEqual(toLocalValue(true), { type: "boolean", value: true });
    assert.deepEqual(toLocalValue("a\"b'c\\d\n"), { type: "string", value: "a\"b'c\\d\n" });
    assert.deepEqual(toLocalValue(12.5), { type: "number", value: 12.5 });
    assert.deepEqual(toLocalValue(10n), { type: "bigint", value: "10" });
  });

  it("serializes the special numbers", () => {
    assert.deepEqual(toLocalValue(NaN), { type: "number", value: "NaN" });
    assert.deepEqual(toLocalValue(Infinity), { type: "number", value: "Infinity" });
    assert.deepEqual(toLocalValue(-Infinity), { type: "number", value: "-Infinity" });
    assert.deepEqual(toLocalValue(-0), { type: "number", value: "-0" });
    assert.deepEqual(toLocalValue(0), { type: "number", value: 0 });
  });

  it("serializes dates and regular expressions", () => {
    assert.deepEqual(toLocalValue(new Date("2026-09-29T10:00:00.000Z")), {
      type: "date",
      value: "2026-09-29T10:00:00.000Z",
    });
    assert.deepEqual(toLocalValue(/ab+c/gi), { type: "regexp", value: { pattern: "ab+c", flags: "gi" } });
  });

  it("serializes arrays, sets, maps and plain objects, nested", () => {
    assert.deepEqual(toLocalValue([1, "a"]), {
      type: "array",
      value: [
        { type: "number", value: 1 },
        { type: "string", value: "a" },
      ],
    });
    assert.deepEqual(toLocalValue(new Set([1])), { type: "set", value: [{ type: "number", value: 1 }] });
    assert.deepEqual(toLocalValue(new Map<unknown, unknown>([["k", true], [2, null]])), {
      type: "map",
      value: [
        ["k", { type: "boolean", value: true }],
        [{ type: "number", value: 2 }, { type: "null" }],
      ],
    });
    assert.deepEqual(toLocalValue({ a: { b: [undefined] } }), {
      type: "object",
      value: [
        [
          "a",
          {
            type: "object",
            value: [["b", { type: "array", value: [{ type: "undefined" }] }]],
          },
        ],
      ],
    });
    assert.deepEqual(toLocalValue(Object.create(null)), { type: "object", value: [] });
  });

  it("serializes an ElementHandle as a shared reference", () => {
    assert.deepEqual(toLocalValue(new ElementHandle("node-1")), { sharedId: "node-1" });
    assert.deepEqual(toLocalValue(new ElementHandle("node-1", "h1")), { sharedId: "node-1", handle: "h1" });
  });

  it("rejects what cannot cross the wire", () => {
    assert.throws(() => toLocalValue(() => 1), /cannot serialize function/);
    assert.throws(() => toLocalValue(Symbol("s")), /cannot serialize symbol/);
    assert.throws(() => toLocalValue(new (class Foo {})()), /cannot serialize Foo/);
    assert.throws(() => toLocalValue(Buffer.from("a")), /cannot serialize Buffer/);
    assert.throws(() => toLocalValue({ nested: () => 1 }), /cannot serialize function/);
  });

  it("rejects cycles and absurd depth", () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    assert.throws(() => toLocalValue(loop), /circular/);
    const list: unknown[] = [];
    list.push(list);
    assert.throws(() => toLocalValue(list), /circular/);
    let deep: unknown = 1;
    for (let i = 0; i < 150; i++) deep = [deep];
    assert.throws(() => toLocalValue(deep), /too deeply nested/);
  });

  it("allows the same object twice when it is not a cycle", () => {
    const shared = { a: 1 };
    assert.doesNotThrow(() => toLocalValue([shared, shared]));
  });
});

describe("fromRemoteValue", () => {
  it("deserializes primitives and special numbers", () => {
    assert.equal(fromRemoteValue({ type: "undefined" }), undefined);
    assert.equal(fromRemoteValue({ type: "null" }), null);
    assert.equal(fromRemoteValue({ type: "string", value: "x" }), "x");
    assert.equal(fromRemoteValue({ type: "boolean", value: false }), false);
    assert.equal(fromRemoteValue({ type: "number", value: 3 }), 3);
    assert.ok(Number.isNaN(fromRemoteValue({ type: "number", value: "NaN" } as never)));
    assert.equal(fromRemoteValue({ type: "number", value: "Infinity" } as never), Infinity);
    assert.equal(fromRemoteValue({ type: "number", value: "-Infinity" } as never), -Infinity);
    assert.ok(Object.is(fromRemoteValue({ type: "number", value: "-0" } as never), -0));
    assert.equal(fromRemoteValue({ type: "bigint", value: "12345678901234567890" } as never), 12345678901234567890n);
  });

  it("deserializes dates and regular expressions", () => {
    const date = fromRemoteValue({ type: "date", value: "2026-09-29T10:00:00.000Z" }) as Date;
    assert.equal(date.toISOString(), "2026-09-29T10:00:00.000Z");
    const regexp = fromRemoteValue({ type: "regexp", value: { pattern: "a+", flags: "i" } } as never) as RegExp;
    assert.equal(regexp.source, "a+");
    assert.equal(regexp.flags, "i");
  });

  it("deserializes collections, nested", () => {
    const value: RemoteValue = {
      type: "object",
      value: [
        ["list", { type: "array", value: [{ type: "number", value: 1 }, { type: "string", value: "a" }] }],
        [{ type: "number", value: 5 }, { type: "null" }],
        ["set", { type: "set", value: [{ type: "boolean", value: true }] } as never],
        ["map", { type: "map", value: [["k", { type: "number", value: 2 }]] } as never],
      ],
    };
    const result = fromRemoteValue(value) as Record<string, unknown>;
    assert.deepEqual(result.list, [1, "a"]);
    assert.equal(result["5"], null);
    assert.deepEqual([...(result.set as Set<unknown>)], [true]);
    assert.deepEqual([...(result.map as Map<unknown, unknown>)], [["k", 2]]);
  });

  it("turns a node into an ElementHandle", () => {
    const handle = fromRemoteValue({ type: "node", sharedId: "n1", handle: "h1", value: {} } as never);
    assert.ok(handle instanceof ElementHandle);
    assert.equal(handle.sharedId, "n1");
    assert.equal(handle.handle, "h1");
  });

  it("returns an opaque RemoteObject for values that cannot be copied", () => {
    for (const type of ["function", "window", "promise", "symbol", "error", "weakmap"]) {
      const value = fromRemoteValue({ type, handle: "h" } as never);
      assert.ok(value instanceof RemoteObject, type);
      assert.equal((value as RemoteObject).type, type);
      assert.equal((value as RemoteObject).handle, "h");
    }
  });

  it("returns a RemoteObject for an object cut off by the serialization depth", () => {
    const value = fromRemoteValue({ type: "object", handle: "h" } as never);
    assert.ok(value instanceof RemoteObject);
  });

  it("resolves internalId back references, cycles included", () => {
    const value = {
      type: "object",
      internalId: "1",
      value: [["self", { type: "object", internalId: "1" }]],
    } as RemoteValue;
    const result = fromRemoteValue(value) as { self: unknown };
    assert.equal(result.self, result);
  });

  it("keeps handles when asked, attaching the deserialized value", () => {
    const value = { type: "object", handle: "h", value: [["a", { type: "number", value: 1 }]] } as RemoteValue;
    const kept = fromRemoteValue(value, { keepHandles: true }) as RemoteObject;
    assert.ok(kept instanceof RemoteObject);
    assert.equal(kept.handle, "h");
    assert.deepEqual(kept.value, { a: 1 });
    assert.deepEqual(fromRemoteValue(value), { a: 1 });
  });
});

describe("round trip", () => {
  it("survives toLocalValue → fromRemoteValue for plain data", () => {
    const data = { a: [1, "two", { three: true }], n: null, d: new Date(0), big: 5n };
    // A local value has the same shape a remote value has for these types, except `value` keys
    const remote = toLocalValue(data) as unknown as RemoteValue;
    assert.deepEqual(fromRemoteValue(remote), data);
  });
});
