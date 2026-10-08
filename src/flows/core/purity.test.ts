import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { builtinModules } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

const CORE_DIR = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = resolve(CORE_DIR, "..", "..");
const ROOT_DIR = resolve(SRC_DIR, "..");

const BUILTINS = new Set(
  builtinModules.filter((name) => !name.startsWith("_")),
);
const FORBIDDEN_PACKAGES = new Set(["winston"]);

interface Specifier {
  specifier: string;
  typeOnly: boolean;
}

/** Every module specifier a source file imports, re-exports or dynamically imports. */
export function specifiersOf(source: string): Specifier[] {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const found: Specifier[] = [];
  const staticRe =
    /\b(import|export)\s+(type\s+)?(?:[^"'`;]*?\s+from\s+)?["']([^"']+)["']/g;
  for (const m of code.matchAll(staticRe)) {
    found.push({ specifier: m[3] ?? "", typeOnly: Boolean(m[2]) });
  }
  const dynamicRe = /\b(?:import|require)\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g;
  for (const m of code.matchAll(dynamicRe)) {
    found.push({ specifier: m[1] ?? "", typeOnly: false });
  }
  return found;
}

function resolveRelative(fromFile: string, specifier: string): string {
  const base = resolve(dirname(fromFile), specifier);
  const candidates = [
    base.replace(/\.js$/, ".ts"),
    `${base}.ts`,
    join(base, "index.ts"),
    base,
  ];
  return candidates.find((c) => existsSync(c)) ?? `${base}.ts`;
}

/**
 * Walks the import graph from `entry` through non-test files under `coreDir` and
 * returns one message per violation. `typesDir` is the only place outside
 * `coreDir` that `import type` may reach.
 */
export function findViolations(
  entry: string,
  coreDir: string,
  typesDir: string,
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const queue = [entry];
  const inside = (dir: string, file: string) =>
    file === dir || file.startsWith(dir + sep);
  const show = (file: string) =>
    relative(dirname(coreDir), file).split(sep).join("/");

  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    if (!existsSync(file)) {
      problems.push(`${show(file)}: file not found`);
      continue;
    }
    for (const { specifier, typeOnly } of specifiersOf(
      readFileSync(file, "utf8"),
    )) {
      const where = `${show(file)} imports "${specifier}"`;
      if (specifier.startsWith("node:")) {
        problems.push(`${where}: node: specifier`);
      } else if (specifier.startsWith(".")) {
        const target = resolveRelative(file, specifier);
        if (inside(coreDir, target)) {
          if (!target.endsWith(".test.ts")) queue.push(target);
        } else if (!(typeOnly && inside(typesDir, target))) {
          problems.push(
            `${where}: outside flows/core (only "import type" from src/types is allowed)`,
          );
        }
      } else {
        const pkg = specifier.split("/")[0] ?? specifier;
        if (BUILTINS.has(specifier) || BUILTINS.has(pkg)) {
          problems.push(`${where}: Node builtin`);
        } else if (FORBIDDEN_PACKAGES.has(pkg)) {
          problems.push(`${where}: ${pkg} is not browser-safe`);
        }
      }
    }
  }
  return problems;
}

describe("flows/core purity", () => {
  test("the import graph from index.ts is browser-safe", () => {
    const problems = findViolations(
      join(CORE_DIR, "index.ts"),
      CORE_DIR,
      join(SRC_DIR, "types"),
    );
    assert.deepEqual(problems, []);
  });

  describe("scanner", () => {
    const withFixture = (
      files: Record<string, string>,
      run: (core: string, types: string) => void,
    ) => {
      const dir = mkdtempSync(join(tmpdir(), "purity-"));
      try {
        for (const [name, content] of Object.entries(files)) {
          mkdirSync(dirname(join(dir, name)), { recursive: true });
          writeFileSync(join(dir, name), content);
        }
        run(join(dir, "core"), join(dir, "types"));
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    };

    test("a pure graph passes, following re-exports, dynamic imports and directory imports", () => {
      withFixture(
        {
          "core/index.ts": `export * from "./a.js";\nexport { b } from "./sub/index.js";\n`,
          "core/a.ts": `import type { T } from "../types/t.js";\nconst l = () => import("./c.js");\nexport const a = 1;\n`,
          "core/c.ts": `export const c = 1;\n`,
          "core/sub/index.ts": `export const b = 1;\n`,
          "core/a.test.ts": `import "node:test";\n`,
          "types/t.ts": `export type T = number;\n`,
        },
        (core, types) =>
          assert.deepEqual(
            findViolations(join(core, "index.ts"), core, types),
            [],
          ),
      );
    });

    test("test files and comments are not scanned", () => {
      withFixture(
        {
          "core/index.ts": `// import "node:fs";\n/* import fs from "fs"; */\nexport * from "./a.js";\n`,
          "core/a.ts": `export const a = 1;\n`,
          "core/a.test.ts": `import "node:fs";\n`,
        },
        (core, types) =>
          assert.deepEqual(
            findViolations(join(core, "index.ts"), core, types),
            [],
          ),
      );
    });

    const violation = (source: string, expected: RegExp) =>
      withFixture(
        {
          "core/index.ts": `export * from "./a.js";\n`,
          "core/a.ts": source,
          "runner/x.ts": `export const x = 1;\n`,
          "types/t.ts": `export type T = number;\n`,
        },
        (core, types) => {
          const problems = findViolations(join(core, "index.ts"), core, types);
          assert.equal(problems.length, 1, problems.join("\n"));
          assert.match(problems[0] ?? "", /flows|core\/a\.ts/);
          assert.match(problems[0] ?? "", expected);
        },
      );

    test("reports a node: specifier", () =>
      violation(`import "node:fs";\n`, /"node:fs".*node: specifier/));
    test("reports a Node builtin by bare name", () =>
      violation(`import { join } from "path";\n`, /"path".*Node builtin/));
    test("reports a builtin subpath", () =>
      violation(
        `import fs from "fs/promises";\n`,
        /"fs\/promises".*Node builtin/,
      ));
    test("reports winston", () =>
      violation(`import winston from "winston";\n`, /"winston"/));
    test("reports a dynamic import of a builtin", () =>
      violation(
        `export const f = () => import("os");\n`,
        /"os".*Node builtin/,
      ));
    test("reports a value import from outside core", () =>
      violation(
        `import { x } from "../runner/x.js";\n`,
        /"\.\.\/runner\/x\.js".*outside/,
      ));
    test("reports an import type from outside core other than src/types", () =>
      violation(`import type { x } from "../runner/x.js";\n`, /outside/));
    test("reports a value import from src/types", () =>
      violation(`import { T } from "../types/t.js";\n`, /outside/));
    test("reports a violation reached through a re-export chain", () =>
      withFixture(
        {
          "core/index.ts": `export * from "./a.js";\n`,
          "core/a.ts": `export * from "./deep/b.js";\n`,
          "core/deep/b.ts": `import "node:crypto";\n`,
        },
        (core, types) => {
          const problems = findViolations(join(core, "index.ts"), core, types);
          assert.equal(problems.length, 1);
          assert.match(
            problems[0] ?? "",
            /core\/deep\/b\.ts imports "node:crypto"/,
          );
        },
      ));
  });
});

describe("flows/core bundle", () => {
  const dist = join(ROOT_DIR, "dist", "flows", "core", "index.js");
  const esbuildPath = join(
    ROOT_DIR,
    "node_modules",
    "esbuild",
    "lib",
    "main.js",
  );
  const skip = !existsSync(dist)
    ? "dist/flows/core/index.js is missing (run `bun run build` first)"
    : !existsSync(esbuildPath)
      ? "esbuild is not installed in node_modules"
      : false;

  test(
    "the built entry bundles for the browser without Node builtins",
    { skip },
    async () => {
      const esbuild = (await import("esbuild")) as typeof import("esbuild");
      const result = await esbuild.build({
        entryPoints: [dist],
        bundle: true,
        write: false,
        platform: "browser",
        format: "esm",
        logLevel: "silent",
      });
      assert.deepEqual(
        result.errors.map((e) => e.text),
        [],
      );
    },
  );
});
