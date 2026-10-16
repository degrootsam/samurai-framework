import { createHash } from "node:crypto";
import { mkdir, open, rm, stat } from "node:fs/promises";
import path from "node:path";
import { projectDir } from "../config/config.js";
import { parseSize } from "../steps/files.js";

const GENERATED = Symbol.for("samurai.generatedFile");
const CHUNK = 1024 * 1024;

/** A file `setInputFiles` and `dropFiles` write when the step runs, instead of one stored in the project */
export interface GeneratedFile {
  readonly [GENERATED]: true;
  readonly name: string;
  /** Bytes */
  readonly size: number;
  readonly type?: string;
}

/** What `setInputFiles` and `dropFiles` take: a path (relative to the project folder) or a generated file */
export type FileInput = string | GeneratedFile;

/**
 * A file of `size` written when the step runs: seeded random bytes, the same in every run and not
 * compressible, under `result/files/`, removed when the run ends. For upload limits and load tests.
 * `size` is bytes or a text with a unit (`"60 MB"`, `"1.5 GB"`; powers of 1024). `type` is the MIME type
 * `dropFiles` gives the page; for `setInputFiles` the browser takes it from the name's extension.
 * @example
 *  await page.getByLabel("Upload").setInputFiles(generatedFile({ name: "huge.pdf", size: "60 MB" }));
 */
export function generatedFile(options: {
  name: string;
  size: number | string;
  type?: string;
}): GeneratedFile {
  const size = parseSize(options.size);
  if (size === undefined)
    throw new Error(
      `generatedFile(): size must be a number of bytes or a text like "60 MB", got ${JSON.stringify(options.size)}`,
    );
  const name = path.basename(String(options.name ?? ""));
  if (name === "" || name === "." || name === "..")
    throw new Error(
      `generatedFile(): name must be a file name, got ${JSON.stringify(options.name)}`,
    );
  return Object.freeze({
    [GENERATED]: true as const,
    name,
    size,
    ...(options.type !== undefined && { type: options.type }),
  });
}

export const isGeneratedFile = (value: unknown): value is GeneratedFile =>
  typeof value === "object" &&
  value !== null &&
  (value as Record<symbol, unknown>)[GENERATED] === true;

let folder: string | undefined;
const written = new Map<string, Promise<string>>();

/** xorshift32, seeded from the name and size */
function seedOf(file: GeneratedFile): number {
  const seed = createHash("sha256")
    .update(`${file.size}:${file.name}`)
    .digest()
    .readUInt32LE(0);
  return seed === 0 ? 1 : seed;
}

async function write(
  target: string,
  size: number,
  seed: number,
): Promise<void> {
  const handle = await open(target, "w");
  try {
    const chunk = Buffer.alloc(CHUNK);
    let state = seed;
    for (let done = 0; done < size; done += CHUNK) {
      for (let i = 0; i < CHUNK; i += 4) {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        state >>>= 0;
        chunk.writeUInt32LE(state, i);
      }
      await handle.write(chunk, 0, Math.min(CHUNK, size - done));
    }
  } finally {
    await handle.close();
  }
}

/** The generated file on disk; written once per run for the same name and size */
function generatedPath(file: GeneratedFile): Promise<string> {
  folder ??= path.join(projectDir(), "result", "files");
  const key = `${file.size}/${file.name}`;
  let pending = written.get(key);
  if (!pending) {
    const dir = folder;
    pending = (async () => {
      const target = path.join(dir, key);
      await mkdir(path.dirname(target), { recursive: true });
      await write(target, file.size, seedOf(file));
      return target;
    })();
    written.set(key, pending);
    pending.catch(() => written.delete(key));
  }
  return pending;
}

/** Removes this run's generated files (`withProject` calls it when the run ends) */
export async function removeGeneratedFiles(): Promise<void> {
  const dir = folder;
  folder = undefined;
  const pending = [...written.values()];
  written.clear();
  await Promise.allSettled(pending);
  if (dir) await rm(dir, { recursive: true, force: true });
}

/** Absolute paths for `setInputFiles` / `dropFiles`: generated files are written, project files must exist */
export async function resolveFileInputs(
  files: FileInput | FileInput[],
  operation: string,
): Promise<string[]> {
  const paths: string[] = [];
  for (const file of Array.isArray(files) ? files : [files]) {
    if (isGeneratedFile(file)) {
      paths.push(await generatedPath(file));
      continue;
    }
    if (typeof file !== "string")
      throw new TypeError(
        `${operation}(): expected a path or generatedFile(…), got ${typeof file}`,
      );
    const absolute = path.resolve(projectDir(), file);
    let info;
    try {
      info = await stat(absolute);
    } catch {
      throw new Error(
        path.isAbsolute(file)
          ? `${operation}(): file not found: ${absolute}`
          : `${operation}(): ${file.replace(/\\/g, "/")} doesn't exist in the project`,
      );
    }
    if (!info.isFile())
      throw new Error(`${operation}(): not a file: ${absolute}`);
    paths.push(absolute);
  }
  return paths;
}
