import { test } from "node:test";
import assert from "node:assert/strict";
import { splitFrontMatter } from "./front-matter.js";

test("a plan without front matter is returned as it is", () => {
  const text = "# Plan: x\n\n## Steps\n1. a\n";
  assert.deepEqual(splitFrontMatter(text), { front: "", body: text });
});

test("a leading block is split off, whatever it holds", () => {
  const { front, body } = splitFrontMatter(
    "---\nstatus: ready\nweird: [: {\n---\n\n# Plan: x\n",
  );
  assert.equal(front, "---\nstatus: ready\nweird: [: {\n---\n");
  assert.equal(body, "\n# Plan: x\n");
});

test("a --- later in the file is not front matter", () => {
  const text = "# Plan: x\n---\nsome: thing\n---\n";
  assert.equal(splitFrontMatter(text).front, "");
});

test("an opening fence without a closing one throws", () => {
  assert.throws(
    () => splitFrontMatter("---\nstatus: ready\n# Plan: x\n"),
    /no closing "---"/,
  );
});

test("CRLF fences are accepted", () => {
  assert.equal(splitFrontMatter("---\r\na: 1\r\n---\r\nrest").body, "rest");
});
