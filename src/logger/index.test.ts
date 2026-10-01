import { test } from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { transports } from "winston";
import { MASK, registerSecret, resetSecrets } from "../config/mask.js";
import logger from "./index.js";

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
