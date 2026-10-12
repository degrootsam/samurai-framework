import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import type { FlowFile } from "../core/index.js";
import {
  BUILTIN_STEPS,
  defineStep,
  listSteps,
  projectSteps,
  stepSet,
  validateSteps,
} from "./index.js";

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

const STEPS_ENTRY = JSON.stringify(path.resolve("src/flows/steps/index.ts"));
const projects: string[] = [];
after(() => {
  for (const d of projects) rmSync(d, { recursive: true, force: true });
});
/** A project folder whose samurai.config.ts is `config` */
function project(config: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "samurai-project-steps-"));
  projects.push(dir);
  writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
  writeFileSync(path.join(dir, "samurai.config.ts"), config);
  return dir;
}

describe("project steps", () => {
  test("listSteps lists a step from the project's config after the built-ins", async () => {
    const dir = project(
      `import { defineStep } from ${STEPS_ENTRY};
export default {
  steps: [defineStep({ kind: "ping", label: "Ping", icon: "globe", section: "integrations", fields: [], async run() {} })],
};
`,
    );
    const catalog = await listSteps({ projectDir: dir });
    assert.deepEqual(
      catalog.map((s) => s.kind),
      [...builtinKinds, "ping"],
    );
  });

  test("a project without steps lists the built-ins", async () => {
    const dir = project("export default {};\n");
    assert.deepEqual(
      (await listSteps({ projectDir: dir })).map((s) => s.kind),
      builtinKinds,
    );
  });

  test("a config that fails to import rejects with its error (Review Focus 1)", async () => {
    const dir = project(
      `import { defineStep } from ${STEPS_ENTRY};
export default { steps: [defineStep({ kind: "Bad_Kind", label: "x", icon: "code", section: "control", fields: [], async run() {} })] };
`,
    );
    await assert.rejects(
      listSteps({ projectDir: dir }),
      /isn't a valid step kind/,
    );
  });

  test("a collision in the config rejects", async () => {
    await assert.rejects(
      projectSteps({ config: { steps: [{ ...ping, kind: "wait" }] } }),
      /a built-in step already uses this kind/,
    );
  });

  test("validateSteps runs a project step's validate (Review Focus 3)", async () => {
    const strict = defineStep({
      kind: "strict",
      label: "Strict",
      icon: "code",
      section: "control",
      fields: [],
      validate: (node) => [
        { level: "error", nodeId: node.id, message: "Strict says no." },
      ],
      async run() {},
    });
    const flow: FlowFile = {
      id: "f",
      name: "f",
      nodes: [
        {
          id: "s",
          key: "s",
          kind: "strict",
          onFailure: "stop",
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
    };
    const problems = await validateSteps(flow, { config: { steps: [strict] } });
    assert.deepEqual(
      problems.map((p) => p.message),
      ["Strict says no."],
    );
  });
});
