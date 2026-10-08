import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { main, type Io } from "./main.js";

const API = JSON.stringify(path.resolve("src/api.ts"));

function io(signal?: AbortSignal) {
  const out: string[] = [];
  const err: string[] = [];
  const target: Io = {
    out: (t) => out.push(t),
    err: (t) => err.push(t),
    color: false,
    env: {},
    ...(signal && { signal }),
  };
  return { target, out: () => out.join(""), err: () => err.join("") };
}

type N = { id: string; kind: string; config?: Record<string, unknown> };
function flowJson(name: string, middle: N[], extra: N[] = []) {
  const nodes = [
    { id: "start", kind: "start" },
    ...middle,
    { id: "end", kind: "end" },
    ...extra,
  ];
  const chain = ["start", ...middle.map((n) => n.id), "end"];
  return JSON.stringify({
    id: name,
    name,
    nodes: nodes.map((n) => ({
      onFailure: "stop",
      position: { x: 0, y: 0 },
      ...n,
    })),
    edges: chain.slice(1).map((id, i) => ({
      id: `e${i}`,
      source: chain[i],
      target: id,
    })),
  });
}

const SET: N = {
  id: "set",
  kind: "set-variable",
  config: { name: "order", value: "42" },
};
const API_NODE: N = { id: "http", kind: "api" };

let dir: string;
let previous: string;
const write = (file: string, text: string) =>
  writeFileSync(path.join(dir, file), text);
const report = (id: string) =>
  JSON.parse(readFileSync(path.join(dir, `result/flows/${id}.json`), "utf8"));

beforeEach(() => {
  previous = process.cwd();
  dir = mkdtempSync(path.join(tmpdir(), "samurai-flow-cli-"));
  mkdirSync(path.join(dir, "flows"));
  mkdirSync(path.join(dir, "src"));
  write("package.json", '{"type":"module"}');
  write(
    "samurai.config.ts",
    "export default { environments: { dev: { variables: { region: 'us' } } } };",
  );
  write(
    "src/login.spec.ts",
    `import { test } from ${API};\ntest("works", async () => {});`,
  );
  write("flows/a-good.flow.json", flowJson("Good", [SET]));
  write("flows/b-wait.flow.json", flowJson("Wait", [SET]));
  process.chdir(dir);
});
afterEach(() => process.chdir(previous));

describe("samurai flow", () => {
  it("exits 2 with the usage for an unknown flow command", async () => {
    for (const argv of [["flow"], ["flow", "bogus"], ["flow", "run"]]) {
      const r = io();
      assert.equal(await main(argv, r.target), 2);
      assert.match(r.err(), /Usage:/);
    }
  });

  it("list shows ids, names and node counts, and flows it can't read", async () => {
    write("flows/c-broken.flow.json", "{ nope");
    const r = io();
    assert.equal(await main(["flow", "list"], r.target), 0);
    assert.match(r.out(), /a-good {2}Good {2}\(3 nodes\)/);
    assert.match(r.out(), /c-broken {2}\(unreadable: /);
    const json = io();
    assert.equal(await main(["flow", "list", "--json"], json.target), 0);
    const rows = JSON.parse(json.out());
    assert.equal(rows.length, 3);
    assert.equal(rows[0].name, "Good");
    assert.ok(rows[2].error);
  });

  it("check exits 0 for a good flow", async () => {
    const r = io();
    assert.equal(await main(["flow", "check", "a-good"], r.target), 0);
    assert.match(r.out(), /a-good: ok/);
  });

  it("check exits 1 for an unsupported node and 0 with --allow-unsupported (a warning)", async () => {
    write("flows/c-http.flow.json", flowJson("Http", [API_NODE]));
    const r = io();
    assert.equal(await main(["flow", "check", "c-http"], r.target), 1);
    assert.match(r.out(), /✖ error {2}.*HTTP request can't run yet/);
    const allowed = io();
    assert.equal(
      await main(
        ["flow", "check", "c-http", "--allow-unsupported"],
        allowed.target,
      ),
      0,
    );
    assert.match(allowed.out(), /warning/);
  });

  it("check knows the project's tests, and --json prints the problems", async () => {
    const node: N = { id: "t", kind: "test" };
    const text = JSON.parse(flowJson("Gone", [node]));
    text.nodes.find((n: { id: string }) => n.id === "t").ref = {
      testId: "login.spec.ts::gone",
    };
    write("flows/d-gone.flow.json", JSON.stringify(text));
    const r = io();
    assert.equal(
      await main(["flow", "check", "d-gone", "--json"], r.target),
      1,
    );
    const problems = JSON.parse(r.out());
    assert.equal(problems[0].level, "error");
    assert.equal(problems[0].flow, "d-gone");
    assert.equal(problems[0].nodeId, "t");
  });

  it("check exits 2 for an unreadable or missing flow, or no flows folder", async () => {
    const missing = io();
    assert.equal(await main(["flow", "check", "nope"], missing.target), 2);
    assert.match(missing.err(), /No flow "nope"/);
    const empty = mkdtempSync(path.join(tmpdir(), "samurai-flow-cli-empty-"));
    write("flows/x.flow.json", "{");
    process.chdir(empty);
    writeFileSync(path.join(empty, "samurai.config.ts"), "export default {};");
    const none = io();
    assert.equal(await main(["flow", "check"], none.target), 2);
    assert.match(none.err(), /No flows/);
  });

  it("run walks the flow, prints it, exits 0 and writes the report", async () => {
    const r = io();
    assert.equal(await main(["flow", "run", "a-good"], r.target), 0);
    assert.match(r.out(), /Flow "Good" against dev/);
    assert.match(r.out(), /✔ Set variable vars\.order/);
    assert.match(r.out(), /1 passed \(/);
    const rep = report("a-good");
    assert.equal(rep.status, "passed");
    assert.equal(rep.flow, "a-good");
    assert.equal(rep.environment, "dev");
    assert.deepEqual(rep.vars, { order: 42 });
    assert.deepEqual(rep.tests, []);
    assert.equal(typeof rep.durationMs, "number");
  });

  it("run takes a path, and --json prints one FlowEvent per line", async () => {
    const r = io();
    assert.equal(
      await main(["flow", "run", "flows/a-good.flow.json", "--json"], r.target),
      0,
    );
    const events = r
      .out()
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    assert.equal(events[0].type, "flow-start");
    assert.equal(events[events.length - 1].type, "flow-end");
    assert.equal(events[events.length - 1].summary.status, "passed");
  });

  it("run checks first: an unsupported node refuses the flow, nothing runs, no report", async () => {
    write("flows/c-http.flow.json", flowJson("Http", [SET, API_NODE]));
    const r = io();
    assert.equal(await main(["flow", "run", "c-http"], r.target), 2);
    assert.match(r.err(), /HTTP request can't run yet/);
    assert.match(r.err(), /Nothing was run/);
    assert.equal(r.out(), "");
    assert.throws(() => report("c-http"));
  });

  it("--allow-unsupported skips those nodes and the flow can pass", async () => {
    write("flows/c-http.flow.json", flowJson("Http", [SET, API_NODE]));
    const r = io();
    assert.equal(
      await main(["flow", "run", "c-http", "--allow-unsupported"], r.target),
      0,
    );
    assert.match(r.out(), /⊘ HTTP request \(skipped: Not supported yet\)/);
    assert.match(r.out(), /1 passed, 1 skipped/);
    assert.equal(report("c-http").nodes.http.status, "skipped");
  });

  it("a failing node exits 1 and still writes the report", async () => {
    const bad: N = {
      id: "bad",
      kind: "set-variable",
      config: { name: "x", value: '"a" - 1' },
    };
    write("flows/e-fail.flow.json", flowJson("Fail", [bad], []));
    const r = io();
    const code = await main(
      ["flow", "run", "e-fail", "--allow-unsupported"],
      r.target,
    );
    assert.equal(code, 1, r.err() + r.out());
    assert.match(r.out(), /✖ Set variable/);
    assert.equal(report("e-fail").status, "failed");
  });

  it("--all runs every flow in file name order, one report each", async () => {
    const r = io();
    assert.equal(await main(["flow", "run", "--all"], r.target), 0);
    assert.ok(r.out().indexOf('Flow "Good"') < r.out().indexOf('Flow "Wait"'));
    assert.equal(report("a-good").status, "passed");
    assert.equal(report("b-wait").status, "passed");
  });

  it("run with flows and --all together is a usage error", async () => {
    const r = io();
    assert.equal(await main(["flow", "run", "a-good", "--all"], r.target), 2);
  });

  it("SIGINT mid-flow ends the run cancelled, writes the report and exits 1", async () => {
    write(
      "flows/f-slow.flow.json",
      flowJson("Slow", [SET, { id: "w", kind: "wait", config: { ms: 30000 } }]),
    );
    const controller = new AbortController();
    const r = io(controller.signal);
    setTimeout(() => controller.abort(), 500);
    assert.equal(await main(["flow", "run", "f-slow"], r.target), 1);
    const rep = report("f-slow");
    assert.equal(rep.status, "cancelled");
    assert.equal(rep.nodes.set.status, "passed");
    assert.equal(rep.nodes.w.status, "not-run");
    assert.match(r.out(), /Cancelled/);
  });
});
