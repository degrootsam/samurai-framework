import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { BUILTIN_STEPS, defineStep, stepSet } from "./index.js";

const ping = defineStep({
  kind: "ping",
  label: "Ping",
  icon: "globe",
  section: "integrations",
  fields: [],
  async run() {},
});
const builtinKinds = BUILTIN_STEPS.map((s) => s.kind);

describe("stepSet", () => {
  test("built-ins only without project steps, and with an empty list", () => {
    for (const set of [stepSet(), stepSet([])]) {
      assert.deepEqual(
        set.steps.map((s) => s.kind),
        builtinKinds,
      );
      assert.deepEqual(Object.keys(set.handlers), builtinKinds);
      assert.deepEqual(
        set.nodes.map((n) => n.kind),
        builtinKinds,
      );
    }
  });

  test("project steps come after the built-ins, in nodes, handlers and catalog", () => {
    const set = stepSet([ping]);
    assert.deepEqual(
      set.steps.map((s) => s.kind),
      [...builtinKinds, "ping"],
    );
    assert.equal(set.nodes[set.nodes.length - 1]!.kind, "ping");
    assert.equal(typeof set.handlers.ping, "function");
    assert.equal(set.catalog[set.catalog.length - 1]!.label, "Ping");
  });

  test("the catalog is plain data", () => {
    const catalog = stepSet([ping]).catalog;
    assert.deepEqual(JSON.parse(JSON.stringify(catalog)), catalog);
    assert.equal(JSON.stringify(catalog).includes("function"), false);
  });

  test("refuses a built-in kind", () => {
    assert.throws(() => stepSet([{ ...ping, kind: "api" }]), {
      message:
        'Step "api" (samurai.config.ts): a built-in step already uses this kind.',
    });
  });

  test("refuses a kind declared twice", () => {
    assert.throws(() => stepSet([ping, { ...ping }]), {
      message: 'Step "ping" (samurai.config.ts): declared twice.',
    });
  });

  test("refuses a closed kind with the config named", () => {
    assert.throws(
      () => stepSet([{ ...ping, kind: "condition" }]),
      /Step "condition" \(samurai\.config\.ts\): .*closed kind/,
    );
  });

  test("refuses a plain object without run", () => {
    const { run: _run, ...rest } = ping;
    void _run;
    assert.throws(() => stepSet([rest]), {
      message: 'Step "ping" (samurai.config.ts): run must be a function.',
    });
  });

  test("refuses an entry without a kind, numbered from 1", () => {
    assert.throws(() => stepSet([ping, { label: "x" }]), {
      message:
        "Step #2 (samurai.config.ts): it has no kind; make it with defineStep.",
    });
    assert.throws(() => stepSet([null]), /Step #1/);
  });

  test("refuses steps that aren't a list", () => {
    assert.throws(() => stepSet(ping), {
      message: "samurai.config.ts: steps must be a list of steps.",
    });
  });
});
