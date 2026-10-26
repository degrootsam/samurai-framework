import assert from "node:assert/strict";
import { test } from "node:test";
import { captured } from "./text-match.js";

test("captured gives the first group, else the whole match, else the whole text", () => {
  assert.equal(captured(/Order #(\d+)/, "Order #12345 placed"), "12345");
  assert.equal(captured(/Order #\d+/, "Order #77 placed"), "Order #77");
  assert.equal(captured("Done", "Done"), "Done");
  assert.equal(captured(/x/, "no match"), "no match");
});

test("captured ignores the global and sticky flags and a used lastIndex", () => {
  const global = /Order #(\d+)/g;
  global.lastIndex = 12;
  assert.equal(captured(global, "Order #12345"), "12345");
  assert.equal(captured(global, "Order #12345"), "12345");
  assert.equal(captured(/(\d+)/y, "ab 42"), "42");
});

test("captured keeps an empty first group", () => {
  assert.equal(captured(/a(b*)c/, "ac"), "");
});
