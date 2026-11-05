<!-- markdownlint-disable MD041 -->

## In your own project

The package is published on npm as [`@itmetsam/samurai-framework`](https://www.npmjs.com/package/@itmetsam/samurai-framework). In an empty folder:

```sh
npx -p @itmetsam/samurai-framework samurai init   # config, an example test, .env.example, .gitignore
npm install
npx samurai browsers install firefox             # once per machine
npx samurai run
```

Specs and the config then import from `@itmetsam/samurai-framework` instead of the relative paths used below. See [Command line](Command-line).

The rest of this section works in a checkout of this repository.

## 1. Requirements

- [Node.js](https://nodejs.org) 24 or newer (`engines` in `package.json`; CI uses 26) and, to work on the framework, [Bun](https://bun.sh) 1.3 or newer
- Firefox, downloaded by the framework: run `bun run dev browsers install firefox` once in this checkout (`npx samurai browsers install firefox` in a project; see [Which browser runs](Pages-and-browsers#which-browser-runs)). The Firefox installed on the machine is not used.

## 2. Install

```sh
npm install -g @itmetsam/samurai-framework
npx samurai init <project-name>
cd <project-name>
bun install
```

## 3. Write a test

Tests live in the folder `srcDir` points to (`./src/tests` in `samurai.config.ts`) and end in `.spec.ts`. Create `src/tests/example.spec.ts`:

```ts
import { expect, test } from "../api.js";

test("example.com has its heading", async ({ page }) => {
  await page.goto("https://example.com");
  await expect(
    page.getByRole("heading", { name: "Example Domain" }),
  ).toBeVisible();
  await page.getByText("More information", { match: "partial" }).click();
  await page.waitForLoadState();
  expect(await page.url()).toContain("iana.org");
});
```

## 4. Configure

`samurai.config.ts` in the project root:

```ts
import { defineConfig } from "./src/config/config.js";

export default defineConfig({
  srcDir: "./src/tests",
  browser: "firefox",
  timeout: 30000,
  environments: {
    staging: { baseURL: "https://staging.example.com" },
    production: { baseURL: "https://www.example.com" },
  },
  defaultEnvironment: "staging",
});
```

With `baseURL` set, `page.goto("/login")` opens `https://staging.example.com/login`.

## 5. Run

```sh
bun run dev                    # every *.spec.ts under srcDir, in the default environment
bun run dev --env production   # another environment (or SAMURAI_ENV=production)
bun run dev --timeout 60000    # per-test timeout in ms; also --expect-timeout
```

`bun run dev` is `samurai run` straight from the sources, so it takes the same options (`--grep`, `--file`, `--group`, `--headless`, `--json`, …) and the other commands too (`bun run dev list`, `bun run dev browsers install firefox`). See [Command line](Command-line).

A browser window opens for each test and closes when the test ends (`--headless` hides it; on CI it is the default, see [Configuration](Configuration#headless)). Each test's result is printed as it finishes, followed by a summary, and the full report is written to `result/report.json`. The process exits with code 0 when every test passed, 1 otherwise and 2 for a usage or configuration error. Framework logs go to stderr and `logs/`.

> `src/tests/index.spec.ts` is an example that submits a real contact form. Delete it or replace it before running everything.

## Flows (optional)

A project can also keep flows in `flows/*.flow.json` (edited in the Samurai app) that chain tests and groups with conditions and variables. `samurai flow check` validates them and `samurai flow run <flow>` runs them, with a report in `result/flows/`. See [Flows](Flows).

## 6. Secrets (optional)

```sh
cp .env.example .env.staging
# then add a line per secret, e.g.
# SAMURAI_SECRET_TEST_PASSWORD=...
```

Read it in a test as `secrets.TEST_PASSWORD`. Real environment variables win over the file, and `.env.*` files are git-ignored. See [Environments and secrets](Environments-and-secrets).

# Documentation

| Guide                                                  | What it covers                                                                                                |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| [Writing tests](Writing-tests)                         | `test`, `describe`, fixtures, how a test passes or fails                                                      |
| [Locators](Locators)                                   | Finding elements, chaining, fallbacks, actions and their auto-waiting                                         |
| [Assertions](Assertions)                               | `expect` for elements and for plain values                                                                    |
| [Pages and browsers](Pages-and-browsers)               | Navigation, waits, screenshots, PDF, viewport, settings (`page.use()`), dialogs, downloads, contexts, cookies |
| [Network](Network)                                     | Waiting for traffic, mocking, blocking, response bodies                                                       |
| [Configuration](Configuration)                         | Every option in `samurai.config.ts`, CLI flags and precedence                                                 |
| [Environments and secrets](Environments-and-secrets)   | Per-environment settings, variables, secrets and masking                                                      |
| [Command line](Command-line)                           | `samurai run`, `list`, `record` and `init`, options, output, exit codes, `--json`                             |
| [Flows](Flows)                                         | `samurai flow list`, `check` and `run`: graphs of tests, groups and steps, reports, CI                        |
| [Writing a step](Writing-a-step)                       | `defineStep`: flow steps of your own, the built-in steps                                                      |
| [Running tests and reports](Running-tests-and-reports) | What a run does, `report.json`, page logs, timeouts                                                           |
| [Steps and the recorder](Steps-and-the-recorder)       | The step codec, the recording engine and the recorder toolbar                                                 |
| [Embedding the framework](Embedding-the-framework)     | Using the package from another app (such as the Electron UI): build, entry points, `runTests`, events         |
| [Contributing](Contributing)                           | Project layout, running the framework's own tests, conventions                                                |
| [Roadmap](Roadmap)                                     | What is built and what is still open                                                                          |

The [documentation index](Home) lists every guide by topic.

## Scripts

| Command                | Does                                            |
| ---------------------- | ----------------------------------------------- |
| `bun run dev`          | `samurai` from the sources (`tsx src/index.ts`) |
| `bun run test`         | Unit tests of the framework (no browser needed) |
| `bun run test:browser` | Browser tests of the framework (needs Firefox)  |
| `bun run test:cli`     | Tests of the `samurai` command (build first)    |
| `bun run build`        | Typechecks and compiles to `dist/`              |
