import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { io } from "../testing/cli-io.js";
import { main, USAGE } from "./main.js";

describe("main", () => {
  it("prints the usage for --help, -h and help", async () => {
    for (const argv of [["--help"], ["-h"], ["help"], ["run", "--help"]]) {
      const { target, out } = io();
      assert.equal(await main(argv, target), 0);
      assert.equal(out(), USAGE);
    }
  });

  it("prints the version", async () => {
    const { target, out } = io();
    assert.equal(await main(["--version"], target), 0);
    assert.match(out(), /^\d+\.\d+\.\d+/);
  });

  it("exits 2 for an unknown command, with the usage", async () => {
    const { target, err } = io();
    assert.equal(await main(["bogus"], target), 2);
    assert.match(err(), /Unknown command "bogus"/);
    assert.match(err(), /Usage:/);
  });

  it("exits 2 for an unknown flag or a bad value, with a message", async () => {
    const flag = io();
    assert.equal(await main(["run", "--nope"], flag.target), 2);
    assert.match(flag.err(), /nope/);
    const port = io();
    assert.equal(await main(["run", "--port", "abc"], port.target), 2);
    assert.match(port.err(), /--port/);
    const workers = io();
    assert.equal(await main(["run", "--workers", "0"], workers.target), 2);
    assert.match(workers.err(), /--workers must be a whole number from 1/);
    const retries = io();
    assert.equal(await main(["run", "--retries", "abc"], retries.target), 2);
    assert.match(retries.err(), /--retries must be a whole number from 0/);
    const negative = io();
    assert.equal(await main(["run", "--retries=-1"], negative.target), 2);
    assert.match(negative.err(), /--retries must be a whole number from 0/);
    const shard = io();
    assert.equal(await main(["run", "--shard=3/2"], shard.target), 2);
    assert.match(
      shard.err(),
      /^--shard: expected current\/total with 1 <= current <= total, got "3\/2"/,
    );
  });

  it("documents --shard in the usage", () => {
    assert.match(USAGE, /--shard <current\/total>/);
  });

  it("documents --retries in the usage, for run and for flow run", () => {
    assert.match(USAGE, /--retries <n>/);
    assert.match(USAGE, /SAMURAI_RETRIES/);
  });

  it("exits 2 for a config whose retries is not a whole number from 0, naming the key", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "samurai-cli-"));
    writeFileSync(
      path.join(dir, "samurai.config.ts"),
      "export default { retries: -1 };",
    );
    writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
    const previous = process.cwd();
    process.chdir(dir);
    try {
      const { target, err } = io();
      assert.equal(await main(["list"], target), 2);
      assert.match(err(), /^retries must be a whole number from 0, got "-1"/);
    } finally {
      process.chdir(previous);
    }
  });

  it("documents --workers in the usage", () => {
    assert.match(USAGE, /--workers <n\|n%>/);
  });

  it("exits 2 for a config whose workers is not a count or a percentage, naming the key", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "samurai-cli-"));
    writeFileSync(
      path.join(dir, "samurai.config.ts"),
      'export default { workers: 0, groups: [{ name: "a", workers: "2%" }] };',
    );
    writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
    const previous = process.cwd();
    process.chdir(dir);
    try {
      const { target, err } = io();
      assert.equal(await main(["list"], target), 2);
      assert.match(
        err(),
        /^workers must be a whole number from 1 or a percentage/,
      );
    } finally {
      process.chdir(previous);
    }
  });

  it("exits 2 when the project has no config", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "samurai-cli-"));
    const previous = process.cwd();
    process.chdir(dir);
    try {
      const { target, err } = io();
      assert.equal(await main(["list"], target), 2);
      assert.ok(err().length > 0);
    } finally {
      process.chdir(previous);
    }
  });

  it("record needs a spec and a sensible --at", async () => {
    const none = io();
    assert.equal(await main(["record"], none.target), 2);
    assert.match(none.err(), /Which spec/);
    const bad = io();
    assert.equal(
      await main(["record", "a.spec.ts", "--at", "x"], bad.target),
      2,
    );
    assert.match(bad.err(), /--at/);
  });

  it("record refuses a spec that does not exist unless --new is given", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "samurai-cli-"));
    writeFileSync(path.join(dir, "samurai.config.ts"), "export default {};");
    const previous = process.cwd();
    process.chdir(dir);
    try {
      const { target, err } = io();
      assert.equal(await main(["record", "tests/none.spec.ts"], target), 2);
      assert.match(err(), /does not exist/);
    } finally {
      process.chdir(previous);
    }
  });

  it("exits 2 for a config that still has the removed browser key, saying what to write", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "samurai-cli-"));
    writeFileSync(
      path.join(dir, "samurai.config.ts"),
      'export default { browser: "chrome" };',
    );
    writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
    const previous = process.cwd();
    process.chdir(dir);
    try {
      const { target, err } = io();
      assert.equal(await main(["run"], target), 2);
      assert.match(
        err(),
        /"browser" was replaced by "browsers": use browsers: \["chrome"\]/,
      );
    } finally {
      process.chdir(previous);
    }
  });
});
