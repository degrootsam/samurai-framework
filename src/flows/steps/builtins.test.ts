import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { CLOSED_KINDS, FLOWS_API, type FlowFile } from "../core/index.js";
import { runFlow } from "../run/run.js";
import { STEPS, listSteps, stepCatalog, validateSteps } from "./index.js";

const at = (id: string, kind: string, config?: Record<string, unknown>) => ({
  id,
  key: id,
  kind,
  onFailure: "stop" as const,
  position: { x: 0, y: 0 },
  ...(config ? { config } : {}),
});
const chain = (...nodes: ReturnType<typeof at>[]): FlowFile => ({
  id: "f",
  name: "f",
  nodes: [at("start", "start"), ...nodes, at("end", "end")],
  edges: ["start", ...nodes.map((n) => n.id), "end"]
    .slice(1)
    .map((id, i, all) => ({
      id: `e${i}`,
      source: i === 0 ? "start" : all[i - 1]!,
      target: id,
    })),
});
const run = (flow: FlowFile, signal?: AbortSignal) =>
  runFlow({
    flow,
    nodeTests: {},
    environment: { name: "dev", variables: {} },
    runTests: async () => "passed",
    ...(signal && { signal }),
  });

let server: Server;
let base = "";
before(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.url === "/slow") return setTimeout(() => res.end("late"), 2000);
      res.statusCode = req.url === "/missing" ? 404 : 200;
      res.end(`${req.method} ${body}`);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

describe("built-in steps", () => {
  test("the catalog: wait, set-variable, api; JSON-safe; no closed kinds; API 2", async () => {
    const catalog = await listSteps();
    assert.deepEqual(
      catalog.map((s) => s.kind),
      ["wait", "set-variable", "api"],
    );
    assert.deepEqual(JSON.parse(JSON.stringify(catalog)), catalog);
    assert.ok(catalog.every((s) => !("run" in s) && !("validate" in s)));
    assert.ok(STEPS.every((s) => !CLOSED_KINDS.includes(s.kind)));
    assert.deepEqual(stepCatalog(), catalog);
    assert.equal(FLOWS_API, 2);
  });

  test("Wait waits; Set variable writes; HTTP request outputs status and body", async () => {
    const s = await run(
      chain(
        at("w", "wait", { ms: 1 }),
        at("v", "set-variable", { name: "path", value: '"/ok"' }),
        at("h", "api", {
          method: "POST",
          url: `"${base}" + vars.path`,
          body: '{"a":1}',
        }),
      ),
    );
    assert.equal(s.status, "passed");
    assert.deepEqual(s.vars, { path: "/ok" });
    assert.deepEqual(s.nodes.h!.outputs, {
      statusCode: 200,
      body: 'POST {"a":1}',
    });
  });

  test("a 404 passes with its status (Review Focus 2); a bad URL fails", async () => {
    const s = await run(chain(at("h", "api", { url: `"${base}/missing"` })));
    assert.equal(s.nodes.h!.status, "passed");
    assert.equal(s.nodes.h!.outputs!.statusCode, 404);
    const bad = await run(chain(at("h", "api", { url: '"not a url"' })));
    assert.equal(bad.nodes.h!.status, "failed");
  });

  test("Stop during a request cancels the run", async () => {
    const abort = new AbortController();
    setTimeout(() => abort.abort(), 50);
    const s = await run(
      chain(at("h", "api", { url: `"${base}/slow"` })),
      abort.signal,
    );
    assert.equal(s.status, "cancelled");
  });

  test("field defaults", () => {
    assert.deepEqual(
      (stepCatalog()[0]!.fields[0]! as { default?: unknown }).default,
      1000,
    );
  });

  test("validateSteps runs only the steps' own validate", () => {
    assert.deepEqual(
      validateSteps(
        chain(at("v", "set-variable", { name: "", value: "1" })),
        {},
      ),
      [],
    );
  });
});
