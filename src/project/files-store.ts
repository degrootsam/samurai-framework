import { constants, createReadStream } from "node:fs";
import { copyFile, mkdir, readdir, readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

/** Files bigger than this aren't stored while recording */
export const RECORD_LIMIT = 50 * 1024 * 1024;
const NAME_LIMIT = 120;

/** A picked file's name as a file name in the files folder: no folders, control characters or leading dots */
export function cleanFileName(name: string): string {
  let cleaned = (name.split(/[\\/]/).pop() ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .replace(/^\.+/, "")
    .trim();
  if (cleaned.length > NAME_LIMIT) {
    const ext = path.extname(cleaned);
    const keep = ext.length > 0 && ext.length < 20 ? ext : "";
    cleaned = cleaned.slice(0, NAME_LIMIT - keep.length) + keep;
  }
  return cleaned === "" ? "file" : cleaned;
}

/** The files folder: absolute, and relative to the project with forward slashes */
export function filesFolder(
  projectDir: string,
  filesDir = "files",
): { absolute: string; relative: string } {
  const absolute = path.resolve(projectDir, filesDir);
  return {
    absolute,
    relative: path.relative(projectDir, absolute).split(path.sep).join("/"),
  };
}

function hashOf(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")))
      .on("error", reject);
  });
}

/**
 * Stores the bytes in `content` in the files folder, once: a file there with the same content is reused,
 * whatever its name; a name taken by other content gets -2, -3, …. Nothing is overwritten and nothing is
 * written outside the folder. `content` is left in place. Returns the project-relative path.
 */
export async function storeFile(options: {
  projectDir: string;
  filesDir?: string;
  name: string;
  content: string;
}): Promise<{ path: string; reused: boolean }> {
  const { absolute, relative } = filesFolder(
    options.projectDir,
    options.filesDir,
  );
  const projectPath = (file: string) => `${relative}/${path.basename(file)}`;
  const { size } = await stat(options.content);
  await mkdir(absolute, { recursive: true });

  let hash: string | undefined;
  for (const entry of await readdir(absolute, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const candidate = path.join(absolute, entry.name);
    if ((await stat(candidate)).size !== size) continue;
    hash ??= await hashOf(options.content);
    if ((await hashOf(candidate)) === hash)
      return { path: projectPath(candidate), reused: true };
  }

  const name = cleanFileName(options.name);
  const ext = path.extname(name);
  const stem = ext === "" || ext === name ? name : name.slice(0, -ext.length);
  for (let n = 1; ; n++) {
    const target = path.join(
      absolute,
      n === 1 ? name : `${stem}-${n}${ext === name ? "" : ext}`,
    );
    if (path.dirname(target) !== absolute)
      throw new Error(`${options.name} can't be stored in ${relative}/`);
    try {
      await copyFile(options.content, target, constants.COPYFILE_EXCL);
      return { path: projectPath(target), reused: false };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
}

/** Whether the project's .gitignore ignores the folder (`files`, `files/`, `/files`, `files/*`, `files/**`) */
export async function isFolderIgnored(
  projectDir: string,
  relative: string,
): Promise<boolean> {
  let text: string;
  try {
    text = await readFile(path.join(projectDir, ".gitignore"), "utf8");
  } catch {
    return false;
  }
  return text.split(/\r?\n/).some((line) => {
    const pattern = line
      .trim()
      .replace(/^\//, "")
      .replace(/\/(\*\*?)?$/, "");
    return pattern === relative;
  });
}
