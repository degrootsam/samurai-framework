# Samurai

A browser test framework written in TypeScript. It drives a real browser over the [WebDriver BiDi](https://www.w3.org/TR/webdriver-bidi/) protocol, with no WebDriver server and no Playwright or Puppeteer underneath.

[![CI](https://github.com/degrootsam/samurai-framework/actions/workflows/ci.yml/badge.svg)](https://github.com/degrootsam/samurai-framework/actions/workflows/ci.yml)

```ts
import { expect, test } from "../api.js";

test("Visitor can sign in", async ({ page, env, secrets }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(env.testUser as string);
  await page.getByLabel("Password").fill(secrets.TEST_PASSWORD as string);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("welcome")).toHaveText("Welcome back");
});
```

- **Auto-waiting.** Actions wait until the element is attached, visible, stable, enabled and not covered. Assertions retry until they pass or time out.
- **Semantic locators.** By role, label, text, test id, CSS or XPath, with ordered fallbacks.
- **Environments and secrets.** One test file runs against `dev`, `staging` or `production`; secrets come from the environment or a `.env.<name>` file and are masked in logs and reports.
- **Network control.** Mock, block or modify requests; wait for requests, responses and network idle; read response bodies.
- **Recorder building blocks.** Specs are parsed into steps and edited back with minimal diffs, and an engine records what a person does in the browser. The UI that ties them together is not built yet (see the [roadmap](docs/roadmap.md)).

> **Status:** early. Firefox only, run from a checkout of this repository (not published to npm yet). See [what is still open](docs/roadmap.md).

## Getting started

### 1. Requirements

- [Node.js](https://nodejs.org) 26 or newer and [Bun](https://bun.sh) 1.3 or newer (CI uses these versions)
- Firefox installed on the machine. It is found in the usual install locations on Linux, macOS and Windows.

### 2. Install

```sh
git clone https://github.com/degrootsam/samurai-framework.git
cd samurai-framework
bun install
```

### 3. Write a test

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

### 4. Configure

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

### 5. Run

```sh
bun run dev                    # every *.spec.ts under srcDir, in the default environment
bun run dev --env production   # another environment (or SAMURAI_ENV=production)
bun run dev --timeout 60000    # per-test timeout in ms; also --expect-timeout
```

Once the package is installed in a project, `samurai run` does the same with a readable summary and a proper exit code, and `samurai init` scaffolds a new project (see [Command line](docs/cli.md)).

A browser window opens for each test and closes when the test ends. The result is written to `result/report.json` (status, duration and error per test); nothing summarises it on the console yet. The process exits with code 0 when every test passed and 1 otherwise (`--headless` hides the window; on CI it is the default, see [Configuration](docs/configuration.md#headless)). Framework logs go to the console and `logs/`.

> `src/tests/index.spec.ts` is an example that submits a real contact form. Delete it or replace it before running everything.

### 6. Secrets (optional)

```sh
cp .env.example .env.staging
# SAMURAI_SECRET_TEST_PASSWORD=...
```

Read it in a test as `secrets.TEST_PASSWORD`. Real environment variables win over the file, and `.env.*` files are git-ignored. See [Environments and secrets](docs/environments-and-secrets.md).

## Documentation

| Guide                                                        | What it covers                                                                                        |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| [Writing tests](docs/writing-tests.md)                       | `test`, `describe`, fixtures, how a test passes or fails                                              |
| [Locators](docs/locators.md)                                 | Finding elements, chaining, fallbacks, actions and their auto-waiting                                 |
| [Assertions](docs/assertions.md)                             | `expect` for elements and for plain values                                                            |
| [Pages and browsers](docs/pages-and-browsers.md)             | Navigation, waits, screenshots, PDF, viewport, emulation, dialogs, downloads, contexts, cookies       |
| [Network](docs/network.md)                                   | Waiting for traffic, mocking, blocking, response bodies                                               |
| [Configuration](docs/configuration.md)                       | Every option in `samurai.config.ts`, CLI flags and precedence                                         |
| [Environments and secrets](docs/environments-and-secrets.md) | Per-environment settings, variables, secrets and masking                                              |
| [Command line](docs/cli.md)                                  | `samurai run`, `list`, `record` and `init`, options, output, exit codes, `--json`                     |
| [Running tests and reports](docs/running-and-reports.md)     | What a run does, `report.json`, page logs, timeouts                                                   |
| [Steps and the recorder](docs/recorder.md)                   | The step codec and the recording engine                                                               |
| [Embedding the framework](docs/embedding.md)                 | Using the package from another app (such as the Electron UI): build, entry points, `runTests`, events |
| [Contributing](docs/contributing.md)                         | Project layout, running the framework's own tests, conventions                                        |
| [Roadmap](docs/roadmap.md)                                   | What is built and what is still open                                                                  |

Design notes for every feature live in [`docs/superpowers/specs`](docs/superpowers/specs).

## Scripts

| Command                | Does                                            |
| ---------------------- | ----------------------------------------------- |
| `bun run dev`          | Runs the test suite (`tsx src/index.ts`)        |
| `bun run test`         | Unit tests of the framework (no browser needed) |
| `bun run test:browser` | Browser tests of the framework (needs Firefox)  |
| `bun run build`        | Typechecks and compiles to `dist/`              |
