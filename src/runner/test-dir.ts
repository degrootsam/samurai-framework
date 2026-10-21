import path from "path";
import { projectDir } from "../config/config.js";
import { cleanName } from "../browser/evidence.js";
import type { RegisteredTestCase } from "../types/test.js";
import { DEFAULT_SRC_DIR } from "../config/defaults.js";
import { realPath, toPosix } from "./groups.js";

/** The project and source folders as real paths: registered test files come from stack traces, which resolve symlinks */
export function realDirs(configuredSrcDir: string | undefined) {
  const dir = realPath(projectDir());
  const srcDir = realPath(
    path.resolve(dir, configuredSrcDir ?? DEFAULT_SRC_DIR),
  );
  return { dir, srcDir };
}

/**
 * The folder of a test's screenshots below `screenshots/`: its spec file without extension, then its cleaned
 * name. A spec outside srcDir loses the `..` (and a drive or root) its relative path starts with, so it stays
 * below `screenshots/`.
 * @internal Exported for tests
 */
export function testDirOf(test: RegisteredTestCase, srcDir: string): string {
  const file = toPosix(path.relative(srcDir, test.file))
    .replace(/\.[cm]?[jt]sx?$/, "")
    .split("/")
    .filter(
      (segment) =>
        segment !== "" &&
        segment !== "." &&
        segment !== ".." &&
        !/^[A-Za-z]:$/.test(segment),
    )
    .join("/");
  return `${file}/${cleanName(test.name)}`;
}
