import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import logger from "../logger/index.js";
import { withProject } from "./project.js";

test("a project session writes the log to the project's logs folder, and stops when it ends", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "samurai-project-logs-"));
  const before = logger.transports.length;

  await withProject({ projectDir: dir, config: {} }, async () => {
    logger.warn("inside the session");
  });

  assert.equal(logger.transports.length, before, "the files closed again");
  logger.warn("after the session");
  await new Promise((resolve) => setTimeout(resolve, 100));
  const combined = readFileSync(path.join(dir, "logs", "combined.log"), "utf8");
  assert.match(combined, /inside the session/);
  assert.doesNotMatch(combined, /after the session/);
  assert.ok(existsSync(path.join(dir, "logs", "error.log")));
});
