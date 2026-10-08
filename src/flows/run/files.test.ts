import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { listFlows, readFlow, readFlows } from "./files.js";

let dir: string;
const flow = (name: string) =>
  JSON.stringify({ id: "ignored", name, nodes: [], edges: [] });

before(() => {
  dir = mkdtempSync(path.join(tmpdir(), "samurai-flow-files-"));
  mkdirSync(path.join(dir, "flows"));
  writeFileSync(path.join(dir, "flows/b-second.flow.json"), flow("Second"));
  writeFileSync(path.join(dir, "flows/a-first.flow.json"), flow("First"));
  writeFileSync(path.join(dir, "flows/notes.md"), "not a flow");
  writeFileSync(path.join(dir, "flows/other.json"), flow("Other"));
  writeFileSync(path.join(dir, "flows/.flow.json"), flow("Nameless"));
});
after(() => rmSync(dir, { recursive: true, force: true }));

describe("flow files", () => {
  it("lists ids in file name order and ignores other files", async () => {
    assert.deepEqual(await listFlows(dir), ["a-first", "b-second"]);
  });

  it("lists nothing when the project has no flows folder", async () => {
    assert.deepEqual(await listFlows(path.join(dir, "flows/missing")), []);
  });

  it("reads a flow; its id is the file name", async () => {
    const f = await readFlow(dir, "b-second");
    assert.equal(f.id, "b-second");
    assert.equal(f.name, "Second");
  });

  it("an unknown flow says which one", async () => {
    await assert.rejects(readFlow(dir, "nope"), /No flow "nope"/);
  });

  it("an id can't leave the flows folder", async () => {
    await assert.rejects(readFlow(dir, "../x"), /isn't a valid flow id/);
  });

  it("an unreadable file is a clear error naming the flow", async () => {
    writeFileSync(path.join(dir, "flows/broken.flow.json"), "{ nope");
    try {
      await assert.rejects(
        readFlow(dir, "broken"),
        /Couldn't read the flow "broken"/,
      );
      await assert.rejects(readFlows(dir), /Couldn't read the flow "broken"/);
    } finally {
      rmSync(path.join(dir, "flows/broken.flow.json"));
    }
  });

  it("reads every flow", async () => {
    assert.deepEqual(
      (await readFlows(dir)).map((f) => f.id),
      ["a-first", "b-second"],
    );
  });
});
