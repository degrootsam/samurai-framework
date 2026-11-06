import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SRC = path.resolve(import.meta.dirname, "..");

function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) yield* sources(full);
    else if (
      name.endsWith(".ts") &&
      !/\.(test|browser-test|cli-test)\.ts$/.test(name)
    )
      yield full;
  }
}

test("only src/agent imports ai or zod, so the framework loads without them", () => {
  const offenders = [...sources(SRC)]
    .filter((file) => !file.startsWith(path.join(SRC, "agent") + path.sep))
    .filter((file) =>
      /from\s+["'](ai|zod)(\/[^"']*)?["']|import\(\s*["'](ai|zod)/.test(
        readFileSync(file, "utf8"),
      ),
    );
  assert.deepEqual(offenders, []);
});
