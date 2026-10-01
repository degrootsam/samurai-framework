# Test API alignment — design

Date: 2026-10-01
Status: approved design, not implemented
Roadmap: [recorder-roadmap.md](../recorder-roadmap.md), item 1
Depends on: nothing new (builds on the existing runner, `Page` and config)

## Goal

Give tests the shape the SAMURAI UI and the recorder will generate and parse: a fixtures object, `describe` blocks, `page.goto` relative to the environment's base URL, per-environment variables and secrets.

```ts
import { test, describe, expect } from "samurai-framework";

describe("Checkout", () => {
  test("Checkout with saved card", async ({ page, browser, env, secrets }) => {
    await page.goto("/products");
    await page.locator("input[@id='email']").fill(env.customerEmail);
    await page.locator("input[@id='card']").fill(secrets.TEST_CARD);
  });
});
```

```ts
// samurai.config.ts
export default defineConfig({
  baseURL: "https://harbor.shop",
  timeout: 30000,
  expect: { timeout: 5000 },
  defaultEnvironment: "staging",
  environments: {
    dev: { baseURL: "http://localhost:3000", variables: { customerEmail: "dev@example.test" } },
    staging: {
      baseURL: "https://staging.harbor.shop",
      timeout: 45000,
      expect: { timeout: 8000 },
      variables: { customerEmail: "sam@example.test" },
    },
  },
});
```

## Non-goals

- The `api.<name>` fixture (per-environment HTTP client). Roadmap "Later".
- Masking secrets in screenshots, videos and traces. Roadmap "Later".
- Hooks (`beforeEach`, `afterAll`, …), `test.skip`, `test.only`.
- Secret providers other than environment variables (keychain, vault). The Electron app and CI read those stores themselves and pass values as environment variables.
- Environments stored only in the Electron app ("In SAMURAI only" in the designs).
- Group execution (still a TODO in `test-runner.ts`).
- The "used by N tests" count for secrets and variables (needs the step parser, roadmap item 3).

## Decisions

- **Clean break.** `test(name, async (page, browser) => …)` is removed. Only the fixtures-object form exists. `src/tests/index.spec.ts` is migrated. One signature keeps the parser in roadmap item 3 simple.
- **Secrets come only from environment variables.** No provider plugins in the framework.
- **Every secret is masked, whatever its length.** Short values match as whole tokens only.

## Components

### Public entry point — `src/api.ts` (new)

```ts
export { test, describe } from "./runner/test-runner.js";
export { expect } from "./assert/expect.js";
export type { TestFixtures } from "./types/test.js";
export { defineConfig } from "./config/config.js";
```

- `package.json` gets `"exports": { ".": "./src/api.ts" }` (pointing at `dist/api.js` once a build step ships), so tests import from `"samurai-framework"`.
- `src/index.ts` stays the CLI entry point (runs the tests).

### `describe` and `test` — `src/runner/test-runner.ts`

```ts
export interface TestFixtures {
  page: Page;
  browser: Browser;
  env: Readonly<Record<string, string | number | boolean>>;
  secrets: Readonly<Record<string, string>>;
}

export function describe(title: string, fn: () => void): void;
export function test(title: string, fn: (fixtures: TestFixtures) => Promise<void>): void;
```

- `describe` pushes `title` onto a module-level title stack, calls `fn` synchronously, then pops it (also when `fn` throws). Blocks nest.
- `fn` returning a Promise throws `describe() callback must be synchronous; it only registers tests`.
- `test` registers `{ title, titlePath, file, function }`. The full title is `titlePath.join(" > ")`, e.g. `"Checkout > Checkout with saved card"`, the same format as `SamuraiTest.title` in the config.
- `TestCaseBase.function` changes to `(fixtures: TestFixtures) => Promise<void>`. `TestCaseBase.name` becomes the full title.
- The reporter keys results by `file` + full title, so two tests with the same name in different `describe` blocks or files don't overwrite each other. Reports show the full title.
- The runner builds the fixtures per test: `page` and `browser` from `Browser.launch` (as now), `env` and `secrets` from the run (below).

### `env` fixture — `src/config/variables.ts` (new)

```ts
export function createEnvFixture(environment: string, variables: Record<string, string | number | boolean>): TestFixtures["env"];
export class UnknownVariableError extends Error {}
```

- A frozen Proxy over `variables`. Reading a missing name throws `UnknownVariableError`: `Variable "customerEmail" is not defined in environment "staging"`.
- `Symbol` keys, `then` and `toJSON` are passed through, so `await`, `JSON.stringify` and `console.log` behave normally.
- Writing throws (`TypeError` from the frozen target).

### Run settings — `src/config/run-settings.ts` (new)

```ts
export interface RunOverrides {
  environment?: string;     // --env / SAMURAI_ENV
  timeout?: number;         // --timeout
  expectTimeout?: number;   // --expect-timeout
}

export interface RunSettings {
  environment: string;
  baseURL?: string;
  timeout: number;
  expectTimeout: number;
  variables: Record<string, string | number | boolean>;
}

export function resolveRunSettings(config: SamuraiTestConfig, overrides: RunOverrides): RunSettings;
export function setRunSettings(settings: RunSettings): void;
export function getRunSettings(): RunSettings;   // throws when no run is active
export class UnknownEnvironmentError extends Error {}
```

- Pure; unit-tested with plain objects.
- Environment choice, first match wins:
  1. `overrides.environment` (the CLI parses `--env <name>`; `src/index.ts` falls back to `process.env.SAMURAI_ENV`)
  2. `config.defaultEnvironment`
  3. the only key of `config.environments`, when there is exactly one
  4. no `environments` at all → implicit environment `"default"` with the top-level values and empty `variables`
  5. otherwise throw `UnknownEnvironmentError`: `No environment chosen. Available: dev, staging (use --env or set defaultEnvironment)`
- A chosen name not in `environments` throws `Unknown environment "stg". Available: dev, staging`.
- Precedence per field: run override > environment > project > built-in default (`timeout` 30000, `expectTimeout` 5000). `baseURL`: environment > project > undefined.
- `src/index.ts` loads the config once, resolves the settings, calls `setRunSettings`, then starts the runner.

### Callers that switch to run settings

| Location | Before | After |
|---|---|---|
| `src/runner/test-runner.ts` (test timeout) | `readConfig("timeout")` | `getRunSettings().timeout` |
| `src/wait/wait-until.ts` `resolveTimeout` | `readConfig("expect")?.timeout` | `getRunSettings().expectTimeout` when a run is active, else the config value (unit and browser tests run without a runner) |
| `Page.goto` | — | `getRunSettings().baseURL` when a run is active |

Every other `readConfig` key (`logs`, `bidi`, `navigation`, `browser`, `srcDir`, …) is unchanged; none of them vary per environment.

### Config types — `src/types/config.d.ts`

- `baseUrl` → `baseURL`.
- `SamuraiEnvironment` gains `baseURL?: string`.
- `environments` and `defaultEnvironment` become optional.
- `timeout` becomes optional, matching its documented `@default 30000` (applied by `resolveRunSettings`).
- `samurai.config.ts` in this repo must typecheck after the change.

### `Page.goto` — `src/browser/page.ts`

```ts
public async goto(url: string, options?: NavigateOptions): Promise<{ navigation: string | null; url: string }>;
```

- `goto` is the primary name. `navigateTo` stays as an alias with the same behaviour (existing browser tests keep using it).
- A URL starting with `/`, `./` or `../` is relative: resolved with `new URL(url, baseURL)`. No base URL → throws `page.goto("/products") needs a baseURL; set one in samurai.config.ts or the environment`.
- Anything else keeps today's `navigateTo` behaviour (scheme detection, `https://` default).
- The base URL comes from the active run settings; a `Page` used outside a run (browser tests) has none unless set with `page.setBaseURL(url)`, which browser tests use.

### Secrets — `src/config/secrets.ts` (new)

```ts
export function loadSecrets(environment: string, options?: { cwd?: string; env?: NodeJS.ProcessEnv }): Map<string, string>;
export function createSecretsFixture(environment: string, values: Map<string, string>): TestFixtures["secrets"];
export class MissingSecretError extends Error {}
```

- **Sources**, later wins:
  1. `.env.<environment>` in the project root, if present, parsed with `util.parseEnv` (no dependency, `process.env` untouched)
  2. real environment variables
- Only keys `SAMURAI_SECRET_<NAME>` count; the name is the part after the prefix.
- **Names** must match `[A-Z][A-Z0-9_]*`. Reading `secrets.testCard` throws `Invalid secret name "testCard" (use UPPER_SNAKE_CASE)`.
- **Missing**: reading an unset name throws `MissingSecretError`: `Secret "TEST_CARD" is not set (expected env var SAMURAI_SECRET_TEST_CARD or .env.staging)`. Lookup happens on read, so tests that don't use a missing secret still run.
- **The fixture** is a Proxy: reading a name returns its value; `toJSON` and `util.inspect.custom` return `{ NAME: "••••", … }`, so `JSON.stringify(secrets)` and `console.log(secrets)` never print values.
- `loadSecrets` runs once per run in `src/index.ts`; every loaded value is registered with the masker straight away (not on first read), so values the page logs on its own are masked too.

### Masking — `src/config/mask.ts` (new)

```ts
export const MASK = "••••";
export function registerSecret(name: string, value: string): void;
export function maskText(text: string): string;
export function maskDeep<T>(value: T): T;   // strings inside objects and arrays
export function maskFormat(): Logform.Format;   // winston format
```

- **Values of 4+ characters**: every occurrence is replaced, longest value first (so a secret containing another secret is masked whole). Regex special characters are escaped.
- **Values under 4 characters**: matched only as a whole token (`(?<![\p{L}\p{N}])value(?![\p{L}\p{N}])`, unicode flag), so `1` in `step 1` is masked but `1` in `2026` is not. A string that *equals* the value is always masked. Loading a short secret logs a warning: `Secret "PIN" is short; masking it may hide unrelated text in logs`.
- **Where it applies**:
  - Logger: `maskFormat()` is added to the winston pipeline in `src/logger/index.ts` before `format.json`.
  - Report: the reporter runs `maskDeep` on each `TestResult` before storing it (error `message`, `stack`, `expected`, `actual`, and log entry `text`), so `report.json` and console output are masked.
- Empty values are ignored (nothing to mask).

### Repo hygiene

- `.gitignore` gains `.env.*` (keeping `!.env.example`).
- `.env.example` at the root shows the format:
  ```
  # Copy to .env.<environment>, e.g. .env.staging. Never commit real values.
  SAMURAI_SECRET_TEST_CARD=
  ```

### Report

- `TestSummary` gains `environment: string`; `report.json` records which environment the run used.

## Error handling

| Situation | Error | When |
|---|---|---|
| Unknown or ambiguous environment | `UnknownEnvironmentError` | startup, before any browser launches |
| Unknown variable | `UnknownVariableError` | on read, fails that test |
| Invalid or missing secret | `MissingSecretError` / `Error` | on read, fails that test |
| Relative `goto` without base URL | `Error` | on call, fails that test |
| Async `describe` callback | `Error` | registration |

Test-level errors go through `toTestError` and are masked like any other result.

## Testing

Unit tests (`*.test.ts`, stub connector where a page is involved):

- `describe`/`test`: nested titles, title stack restored after a throwing callback, async callback rejected, duplicate titles in different blocks reported separately.
- `resolveRunSettings`: each environment-choice rule, each precedence level, the implicit `"default"` environment, both error messages.
- `env` fixture: read, unknown name, write rejected, `JSON.stringify`.
- `loadSecrets`: file only, env var only, env var beats file, non-prefixed keys ignored, missing file is fine.
- `secrets` fixture: read, missing, invalid name, `JSON.stringify` and `util.inspect` print masks.
- `mask`: long value substring, short value token-only, exact-equals short value, overlapping secrets (longest first), regex characters in values, `maskDeep` on nested results, winston format.
- `Page.goto`: relative resolution, absolute passthrough, missing base URL error (stub connector checks the URL sent to `browsingContext.navigate`).

Browser test (`*.browser-test.ts`): `page.goto("/path")` against a local server with `page.setBaseURL`.

Migration: `src/tests/index.spec.ts` uses the new signature and imports from `src/api.ts`; `samurai.config.ts` typechecks.
