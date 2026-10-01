import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const PACKAGE = "@itmetsam/samurai-framework";

/** The files `samurai init` writes, by path relative to the project folder */
export function scaffold(name: string): Record<string, string> {
  return {
    "package.json":
      JSON.stringify(
        {
          name,
          version: "0.1.0",
          private: true,
          type: "module",
          scripts: { test: "samurai run" },
          dependencies: { [PACKAGE]: "^0.1.0" },
        },
        null,
        2,
      ) + "\n",
    "samurai.config.ts": `import { defineConfig } from "${PACKAGE}";

export default defineConfig({
  srcDir: "./tests",
  browser: "firefox",
  timeout: 30000,
  environments: {
    local: { baseURL: "http://localhost:3000" },
  },
  defaultEnvironment: "local",
});
`,
    "tests/example.spec.ts": `import { expect, test } from "${PACKAGE}";

test("example.com has its heading", async ({ page }) => {
  await page.goto("https://example.com");
  await expect(page.getByRole("heading", { name: "Example Domain" })).toBeVisible();
});
`,
    ".env.example": `# Copy to .env.<environment>, e.g. .env.local. Never commit real values.
# Tests read these as secrets.TEST_PASSWORD; real environment variables win over this file.
SAMURAI_SECRET_TEST_PASSWORD=
`,
    ".gitignore":
      "node_modules\nresult\nlogs\nbrowsers\n.env\n.env.*\n!.env.example\n",
  };
}

/** Writes the scaffold into `dir`, never overwriting a file. Returns what was written and what was left alone */
export function initProject(dir: string): {
  written: string[];
  skipped: string[];
} {
  const root = path.resolve(dir);
  const written: string[] = [];
  const skipped: string[] = [];
  for (const [file, content] of Object.entries(
    scaffold(
      path
        .basename(root)
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-") || "samurai-tests",
    ),
  )) {
    const target = path.join(root, file);
    if (existsSync(target)) {
      skipped.push(file);
      continue;
    }
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
    written.push(file);
  }
  return { written, skipped };
}
