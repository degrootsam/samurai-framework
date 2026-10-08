import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { NODES } from "../../core/index.js";
import { HANDLERS, UNSUPPORTED } from "./index.js";

describe("handlers", () => {
  test("every core kind has a handler or is listed as unsupported, never both", () => {
    for (const def of NODES) {
      const handled = def.kind in HANDLERS;
      const unsupported = UNSUPPORTED.includes(def.kind);
      assert.ok(
        handled !== unsupported,
        `${def.kind}: handled=${handled}, unsupported=${unsupported}`,
      );
    }
  });

  test("every handler and every unsupported entry has a core kind", () => {
    const kinds = new Set(NODES.map((d) => d.kind));
    for (const kind of [...Object.keys(HANDLERS), ...UNSUPPORTED])
      assert.ok(kinds.has(kind), `${kind} is not a core kind`);
  });
});
