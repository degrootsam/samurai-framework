import { constants, createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { DEFAULT_FILES_DIR } from "../config/defaults.js";

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
  filesDir = DEFAULT_FILES_DIR,
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

function sameContent(
  candidate: string,
  size: number,
  hash: () => Promise<string>,
): Promise<boolean> {
  return stat(candidate).then(async (info) =>
    info.size !== size ? false : (await hashOf(candidate)) === (await hash()),
  );
}

/**
 * Stores the bytes in `content` in the files folder under their own (cleaned) name, so the page sees at
 * replay the name it saw while recording. If the name is free the file is copied there; if a file of that
 * name holds the same content it is reused. If the name is taken by other content, the file goes in a
 * folder named after the first 8 hex characters of its SHA-256 (`<H>/<name>`; 16, then all 64, on a
 * collision). Different names with the same content are stored separately. Nothing is overwritten and
 * nothing is written outside the folder. `content` is left in place. Returns the project-relative path.
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
  const projectPath = (...parts: string[]) =>
    [relative, ...parts].filter((part) => part !== "").join("/");
  const name = cleanFileName(options.name);
  const { size } = await stat(options.content);
  await mkdir(absolute, { recursive: true });

  let hash: string | undefined;
  const contentHash = async () => (hash ??= await hashOf(options.content));

  /** Copies to the target, or reports it reused when it holds the same content; undefined when it holds other content */
  const place = async (
    target: string,
    relativeParts: string[],
  ): Promise<{ path: string; reused: boolean } | undefined> => {
    try {
      await copyFile(options.content, target, constants.COPYFILE_EXCL);
      return { path: projectPath(...relativeParts), reused: false };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
    return (await sameContent(target, size, contentHash))
      ? { path: projectPath(...relativeParts), reused: true }
      : undefined;
  };

  const direct = await place(path.join(absolute, name), [name]);
  if (direct) return direct;

  const full = await contentHash();
  for (const length of [8, 16, 64]) {
    const folder = full.slice(0, length);
    await mkdir(path.join(absolute, folder), { recursive: true });
    const stored = await place(path.join(absolute, folder, name), [
      folder,
      name,
    ]);
    if (stored) return stored;
  }
  throw new Error(`${options.name} can't be stored in ${relative}/`);
}

/** Whether the project's .gitignore ignores the folder (`files`, `files/`, `/files`, `files/*`, `files/**`) */
export async function isFolderIgnored(
  projectDir: string,
  relative: string,
): Promise<boolean> {
  if (relative === "") return false;
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
