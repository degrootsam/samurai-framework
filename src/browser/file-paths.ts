import { stat } from "node:fs/promises";
import path from "node:path";

/** Absolute paths for `files` (relative ones resolve against the working directory) */
export function resolveFiles(files: string | string[]): string[] {
  return (Array.isArray(files) ? files : [files]).map((file) => path.resolve(file));
}

/** Throws unless `file` is an existing regular file; `operation` names the caller in the message */
export async function assertIsFile(file: string, operation: string): Promise<void> {
  let info;
  try {
    info = await stat(file);
  } catch {
    throw new Error(`${operation}(): file not found: ${file}`);
  }
  if (!info.isFile()) throw new Error(`${operation}(): not a file: ${file}`);
}
