import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatSize, humanSize, parseSize, sizeFromSource } from "./files.js";

describe("file sizes", () => {
  it("parses bytes and texts with units, powers of 1024", () => {
    assert.equal(parseSize(1024), 1024);
    assert.equal(parseSize("60 MB"), 60 * 1024 ** 2);
    assert.equal(parseSize("1.5 GB"), 1.5 * 1024 ** 3);
    assert.equal(parseSize("512kb"), 512 * 1024);
    assert.equal(parseSize("10 B"), 10);
    assert.equal(parseSize("0 MB"), 0);
  });

  it("rejects what isn't a size", () => {
    for (const bad of [
      -1,
      1.5,
      Number.NaN,
      "",
      "MB",
      "10 TB",
      "ten MB",
      "1e3 MB",
    ])
      assert.equal(parseSize(bad as number | string), undefined, String(bad));
  });

  it("formats with the largest unit that gives a whole number", () => {
    assert.equal(formatSize(60 * 1024 ** 2), "60 MB");
    assert.equal(formatSize(1.5 * 1024 ** 2), "1536 KB");
    assert.equal(formatSize(1536), "1536 B");
    assert.equal(formatSize(2 * 1024 ** 3), "2 GB");
    assert.equal(formatSize(0), "0 B");
  });

  it("shows sizes to people with one decimal", () => {
    assert.equal(humanSize(300 * 1024 ** 2), "300 MB");
    assert.equal(humanSize(314572801), "300 MB");
    assert.equal(humanSize(1.25 * 1024 ** 3), "1.3 GB");
    assert.equal(humanSize(900), "900 B");
  });

  it("reads a size back from its source text", () => {
    assert.equal(sizeFromSource(`"60 MB"`), 60 * 1024 ** 2);
    assert.equal(sizeFromSource(`'1 KB'`), 1024);
    assert.equal(sizeFromSource("2048"), 2048);
    assert.equal(sizeFromSource("size"), undefined);
  });
});
