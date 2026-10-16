import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
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

  it("reuses identical content, whatever its name", async () => {
    const dir = project();
    await storeFile({
      projectDir: dir,
      name: "a.png",
      content: content("same"),
    });
    assert.deepEqual(
      await storeFile({
        projectDir: dir,
        name: "b.png",
        content: content("same"),
      }),
      {
        path: "files/a.png",
        reused: true,
      },
    );
    assert.deepEqual(readdirSync(path.join(dir, "files")), ["a.png"]);
  });

  it("gives a name taken by other content -2, -3, and never overwrites", async () => {
    const dir = project();
    await storeFile({
      projectDir: dir,
      name: "a.png",
      content: content("one"),
    });
    assert.equal(
      (
        await storeFile({
          projectDir: dir,
          name: "a.png",
          content: content("two"),
        })
      ).path,
      "files/a-2.png",
    );
    assert.equal(
      (
        await storeFile({
          projectDir: dir,
          name: "a.png",
          content: content("three"),
        })
      ).path,
      "files/a-3.png",
    );
    assert.equal(readFileSync(path.join(dir, "files", "a.png"), "utf8"), "one");
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
