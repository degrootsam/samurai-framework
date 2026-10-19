import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  cleanFileName,
  filesFolder,
  isFolderIgnored,
  storeFile,
} from "./files-store.js";

const project = () => mkdtempSync(path.join(tmpdir(), "samurai-store-"));
function content(text: string) {
  const file = path.join(
    mkdtempSync(path.join(tmpdir(), "samurai-content-")),
    "content",
  );
  writeFileSync(file, text);
  return file;
}

const prefix = (text: string) =>
  createHash("sha256").update(text).digest("hex").slice(0, 8);

describe("cleanFileName", () => {
  it("keeps a plain name", () =>
    assert.equal(cleanFileName("avatar.png"), "avatar.png"));
  it("drops folders, control characters and leading dots", () => {
    assert.equal(cleanFileName("../../etc/passwd"), "passwd");
    assert.equal(cleanFileName("C:\\Users\\sam\\cv.pdf"), "cv.pdf");
    assert.equal(cleanFileName("a\u0000b\nc.txt"), "abc.txt");
    assert.equal(cleanFileName(".env"), "env");
  });
  it("names an empty result file", () => {
    for (const name of ["", "...", "../..", "/", "  "])
      assert.equal(cleanFileName(name), "file", name);
  });
  it("caps long names at 120 characters, keeping the extension", () => {
    const cleaned = cleanFileName(`${"x".repeat(300)}.png`);
    assert.equal(cleaned.length, 120);
    assert.ok(cleaned.endsWith(".png"));
  });
});

describe("storeFile", () => {
  it("stores a new file under its cleaned name and reports its project path", async () => {
    const dir = project();
    const stored = await storeFile({
      projectDir: dir,
      name: "My CV.pdf",
      content: content("cv"),
    });
    assert.deepEqual(stored, { path: "files/My CV.pdf", reused: false });
    assert.equal(
      readFileSync(path.join(dir, "files", "My CV.pdf"), "utf8"),
      "cv",
    );
  });

  it("reuses a file of the same name and content", async () => {
    const dir = project();
    await storeFile({
      projectDir: dir,
      name: "a.png",
      content: content("same"),
    });
    assert.deepEqual(
      await storeFile({
        projectDir: dir,
        name: "a.png",
        content: content("same"),
      }),
      { path: "files/a.png", reused: true },
    );
    assert.deepEqual(readdirSync(path.join(dir, "files")), ["a.png"]);
  });

  it("puts a name taken by other content in a folder named after the content hash, and never overwrites", async () => {
    const dir = project();
    await storeFile({
      projectDir: dir,
      name: "a.png",
      content: content("one"),
    });
    const two = await storeFile({
      projectDir: dir,
      name: "a.png",
      content: content("two"),
    });
    assert.deepEqual(two, {
      path: `files/${prefix("two")}/a.png`,
      reused: false,
    });
    const three = await storeFile({
      projectDir: dir,
      name: "a.png",
      content: content("three"),
    });
    assert.equal(three.path, `files/${prefix("three")}/a.png`);
    assert.notEqual(prefix("two"), prefix("three"));
    assert.equal(readFileSync(path.join(dir, "files", "a.png"), "utf8"), "one");
    assert.equal(readFileSync(path.join(dir, three.path), "utf8"), "three");
    // the same clashing content again is reused from its hash folder
    assert.deepEqual(
      await storeFile({
        projectDir: dir,
        name: "a.png",
        content: content("two"),
      }),
      { path: two.path, reused: true },
    );
  });

  it("stores the same content under a different name under that name", async () => {
    const dir = project();
    await storeFile({
      projectDir: dir,
      name: "feb.pdf",
      content: content("same"),
    });
    assert.deepEqual(
      await storeFile({
        projectDir: dir,
        name: "march.pdf",
        content: content("same"),
      }),
      { path: "files/march.pdf", reused: false },
    );
    assert.deepEqual(readdirSync(path.join(dir, "files")).sort(), [
      "feb.pdf",
      "march.pdf",
    ]);
  });

  it("gives clashes in the project root paths without a leading slash", async () => {
    const dir = project();
    await storeFile({
      projectDir: dir,
      filesDir: ".",
      name: "a.png",
      content: content("one"),
    });
    const stored = await storeFile({
      projectDir: dir,
      filesDir: ".",
      name: "a.png",
      content: content("two"),
    });
    assert.equal(stored.path, `${prefix("two")}/a.png`);
  });

  it("leaves the content file in place", async () => {
    const source = content("keep");
    await storeFile({ projectDir: project(), name: "k.txt", content: source });
    assert.equal(readFileSync(source, "utf8"), "keep");
  });

  it("uses filesDir, and stores a name of dots and slashes as file, inside the folder", async () => {
    const dir = project();
    const stored = await storeFile({
      projectDir: dir,
      filesDir: "test-data/uploads",
      name: "../..",
      content: content("x"),
    });
    assert.equal(stored.path, "test-data/uploads/file");
  });

  it('filesDir "." stores in the project root, with no leading slash', async () => {
    const dir = project();
    const stored = await storeFile({
      projectDir: dir,
      filesDir: ".",
      name: "a.png",
      content: content("x"),
    });
    assert.equal(stored.path, "a.png");
    assert.equal(readFileSync(path.join(dir, "a.png"), "utf8"), "x");
  });

  it("only hashes files of the same size", async () => {
    const dir = project();
    mkdirSync(path.join(dir, "files"));
    writeFileSync(path.join(dir, "files", "other.bin"), "different length");
    assert.equal(
      (
        await storeFile({
          projectDir: dir,
          name: "n.bin",
          content: content("n"),
        })
      ).reused,
      false,
    );
  });
});

describe("files folder", () => {
  it("is files/ by default, relative to the project", () => {
    const dir = project();
    assert.deepEqual(filesFolder(dir), {
      absolute: path.join(dir, "files"),
      relative: "files",
    });
    assert.equal(filesFolder(dir, "./a/b/").relative, "a/b");
  });

  it("knows when git ignores it", async () => {
    const dir = project();
    assert.equal(await isFolderIgnored(dir, "files"), false);
    for (const line of [
      "files",
      "files/",
      "/files",
      "/files/",
      "files/*",
      "files/**",
    ]) {
      writeFileSync(path.join(dir, ".gitignore"), `node_modules\n${line}\n`);
      assert.equal(await isFolderIgnored(dir, "files"), true, line);
    }
  });
});
