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
- **Flows.** Chain tests and groups into a graph with conditions, variables, waits and HTTP requests, and run it from the command line or CI (see [Flows](docs/flows.md)).
- **Recorder building blocks.** Specs are parsed into steps and edited back with minimal diffs, and an engine records what a person does in the browser. A toolbar in the recorded page adds assertions, variables and secrets, waits, screenshots and pause (see [Steps and the recorder](docs/recorder.md)). The Electron app that ties them together lives in a separate repository (see the [roadmap](docs/roadmap.md)).

> **Status:** early. Firefox only. See [what is still open](docs/roadmap.md).

## Getting started

### In your own project

The package is published on npm as [`@itmetsam/samurai-framework`](https://www.npmjs.com/package/@itmetsam/samurai-framework). In an empty folder:

```sh
npx -p @itmetsam/samurai-framework samurai init   # config, an example test, .env.example, .gitignore
npm install
npx samurai browsers install firefox             # once per machine
npx samurai run
```

Specs and the config then import from `@itmetsam/samurai-framework` instead of the relative paths used below. See [Command line](docs/cli.md).

The rest of this section works in a checkout of this repository.

### 1. Requirements

- [Node.js](https://nodejs.org) 24 or newer (`engines` in `package.json`; CI uses 26) and, to work on the framework, [Bun](https://bun.sh) 1.3 or newer
- Firefox, downloaded by the framework: run `bun run dev browsers install firefox` once in this checkout (`npx samurai browsers install firefox` in a project; see [Which browser runs](docs/pages-and-browsers.md#which-browser-runs)). The Firefox installed on the machine is not used.

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

`bun run dev` is `samurai run` straight from the sources, so it takes the same options (`--grep`, `--file`, `--group`, `--headless`, `--json`, …) and the other commands too (`bun run dev list`, `bun run dev browsers install firefox`). See [Command line](docs/cli.md).

A browser window opens for each test and closes when the test ends (`--headless` hides it; on CI it is the default, see [Configuration](docs/configuration.md#headless)). Each test's result is printed as it finishes, followed by a summary, and the full report is written to `result/report.json`. The process exits with code 0 when every test passed, 1 otherwise and 2 for a usage or configuration error. Framework logs go to stderr and `logs/`.

> `src/tests/index.spec.ts` is an example that submits a real contact form. Delete it or replace it before running everything.

### Flows (optional)

A project can also keep flows in `flows/*.flow.json` (edited in the Samurai app) that chain tests and groups with conditions and variables. `samurai flow check` validates them and `samurai flow run <flow>` runs them, with a report in `result/flows/`. See [Flows](docs/flows.md).

### 6. Secrets (optional)

```sh
cp .env.example .env.staging
# then add a line per secret, e.g.
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
| [Flows](docs/flows.md)                                       | `samurai flow list`, `check` and `run`: graphs of tests, groups and steps, reports, CI                |
| [Writing a step](docs/steps.md)                              | `defineStep`: flow steps of your own, the built-in steps                                              |
| [Running tests and reports](docs/running-and-reports.md)     | What a run does, `report.json`, page logs, timeouts                                                   |
| [Steps and the recorder](docs/recorder.md)                   | The step codec, the recording engine and the recorder toolbar                                         |
| [Embedding the framework](docs/embedding.md)                 | Using the package from another app (such as the Electron UI): build, entry points, `runTests`, events |
| [Contributing](docs/contributing.md)                         | Project layout, running the framework's own tests, conventions                                        |
| [Roadmap](docs/roadmap.md)                                   | What is built and what is still open                                                                  |

The [documentation index](docs/README.md) lists every guide and design note by topic. Design notes for every feature live in [`docs/superpowers/specs`](docs/superpowers/specs).

## Scripts

| Command                | Does                                            |
| ---------------------- | ----------------------------------------------- |
| `bun run dev`          | `samurai` from the sources (`tsx src/index.ts`) |
| `bun run test`         | Unit tests of the framework (no browser needed) |
| `bun run test:browser` | Browser tests of the framework (needs Firefox)  |
| `bun run test:cli`     | Tests of the `samurai` command (build first)    |
| `bun run build`        | Typechecks and compiles to `dist/`              |
