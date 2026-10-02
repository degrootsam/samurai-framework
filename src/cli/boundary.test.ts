import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/**
 * The command line may only use what the package exports, so it could move to a package of its own: a
 * deep import of an internal module would break that move.
 */
describe("the cli's imports", () => {
  const cliDir = path.resolve("src/cli");
  const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
    exports: Record<string, string | { default: string }>;
  };
  // "./dist/runner/run.js" is "src/runner/run.js" at development time
  const exported = new Set(
    Object.values(manifest.exports).flatMap((target) => {
      const file = typeof target === "string" ? target : target.default;
      return file.startsWith("./dist/")
        ? [path.resolve("src", file.slice("./dist/".length))]
        : [];
    }),
  );
  const sources = readdirSync(cliDir).filter(
    (name) => name.endsWith(".ts") && !/\.(test|cli-test)\.ts$/.test(name),
  );

  it("every export points at a source file", () => {
    for (const file of exported) {
      assert.ok(
        existsSync(file.replace(/\.js$/, ".ts")),
        `${file} has no source file`,
      );
    }
  });

  it("have something to check", () => {
    assert.ok(sources.length >= 4);
    assert.ok(exported.size >= 4);
  });

  for (const name of sources) {
    it(`${name} imports only its own folder and exported entry points`, () => {
      const source = readFileSync(path.join(cliDir, name), "utf8");
      const imports = [...source.matchAll(/from\s+"(\.{1,2}\/[^"]+)"/g)].map(
        (match) => match[1]!,
      );
      for (const specifier of imports) {
        const resolved = path.resolve(cliDir, specifier);
        const ownFolder = path.dirname(resolved) === cliDir;
        assert.ok(
          ownFolder || exported.has(resolved),
          `${name} imports ${specifier}, which is not an entry point of the package (see "exports" in package.json)`,
        );
      }
    });
  }
});
