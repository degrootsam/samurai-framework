import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { cleanName } from "../browser/evidence.js";
import { maskText } from "../config/mask.js";

/** The file types an attachment is known by; the rest is `application/octet-stream` */
const TYPES: Record<string, string> = {
  ".txt": "text/plain",
  ".log": "text/plain",
  ".html": "text/html",
  ".json": "application/json",
  ".csv": "text/csv",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webm": "video/webm",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
};

const OCTET = "application/octet-stream";

/** What `testInfo.attach` takes besides the name */
export interface AttachInput {
  body?: string | Buffer;
  path?: string;
  contentType?: string;
}

/** The extension (with its dot) that stands for `contentType`, else `fallback` */
function extensionOf(contentType: string, fallback: string): string {
  const found = Object.entries(TYPES).find(([, type]) => type === contentType);
  return found ? found[0] : fallback;
}

/**
 * Writes one attachment into `dir` and returns what to list: a body is saved under the cleaned name, a path is
 * copied under it keeping its extension. `used` holds the file names taken so far; a repeat gets -2, -3, ...
 * String bodies are masked like the rest of a report.
 */
export async function saveAttachment(
  dir: string,
  used: Set<string>,
  name: string,
  input: AttachInput,
): Promise<{ name: string; contentType: string; path: string }> {
  if (name === "") throw new Error("attach(): name must not be empty");
  const { body, path: from } = input;
  if (body === undefined && from === undefined)
    throw new Error("attach(): give either body or path");
  if (body !== undefined && from !== undefined)
    throw new Error("attach(): give either body or path, not both");

  const fileExt = from !== undefined ? path.extname(from).toLowerCase() : "";
  const contentType =
    input.contentType ??
    (from !== undefined
      ? (TYPES[fileExt] ?? OCTET)
      : typeof body === "string"
        ? "text/plain"
        : OCTET);
  const ext =
    fileExt !== ""
      ? fileExt
      : extensionOf(contentType, typeof body === "string" ? ".txt" : ".bin");

  const base = cleanName(name);
  let unique = base;
  for (let n = 2; used.has(unique); n++) unique = `${base}-${n}`;
  used.add(unique);
  const file = path.join(dir, `${unique}${ext}`);
  await mkdir(dir, { recursive: true });
  if (from !== undefined) await copyFile(from, file);
  else await writeFile(file, typeof body === "string" ? maskText(body) : body!);
  return { name, contentType, path: file };
}
