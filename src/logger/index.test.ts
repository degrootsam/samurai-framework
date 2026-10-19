import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { transports } from "winston";
import { MASK, registerSecret, resetSecrets } from "../config/mask.js";
import logger, { consoleLine, keepLogFiles } from "./index.js";

test("the real logger masks registered secrets in messages and metadata", () => {
  let out = "";
  const transport = new transports.Stream({
    stream: new Writable({
      write(chunk, _enc, done) {
        out += String(chunk);
        done();
      },
    }),
  });
  logger.add(transport);
  registerSecret("TEST_CARD", "4242424242424242");
  try {
    logger.info("paying with 4242424242424242", { card: "4242424242424242" });
  } finally {
    logger.remove(transport);
    resetSecrets();
  }
  assert.ok(out.includes(MASK), out);
  assert.ok(!out.includes("4242424242424242"), out);
});

test("a console line prints its own metadata, and nothing for a line without any", () => {
  assert.equal(consoleLine({ level: "info", message: "plain" }), "INFO: plain");
  assert.equal(
    consoleLine({ level: "info", message: "plain", meta: {} }),
    "INFO: plain",
  );
  assert.equal(
    consoleLine({
      level: "debug",
      message: "tagged",
      meta: { service: "samurai-framework" },
    }),
    "DEBUG: tagged",
    "the service every line carries is not metadata",
  );
  assert.equal(
    consoleLine({
      level: "warn",
      message: "with",
      meta: { service: "x", id: 3 },
    }),
    'WARN: with\n{"id":3}',
  );
});

test("the log writes no file until a project keeps its log files, and the files close with the last holder", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "samurai-logs-"));
  assert.equal(
    logger.transports.length,
    1,
    "only the console at import: nothing is created in the working directory",
  );

  const first = keepLogFiles(dir);
  const second = keepLogFiles(dir);
  logger.error("first line");
  first();
  logger.info("still written");
  second();
  logger.info("after the last holder");
  second();
  assert.equal(logger.transports.length, 1);
  await new Promise((resolve) => setTimeout(resolve, 100));

  const combined = readFileSync(path.join(dir, "logs", "combined.log"), "utf8");
  assert.match(combined, /first line/);
  assert.match(combined, /still written/);
  assert.doesNotMatch(combined, /after the last holder/);
  const errors = readFileSync(path.join(dir, "logs", "error.log"), "utf8");
  assert.match(errors, /first line/);
  assert.doesNotMatch(errors, /still written/);
});
