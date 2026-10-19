import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { initScriptSource } from "./init-script.js";

describe("initScriptSource", () => {
  it("wraps a string script as a function body", () => {
    assert.equal(
      initScriptSource("window.x = 1;", undefined),
      "() => {\nwindow.x = 1;\n}",
    );
  });

  it("refuses an argument for a string script", () => {
    assert.throws(
      () => initScriptSource("window.x = 1;", { a: 1 }),
      /does not take an argument/,
    );
  });

  it("calls a function with its argument embedded as JSON", () => {
    const source = initScriptSource((flags: { debug: boolean }) => void flags, {
      debug: true,
    });
    assert.match(source, /^\(\) => \(.*\)\(\{"debug":true\}\)$/s);
  });

  it("calls a function without an argument with undefined", () => {
    assert.match(
      initScriptSource(() => {}, undefined),
      /\)\(undefined\)$/,
    );
  });

  it("refuses an argument that cannot be serialised", () => {
    assert.throws(
      () =>
        initScriptSource(
          () => {},
          () => 1,
        ),
      /JSON-serializable/,
    );
  });
});
