# Test API Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tests take one fixtures object (`{ page, browser, env, secrets }`), can be grouped with `describe`, navigate with `page.goto("/path")` relative to the environment's base URL, and read per-environment variables and secrets, with secret values masked in logs and the report.

**Architecture:** A pure `resolveRunSettings` turns the config plus CLI overrides into one `RunSettings` (environment, baseURL, timeouts, variables) that the CLI makes active once per run. Secrets are loaded from `SAMURAI_SECRET_*` env vars (and an optional `.env.<environment>` file) and every value is registered with a masker that the winston logger and the reporter run all output through. Test registration moves to its own module (`registry.ts`) with a `describe` title stack; the runner builds the fixtures per test.

**Tech Stack:** TypeScript (`module: nodenext`, `strict`, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`), tsx, Node 26 built-ins (`node:test`, `node:assert/strict`, `util.parseArgs`, `util.parseEnv`), winston 3.19 / logform 2.7, WebDriver BiDi (Firefox).

**Spec:** `docs/superpowers/specs/2026-10-01-test-api-alignment-design.md`

## Global Constraints

- No new dependencies. Unit tests use `node:test` via `npm test` (`tsx --test "src/**/*.test.ts"`); browser tests via `npm run test:browser`.
- Relative imports use the `.js` extension; type-only imports use `import type`.
- Mask string: `"••••"`. Short secret: fewer than 4 characters, matched as a whole token only (`(?<![\p{L}\p{N}])value(?![\p{L}\p{N}])`, flags `gu`).
- Secret env var prefix `SAMURAI_SECRET_`; names match `^[A-Z][A-Z0-9_]*$`; file `.env.<environment>` in the project root; a real env var beats the file.
- Built-in defaults: test timeout `30000` ms, expect timeout `5000` ms; implicit environment name `"default"`.
- Full test title: `describe` titles and the test title joined with `" > "`.
- Error messages, verbatim:
  - `Variable "<name>" is not defined in environment "<env>"`
  - `Secret "<NAME>" is not set (expected env var SAMURAI_SECRET_<NAME> or .env.<env>)`
  - `Invalid secret name "<name>" (use UPPER_SNAKE_CASE)`
  - `Unknown environment "<name>". Available: <a>, <b>`
  - `No environment chosen. Available: <a>, <b> (use --env or set defaultEnvironment)`
  - `page.goto("<url>") needs a baseURL; set one in samurai.config.ts or the environment`
  - `describe() callback must be synchronous; it only registers tests`
  - `Secret "<NAME>" is short; masking it may hide unrelated text in logs`
- `tsc --noEmit -p .` baseline today has errors in `src/config/default.ts` and `src/runner/test-runner.ts`. Task 1 fixes `default.ts`; Task 7 fixes `test-runner.ts`. No task may add new errors; after Task 7 there are **zero**.
- Never run `npm run dev` / `src/tests/index.spec.ts` without asking the user: it submits a real contact form on itmetsam.nl.
- Leave `result/report.json` and `bun.lock` uncommitted; never `git add -A`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **`file` of a registered test is the spec file, not the framework.** Today `test()` takes the first `(...)` of the stack, which is its own frame, so every test reports `test-runner.ts`. With results keyed by file + title this would merge tests. Pinned in Task 4 (`records the calling spec file`).
2. **A secret inside a thrown error** (e.g. an assertion's `expected`, or a fill error quoting the value) must not reach `report.json`. Pinned in Task 5 (`masks secrets in errors and logs`).
3. **Secrets with regex characters** (`p@ss.w*rd+(1)`) must be masked literally, not crash or over-match. Pinned in Task 2 (`escapes regex characters`).
4. **`.env.<environment>` written by hand** — comments, quotes, blank lines, `export`-less lines — parses like a normal dotenv file. Pinned in Task 3 (`parses comments and quotes in .env files`).
5. **Bad CLI input** — `--env` with no value, `--timeout abc`, `--timeout -5` — fails with a clear message before any browser launches. Pinned in Task 1 (`rejects bad overrides`).

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/types/config.d.ts` | modify | `baseUrl` → `baseURL`; env `baseURL`; `timeout`, `environments`, `defaultEnvironment` optional |
| `src/config/config.ts` | modify | `loadConfig()` (whole config); `readConfig` uses it |
| `src/config/run-settings.ts` | create | `resolveRunSettings`, `parseRunOverrides`, active-run state |
| `src/config/run-settings.test.ts` | create | |
| `src/config/mask.ts` | create | secret registry, `maskText`, `maskDeep`, winston `maskFormat` |
| `src/config/mask.test.ts` | create | |
| `src/logger/index.ts` | modify | add `maskFormat()` to the pipeline |
| `src/config/variables.ts` | create | `env` fixture Proxy, `UnknownVariableError`, `isPassthroughKey` |
| `src/config/secrets.ts` | create | `loadSecrets`, `secrets` fixture Proxy, `MissingSecretError` |
| `src/config/fixtures.test.ts` | create | tests for `variables.ts` and `secrets.ts` |
| `src/types/test.d.ts` | modify | `TestFixtures`, new test function signature, `titlePath`, summary `environment` |
| `src/runner/registry.ts` | create | `describe`, `test`, registered tests, caller file |
| `src/runner/registry.test.ts` | create | |
| `src/runner/reporter.ts` | modify | keyed by file + title, masking, `environment`, `output` option |
| `src/runner/reporter.test.ts` | create | |
| `src/browser/page.ts` | modify | `goto`, `setBaseURL` |
| `src/browser/page.test.ts` | modify | `goto` unit tests |
| `src/browser/goto.browser-test.ts` | create | `goto("/path")` against a local server |
| `src/runner/prepare-run.ts` | create | resolve settings + load and register secrets + activate |
| `src/runner/prepare-run.test.ts` | create | |
| `src/runner/test-runner.ts` | modify | use registry, fixtures, run settings; fix baseline tsc errors |
| `src/wait/wait-until.ts` | modify | `resolveTimeout` reads active run settings first |
| `src/wait/wait-until.test.ts` | modify | |
| `src/index.ts` | modify | CLI: parse overrides, prepare run, start runner |
| `src/api.ts` | create | public exports |
| `package.json` | modify | `"exports"` |
| `src/tests/index.spec.ts` | modify | new signature, imports from `../api.js` |
| `.gitignore`, `.env.example` | modify / create | secret files hygiene |

---

### Task 1: Config types and run settings

**Files:**
- Modify: `src/types/config.d.ts`
- Modify: `src/config/config.ts`
- Create: `src/config/run-settings.ts`
- Test: `src/config/run-settings.test.ts`

**Interfaces:**
- Consumes: `SamuraiTestConfig` from `src/types/config.d.ts`.
- Produces:
  - `type Variables = Record<string, string | number | boolean>`
  - `interface RunOverrides { environment?: string; timeout?: number; expectTimeout?: number }`
  - `interface RunSettings { environment: string; baseURL?: string; timeout: number; expectTimeout: number; variables: Variables }`
  - `resolveRunSettings(config: SamuraiTestConfig, overrides?: RunOverrides): RunSettings`
  - `parseRunOverrides(argv: string[], env?: NodeJS.ProcessEnv): RunOverrides`
  - `setRunSettings(settings: RunSettings | undefined): void`, `peekRunSettings(): RunSettings | undefined`, `getRunSettings(): RunSettings`
  - `class UnknownEnvironmentError extends Error`
  - `loadConfig(): Promise<SamuraiTestConfig>` in `src/config/config.ts`

- [ ] **Step 1: Update the config types**

In `src/types/config.d.ts`:

In `SamuraiEnvironment`, add as the first member:
```ts
  /** Where page.goto('/…') resolves to in this environment, and where recordings start */
  baseURL?: string;
```

In `SamuraiTestConfig`, change `timeout: number;` to `timeout?: number;`, rename `baseUrl?: string;` to `baseURL?: string;`, and change the last two members to:
```ts
  /** Keyed by name: 'dev', 'staging', 'production' */
  environments?: Record<string, SamuraiEnvironment>;
  /** Used when no environment is chosen with --env or SAMURAI_ENV */
  defaultEnvironment?: string;
```

Also export `SamuraiEnvironment` (change `export interface SamuraiEnvironment` if it is not exported already — it is, keep it).

- [ ] **Step 2: Add `loadConfig`**

Replace the body of `src/config/config.ts` with:
```ts
import type { SamuraiTestConfig } from "../types/config.js";
import path from "path";
import logger from "../logger/index.js";
import { pathToFileURL } from "url";

/** The whole `samurai.config.ts` of the current working directory */
export async function loadConfig(): Promise<SamuraiTestConfig> {
  const configUrl = path.join(process.cwd(), "samurai.config.ts");
  logger.debug("Reading config from: %s", configUrl);

  const config = (await import(pathToFileURL(configUrl).href)) as {
    default?: SamuraiTestConfig;
  };

  if (!config.default) {
    throw new Error(
      "samurai.config.ts does not export defineConfig as default!",
    );
  }
  return config.default;
}

export async function readConfig<K extends keyof SamuraiTestConfig>(
  key: K,
): Promise<SamuraiTestConfig[K]> {
  const value = (await loadConfig())[key];
  logger.debug("Resolved config value: ", { value });
  return value;
}

export function defineConfig(config: SamuraiTestConfig) {
  return config;
}
```

- [ ] **Step 3: Write the failing tests**

Create `src/config/run-settings.test.ts`:
```ts
import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { SamuraiTestConfig } from "../types/config.js";
import {
  getRunSettings,
  parseRunOverrides,
  peekRunSettings,
  resolveRunSettings,
  setRunSettings,
  UnknownEnvironmentError,
} from "./run-settings.js";

const twoEnvironments: SamuraiTestConfig = {
  baseURL: "https://harbor.shop",
  timeout: 20000,
  expect: { timeout: 3000 },
  environments: {
    dev: { baseURL: "http://localhost:3000", variables: { customerEmail: "dev@example.test" } },
    staging: { timeout: 45000, expect: { timeout: 8000 }, variables: { customerEmail: "sam@example.test" } },
  },
};

describe("resolveRunSettings: choosing the environment", () => {
  test("an override wins over defaultEnvironment", () => {
    const settings = resolveRunSettings({ ...twoEnvironments, defaultEnvironment: "staging" }, { environment: "dev" });
    assert.equal(settings.environment, "dev");
  });

  test("defaultEnvironment is used without an override", () => {
    assert.equal(resolveRunSettings({ ...twoEnvironments, defaultEnvironment: "staging" }).environment, "staging");
  });

  test("the only environment is used when nothing is chosen", () => {
    assert.equal(resolveRunSettings({ environments: { qa: {} } }).environment, "qa");
  });

  test("no environments gives the implicit default environment with top-level values", () => {
    assert.deepEqual(resolveRunSettings({ baseURL: "https://harbor.shop", timeout: 1000 }), {
      environment: "default",
      baseURL: "https://harbor.shop",
      timeout: 1000,
      expectTimeout: 5000,
      variables: {},
    });
  });

  test("several environments and no choice throws, listing them", () => {
    assert.throws(
      () => resolveRunSettings(twoEnvironments),
      (err) =>
        err instanceof UnknownEnvironmentError &&
        err.message === "No environment chosen. Available: dev, staging (use --env or set defaultEnvironment)",
    );
  });

  test("an unknown name throws, listing the available ones", () => {
    assert.throws(
      () => resolveRunSettings(twoEnvironments, { environment: "stg" }),
      (err) => err instanceof UnknownEnvironmentError && err.message === 'Unknown environment "stg". Available: dev, staging',
    );
  });

  test("a named environment when none are defined throws", () => {
    assert.throws(
      () => resolveRunSettings({}, { environment: "staging" }),
      (err) =>
        err instanceof UnknownEnvironmentError &&
        err.message === 'Unknown environment "staging". No environments are defined in samurai.config.ts',
    );
  });
});

describe("resolveRunSettings: precedence", () => {
  test("environment values beat project values", () => {
    const settings = resolveRunSettings(twoEnvironments, { environment: "staging" });
    assert.equal(settings.timeout, 45000);
    assert.equal(settings.expectTimeout, 8000);
    assert.equal(settings.baseURL, "https://harbor.shop");
    assert.deepEqual(settings.variables, { customerEmail: "sam@example.test" });
  });

  test("project values fill what the environment leaves out", () => {
    const settings = resolveRunSettings(twoEnvironments, { environment: "dev" });
    assert.equal(settings.timeout, 20000);
    assert.equal(settings.expectTimeout, 3000);
    assert.equal(settings.baseURL, "http://localhost:3000");
  });

  test("run overrides beat everything", () => {
    const settings = resolveRunSettings(twoEnvironments, { environment: "staging", timeout: 1, expectTimeout: 2 });
    assert.equal(settings.timeout, 1);
    assert.equal(settings.expectTimeout, 2);
  });

  test("built-in defaults apply last", () => {
    const settings = resolveRunSettings({ environments: { qa: {} } });
    assert.equal(settings.timeout, 30000);
    assert.equal(settings.expectTimeout, 5000);
    assert.equal("baseURL" in settings, false);
  });

  test("variables are a copy", () => {
    const config: SamuraiTestConfig = { environments: { qa: { variables: { a: 1 } } } };
    resolveRunSettings(config).variables.a = 2;
    assert.equal(config.environments?.qa?.variables?.a, 1);
  });
});

describe("parseRunOverrides", () => {
  test("reads --env, --timeout and --expect-timeout", () => {
    assert.deepEqual(parseRunOverrides(["--env", "dev", "--timeout", "1000", "--expect-timeout=200"]), {
      environment: "dev",
      timeout: 1000,
      expectTimeout: 200,
    });
  });

  test("falls back to SAMURAI_ENV", () => {
    assert.deepEqual(parseRunOverrides([], { SAMURAI_ENV: "staging" }), { environment: "staging" });
    assert.deepEqual(parseRunOverrides(["--env", "dev"], { SAMURAI_ENV: "staging" }), { environment: "dev" });
  });

  test("nothing given is no overrides", () => {
    assert.deepEqual(parseRunOverrides([], {}), {});
  });

  test("rejects bad overrides", () => {
    assert.throws(() => parseRunOverrides(["--env"]), /--env/);
    assert.throws(() => parseRunOverrides(["--timeout", "abc"]), {
      message: '--timeout must be a whole number of milliseconds, got "abc"',
    });
    // A value starting with "-" must use "=" (parseArgs treats "--timeout -5" as a missing value)
    assert.throws(() => parseRunOverrides(["--timeout=-5"]), /--timeout must be a whole number/);
    assert.throws(() => parseRunOverrides(["--expect-timeout", ""]), /--expect-timeout must be a whole number/);
  });
});

describe("active run settings", () => {
  afterEach(() => setRunSettings(undefined));

  test("nothing is active until set", () => {
    assert.equal(peekRunSettings(), undefined);
    assert.throws(() => getRunSettings(), /No test run is active/);
  });

  test("set settings are returned", () => {
    const settings = resolveRunSettings({});
    setRunSettings(settings);
    assert.equal(peekRunSettings(), settings);
    assert.equal(getRunSettings(), settings);
  });
});
```

- [ ] **Step 4: Run the tests to see them fail**

Run: `npx tsx --test src/config/run-settings.test.ts`
Expected: FAIL — `Cannot find module './run-settings.js'`.

- [ ] **Step 5: Implement `src/config/run-settings.ts`**

```ts
import { parseArgs } from "node:util";
import type { SamuraiTestConfig } from "../types/config.js";

export type Variables = Record<string, string | number | boolean>;

/** Values given for one run (CLI flags, SAMURAI_ENV); they beat the config */
export interface RunOverrides {
  environment?: string;
  timeout?: number;
  expectTimeout?: number;
}

/** Everything about a run that depends on the chosen environment */
export interface RunSettings {
  environment: string;
  baseURL?: string;
  /** Time (ms) one test may take */
  timeout: number;
  /** Time (ms) actions and assertions retry */
  expectTimeout: number;
  variables: Variables;
}

const DEFAULT_TIMEOUT = 30000;
const DEFAULT_EXPECT_TIMEOUT = 5000;
/** The environment of a config without `environments` */
const IMPLICIT_ENVIRONMENT = "default";

export class UnknownEnvironmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnknownEnvironmentError";
  }
}

/** Picks the environment and applies precedence: run override > environment > project > built-in default */
export function resolveRunSettings(config: SamuraiTestConfig, overrides: RunOverrides = {}): RunSettings {
  const environments = config.environments ?? {};
  const names = Object.keys(environments);
  const available = `Available: ${names.join(", ")}`;

  let name = overrides.environment ?? config.defaultEnvironment;
  if (name === undefined) {
    if (names.length === 0) name = IMPLICIT_ENVIRONMENT;
    else if (names.length === 1) name = names[0]!;
    else throw new UnknownEnvironmentError(`No environment chosen. ${available} (use --env or set defaultEnvironment)`);
  }

  const environment = environments[name];
  if (!environment && !(names.length === 0 && name === IMPLICIT_ENVIRONMENT)) {
    throw new UnknownEnvironmentError(
      names.length === 0
        ? `Unknown environment "${name}". No environments are defined in samurai.config.ts`
        : `Unknown environment "${name}". ${available}`,
    );
  }

  const baseURL = environment?.baseURL ?? config.baseURL;
  return {
    environment: name,
    ...(baseURL !== undefined && { baseURL }),
    timeout: overrides.timeout ?? environment?.timeout ?? config.timeout ?? DEFAULT_TIMEOUT,
    expectTimeout:
      overrides.expectTimeout ?? environment?.expect?.timeout ?? config.expect?.timeout ?? DEFAULT_EXPECT_TIMEOUT,
    variables: { ...(environment?.variables ?? {}) },
  };
}

/** Reads `--env`, `--timeout` and `--expect-timeout` from `argv`; the environment falls back to SAMURAI_ENV */
export function parseRunOverrides(argv: string[], env: NodeJS.ProcessEnv = {}): RunOverrides {
  const { values } = parseArgs({
    args: argv,
    options: {
      env: { type: "string" },
      timeout: { type: "string" },
      "expect-timeout": { type: "string" },
    },
    strict: true,
    allowPositionals: true,
  });
  const overrides: RunOverrides = {};
  const environment = values.env ?? env.SAMURAI_ENV;
  if (environment) overrides.environment = environment;
  if (values.timeout !== undefined) overrides.timeout = milliseconds("--timeout", values.timeout);
  if (values["expect-timeout"] !== undefined) {
    overrides.expectTimeout = milliseconds("--expect-timeout", values["expect-timeout"]);
  }
  return overrides;
}

function milliseconds(flag: string, raw: string): number {
  const value = Number(raw);
  if (raw.trim() === "" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${flag} must be a whole number of milliseconds, got "${raw}"`);
  }
  return value;
}

let active: RunSettings | undefined;

/** Makes `settings` the run's settings; `undefined` ends the run (tests use this to reset) */
export function setRunSettings(settings: RunSettings | undefined): void {
  active = settings;
}

/** The active run's settings, or undefined outside a run (unit and browser tests) */
export function peekRunSettings(): RunSettings | undefined {
  return active;
}

export function getRunSettings(): RunSettings {
  if (!active) throw new Error("No test run is active; run settings are set when the runner starts");
  return active;
}
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `npx tsx --test src/config/run-settings.test.ts`
Expected: PASS, all tests.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: the `src/config/default.ts` error is gone; only the pre-existing `src/runner/test-runner.ts` errors remain.

- [ ] **Step 8: Commit**

```bash
git add src/types/config.d.ts src/config/config.ts src/config/run-settings.ts src/config/run-settings.test.ts
git commit -m "feat(config): resolve run settings per environment

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Secret masking

**Files:**
- Create: `src/config/mask.ts`
- Modify: `src/logger/index.ts`
- Test: `src/config/mask.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `const MASK = "••••"`
  - `registerSecret(name: string, value: string): void` (empty values ignored)
  - `resetSecrets(): void` (tests only)
  - `isShortSecret(value: string): boolean` (`0 < length < 4`)
  - `maskText(text: string): string`
  - `maskDeep<T>(value: T): T` — strings in plain objects and arrays, returns a copy
  - `maskFormat` — winston format factory; use as `maskFormat()`

- [ ] **Step 1: Write the failing tests**

Create `src/config/mask.test.ts`:
```ts
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { isShortSecret, MASK, maskDeep, maskFormat, maskText, registerSecret, resetSecrets } from "./mask.js";

afterEach(() => resetSecrets());

test("nothing registered leaves text alone", () => {
  assert.equal(maskText("card 4242"), "card 4242");
});

test("masks every occurrence of a long value", () => {
  registerSecret("TEST_CARD", "4242424242424242");
  assert.equal(maskText("fill 4242424242424242 then 4242424242424242x"), `fill ${MASK} then ${MASK}x`);
});

test("escapes regex characters", () => {
  registerSecret("PW", "p@ss.w*rd+(1)");
  assert.equal(maskText("pw=p@ss.w*rd+(1)!"), `pw=${MASK}!`);
  assert.equal(maskText("p@ssXw*rd+(1)"), "p@ssXw*rd+(1)");
});

test("masks the longest secret first", () => {
  registerSecret("SHORT", "secret");
  registerSecret("LONG", "secret-and-more");
  assert.equal(maskText("x secret-and-more y secret"), `x ${MASK} y ${MASK}`);
});

test("short values only match whole tokens", () => {
  registerSecret("PIN", "12");
  assert.equal(maskText("pin 12, step 12."), `pin ${MASK}, step ${MASK}.`);
  assert.equal(maskText("2012 and a12b"), "2012 and a12b");
  assert.equal(maskText("12"), MASK);
});

test("empty values are ignored", () => {
  registerSecret("EMPTY", "");
  assert.equal(maskText("anything"), "anything");
});

test("isShortSecret", () => {
  assert.equal(isShortSecret("abc"), true);
  assert.equal(isShortSecret("abcd"), false);
  assert.equal(isShortSecret(""), false);
});

test("maskDeep masks strings in nested objects and arrays and returns a copy", () => {
  registerSecret("TEST_CARD", "4242424242424242");
  const result = {
    message: "expected 4242424242424242",
    expected: "4242424242424242",
    duration: 12,
    logs: [{ text: "typed 4242424242424242", timestamp: 1 }],
  };
  const masked = maskDeep(result);
  assert.deepEqual(masked, {
    message: `expected ${MASK}`,
    expected: MASK,
    duration: 12,
    logs: [{ text: `typed ${MASK}`, timestamp: 1 }],
  });
  assert.equal(result.expected, "4242424242424242");
});

test("maskFormat masks the message and metadata of a log entry", () => {
  registerSecret("TEST_CARD", "4242424242424242");
  const info = maskFormat().transform({
    level: "info",
    message: "filled 4242424242424242",
    meta: { value: "4242424242424242" },
  }) as { message: string; meta: { value: string } };
  assert.equal(info.message, `filled ${MASK}`);
  assert.equal(info.meta.value, MASK);
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx tsx --test src/config/mask.test.ts`
Expected: FAIL — `Cannot find module './mask.js'`.

- [ ] **Step 3: Implement `src/config/mask.ts`**

```ts
import { format } from "winston";

export const MASK = "••••";
/** Values shorter than this only match as a whole token, so "1" does not hide every digit */
const SHORT_LENGTH = 4;

const secrets = new Map<string, string>();
let patterns: RegExp[] = [];

/** Registers a secret value; every later maskText/maskDeep/log line hides it */
export function registerSecret(name: string, value: string): void {
  if (value === "") return;
  secrets.set(name, value);
  rebuild();
}

/** Forgets every registered secret (tests only) */
export function resetSecrets(): void {
  secrets.clear();
  patterns = [];
}

export function isShortSecret(value: string): boolean {
  return value.length > 0 && value.length < SHORT_LENGTH;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rebuild(): void {
  // Longest first, so a secret that contains another one is hidden whole
  const values = [...new Set(secrets.values())].sort((a, b) => b.length - a.length);
  patterns = values.map((value) =>
    isShortSecret(value)
      ? new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(value)}(?![\\p{L}\\p{N}])`, "gu")
      : new RegExp(escapeRegExp(value), "gu"),
  );
}

export function maskText(text: string): string {
  let masked = text;
  for (const pattern of patterns) masked = masked.replace(pattern, MASK);
  return masked;
}

/** A copy of `value` with every string in it (plain objects and arrays, any depth) masked */
export function maskDeep<T>(value: T): T {
  if (patterns.length === 0) return value;
  return walk(value) as T;
}

function walk(value: unknown): unknown {
  if (typeof value === "string") return maskText(value);
  if (Array.isArray(value)) return value.map(walk);
  if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item)]));
  }
  return value;
}

/** Winston format that masks every string field of a log entry (message and metadata) */
export const maskFormat = format((info) => {
  if (patterns.length === 0) return info;
  for (const key of Object.keys(info)) info[key] = walk(info[key]);
  return info;
});
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx tsx --test src/config/mask.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the format to the logger**

In `src/logger/index.ts`, add the import:
```ts
import { maskFormat } from "../config/mask.js";
```
and in the logger-level `format.combine(...)`, insert `maskFormat(),` directly after `format.metadata({ key: "meta" }),` (before `format.json(...)`). Logger-level formats run before each transport's own format, so console and file output are both masked.

- [ ] **Step 6: Run the whole unit suite**

Run: `npm test`
Expected: PASS (602 existing tests plus the new ones).

- [ ] **Step 7: Commit**

```bash
git add src/config/mask.ts src/config/mask.test.ts src/logger/index.ts
git commit -m "feat(config): mask secret values in logs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `env` and `secrets` fixtures

**Files:**
- Create: `src/config/variables.ts`
- Create: `src/config/secrets.ts`
- Test: `src/config/fixtures.test.ts`

**Interfaces:**
- Consumes: `Variables` from `./run-settings.js` (Task 1); `MASK` from `./mask.js` (Task 2).
- Produces:
  - `createEnvFixture(environment: string, variables: Variables): Readonly<Variables>`
  - `class UnknownVariableError extends Error`
  - `isPassthroughKey(target: object, key: string | symbol): boolean`
  - `loadSecrets(environment: string, options?: { cwd?: string; env?: NodeJS.ProcessEnv }): Map<string, string>`
  - `createSecretsFixture(environment: string, values: ReadonlyMap<string, string>): Readonly<Record<string, string>>`
  - `class MissingSecretError extends Error`

- [ ] **Step 1: Write the failing tests**

Create `src/config/fixtures.test.ts`:
```ts
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { inspect } from "node:util";
import { createEnvFixture, UnknownVariableError } from "./variables.js";
import { createSecretsFixture, loadSecrets, MissingSecretError } from "./secrets.js";

describe("env fixture", () => {
  const env = createEnvFixture("staging", { customerEmail: "sam@example.test", newCheckout: true });

  test("reads variables", () => {
    assert.equal(env.customerEmail, "sam@example.test");
    const { newCheckout } = env;
    assert.equal(newCheckout, true);
  });

  test("an unknown variable throws", () => {
    assert.throws(
      () => env.customerEmial,
      (err) =>
        err instanceof UnknownVariableError &&
        err.message === 'Variable "customerEmial" is not defined in environment "staging"',
    );
  });

  test("is read-only", () => {
    assert.throws(() => {
      (env as Record<string, unknown>).customerEmail = "x";
    }, TypeError);
  });

  test("behaves like a plain object for JSON, inspect and await", async () => {
    assert.equal(JSON.stringify(env), '{"customerEmail":"sam@example.test","newCheckout":true}');
    assert.match(inspect(env), /customerEmail/);
    assert.equal(await env, env);
    assert.equal("customerEmail" in env, true);
  });
});

describe("loadSecrets", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "samurai-secrets-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(
    path.join(dir, ".env.staging"),
    [
      "# staging secrets",
      "",
      "SAMURAI_SECRET_TEST_CARD=4242424242424242",
      'SAMURAI_SECRET_CUSTOMER_PW="pa ss # word"',
      "SAMURAI_SECRET_FROM_FILE=file",
      "OTHER_VALUE=ignored",
    ].join("\n"),
  );

  test("parses comments and quotes in .env files", () => {
    const secrets = loadSecrets("staging", { cwd: dir, env: {} });
    assert.deepEqual(Object.fromEntries(secrets), {
      TEST_CARD: "4242424242424242",
      CUSTOMER_PW: "pa ss # word",
      FROM_FILE: "file",
    });
  });

  test("env vars beat the file and non-prefixed keys are ignored", () => {
    const secrets = loadSecrets("staging", {
      cwd: dir,
      env: { SAMURAI_SECRET_FROM_FILE: "env", SAMURAI_SECRET_ONLY_ENV: "x", PATH: "/bin" },
    });
    assert.equal(secrets.get("FROM_FILE"), "env");
    assert.equal(secrets.get("ONLY_ENV"), "x");
    assert.equal(secrets.has("PATH"), false);
  });

  test("a missing file is fine", () => {
    assert.deepEqual(Object.fromEntries(loadSecrets("dev", { cwd: dir, env: { SAMURAI_SECRET_A: "1" } })), { A: "1" });
  });

  test("names that are not UPPER_SNAKE_CASE are skipped", () => {
    assert.equal(loadSecrets("dev", { cwd: dir, env: { SAMURAI_SECRET_lower: "x" } }).size, 0);
  });
});

describe("secrets fixture", () => {
  const secrets = createSecretsFixture("staging", new Map([["TEST_CARD", "4242424242424242"]]));

  test("reads a secret", () => {
    assert.equal(secrets.TEST_CARD, "4242424242424242");
  });

  test("a missing secret throws", () => {
    assert.throws(
      () => secrets.CUSTOMER_PW,
      (err) =>
        err instanceof MissingSecretError &&
        err.message === 'Secret "CUSTOMER_PW" is not set (expected env var SAMURAI_SECRET_CUSTOMER_PW or .env.staging)',
    );
  });

  test("an invalid name throws", () => {
    assert.throws(() => secrets.testCard, { message: 'Invalid secret name "testCard" (use UPPER_SNAKE_CASE)' });
  });

  test("JSON and inspect never show values", () => {
    assert.equal(JSON.stringify(secrets), '{"TEST_CARD":"••••"}');
    assert.equal(JSON.stringify({ secrets }), '{"secrets":{"TEST_CARD":"••••"}}');
    assert.doesNotMatch(inspect(secrets), /4242/);
    assert.match(inspect(secrets), /TEST_CARD/);
  });

  test("is read-only", () => {
    assert.throws(() => {
      (secrets as Record<string, string>).TEST_CARD = "x";
    }, TypeError);
    assert.equal(secrets.TEST_CARD, "4242424242424242");
  });

  test("await does not treat it as a thenable", async () => {
    assert.equal(await secrets, secrets);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx tsx --test src/config/fixtures.test.ts`
Expected: FAIL — `Cannot find module './variables.js'`.

- [ ] **Step 3: Implement `src/config/variables.ts`**

```ts
import type { Variables } from "./run-settings.js";

export class UnknownVariableError extends Error {
  constructor(name: string, environment: string) {
    super(`Variable "${name}" is not defined in environment "${environment}"`);
    this.name = "UnknownVariableError";
  }
}

/**
 * Keys that every object answers and that `await`, JSON.stringify and util.inspect probe:
 * symbols, `then`, `toJSON` and Object.prototype members. Reading them never throws.
 */
export function isPassthroughKey(target: object, key: string | symbol): boolean {
  return (
    typeof key === "symbol" ||
    key === "then" ||
    key === "toJSON" ||
    (!Object.hasOwn(target, key) && key in target)
  );
}

/** The test's `env`: the environment's variables, read-only; an unknown name throws */
export function createEnvFixture(environment: string, variables: Variables): Readonly<Variables> {
  return new Proxy(Object.freeze({ ...variables }), {
    get(target, key, receiver) {
      if (isPassthroughKey(target, key) || Object.hasOwn(target, key)) return Reflect.get(target, key, receiver);
      throw new UnknownVariableError(String(key), environment);
    },
  });
}
```

- [ ] **Step 4: Implement `src/config/secrets.ts`**

```ts
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { inspect, parseEnv } from "node:util";
import logger from "../logger/index.js";
import { MASK } from "./mask.js";
import { isPassthroughKey } from "./variables.js";

const PREFIX = "SAMURAI_SECRET_";
const NAME = /^[A-Z][A-Z0-9_]*$/;

export class MissingSecretError extends Error {
  constructor(name: string, environment: string) {
    super(`Secret "${name}" is not set (expected env var ${PREFIX}${name} or .env.${environment})`);
    this.name = "MissingSecretError";
  }
}

/** Secrets by name: `.env.<environment>` in `cwd` first, then env vars (which win) */
export function loadSecrets(
  environment: string,
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Map<string, string> {
  const file = path.join(options.cwd ?? process.cwd(), `.env.${environment}`);
  const sources: Array<Record<string, string | undefined>> = [];
  if (existsSync(file)) sources.push(parseEnv(readFileSync(file, "utf8")) as Record<string, string>);
  sources.push(options.env ?? process.env);

  const secrets = new Map<string, string>();
  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) {
      if (!key.startsWith(PREFIX) || value === undefined) continue;
      const name = key.slice(PREFIX.length);
      if (!NAME.test(name)) {
        logger.warn(`Ignoring ${key}: secret names must be UPPER_SNAKE_CASE`);
        continue;
      }
      secrets.set(name, value);
    }
  }
  return secrets;
}

/** The test's `secrets`: values by name, read-only; JSON and inspect show only masks */
export function createSecretsFixture(
  environment: string,
  values: ReadonlyMap<string, string>,
): Readonly<Record<string, string>> {
  const masked = () => Object.fromEntries([...values.keys()].map((name) => [name, MASK]));
  // Not frozen: the get trap returns the real value, which a frozen target's invariants forbid
  const target: Record<string, string> = masked();
  Object.defineProperty(target, "toJSON", { value: masked, enumerable: false });
  Object.defineProperty(target, inspect.custom, { value: masked, enumerable: false });
  const readOnly = (): never => {
    throw new TypeError("secrets are read-only");
  };

  return new Proxy(target, {
    get(target, key, receiver) {
      if (isPassthroughKey(target, key)) return Reflect.get(target, key, receiver);
      const name = String(key);
      if (!NAME.test(name)) throw new Error(`Invalid secret name "${name}" (use UPPER_SNAKE_CASE)`);
      const value = values.get(name);
      if (value === undefined) throw new MissingSecretError(name, environment);
      return value;
    },
    set: readOnly,
    defineProperty: readOnly,
    deleteProperty: readOnly,
  });
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx tsx --test src/config/fixtures.test.ts`
Expected: PASS. If `inspect(secrets)` still shows a value, check that `util.inspect` inspects the Proxy's target (it does with the default `showProxy: false`) and that `inspect.custom` is defined on the target.

- [ ] **Step 6: Commit**

```bash
git add src/config/variables.ts src/config/secrets.ts src/config/fixtures.test.ts
git commit -m "feat(config): env and secrets fixtures

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Test registry with `describe`

**Files:**
- Modify: `src/types/test.d.ts`
- Create: `src/runner/registry.ts`
- Test: `src/runner/registry.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (types only).
- Produces:
  - In `src/types/test.d.ts`: `interface TestFixtures { page: Page; browser: Browser; env: Readonly<Record<string, string | number | boolean>>; secrets: Readonly<Record<string, string>> }`; `TestCaseBase.function: (fixtures: TestFixtures) => Promise<void>`; `RegisteredTestCase.titlePath: string[]`; `TestSummaryBase.environment: string`.
  - `describe(title: string, fn: () => void): void`
  - `test(title: string, fn: (fixtures: TestFixtures) => Promise<void>): void`
  - `registeredTests(): readonly RegisteredTestCase[]`
  - `clearRegistry(): void` (tests only)

- [ ] **Step 1: Update the test types**

In `src/types/test.d.ts`, replace the `RegisteredTestCase` and `TestCaseBase` interfaces with:
```ts
/** What a test function receives */
export interface TestFixtures {
  page: Page;
  browser: Browser;
  /** The chosen environment's variables; reading an unknown name throws */
  env: Readonly<Record<string, string | number | boolean>>;
  /** Secrets by name (SAMURAI_SECRET_<NAME>); reading an unset name throws */
  secrets: Readonly<Record<string, string>>;
}

export interface RegisteredTestCase extends TestCaseBase {
  /** Path of the spec file that registered the test */
  file: string;
  /** describe titles, then the test title */
  titlePath: string[];
}

export interface TestCaseBase {
  /** Full title: describe titles and the test title joined with " > " */
  name: string;
  function: (fixtures: TestFixtures) => Promise<void>;
}
```
and add to `TestSummaryBase`:
```ts
  /** The environment the run used */
  environment: string;
```

- [ ] **Step 2: Write the failing tests**

Create `src/runner/registry.test.ts`:
```ts
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  clearRegistry,
  describe as samuraiDescribe,
  registeredTests,
  test as samuraiTest,
} from "./registry.js";

afterEach(() => clearRegistry());

const noop = async () => {};

test("a test outside describe keeps its title", () => {
  samuraiTest("logs in", noop);
  const [registered] = registeredTests();
  assert.equal(registered?.name, "logs in");
  assert.deepEqual(registered?.titlePath, ["logs in"]);
  assert.equal(registered?.function, noop);
});

test("nested describe titles are joined with >", () => {
  samuraiDescribe("Checkout", () => {
    samuraiDescribe("Guest", () => {
      samuraiTest("applies coupon", noop);
    });
    samuraiTest("pays with saved card", noop);
  });
  samuraiTest("after", noop);
  assert.deepEqual(
    registeredTests().map((t) => t.name),
    ["Checkout > Guest > applies coupon", "Checkout > pays with saved card", "after"],
  );
});

test("the title stack is restored when a describe callback throws", () => {
  assert.throws(() =>
    samuraiDescribe("Broken", () => {
      throw new Error("boom");
    }),
  );
  samuraiTest("after", noop);
  assert.equal(registeredTests()[0]?.name, "after");
});

test("an async describe callback is rejected", () => {
  assert.throws(
    () => samuraiDescribe("Async", async () => {}),
    { message: "describe() callback must be synchronous; it only registers tests" },
  );
  samuraiTest("after", noop);
  assert.equal(registeredTests()[0]?.name, "after");
});

test("records the calling spec file", () => {
  samuraiTest("where", noop);
  assert.equal(registeredTests()[0]?.file, fileURLToPath(import.meta.url));
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `npx tsx --test src/runner/registry.test.ts`
Expected: FAIL — `Cannot find module './registry.js'`.

- [ ] **Step 4: Implement `src/runner/registry.ts`**

```ts
import { fileURLToPath } from "node:url";
import logger from "../logger/index.js";
import type { RegisteredTestCase, TestCaseBase } from "../types/test.js";

const registered: RegisteredTestCase[] = [];
/** Titles of the describe blocks being registered, outermost first */
const titleStack: string[] = [];

/** Groups the tests registered inside `fn` under `title`. `fn` runs immediately and must be synchronous. */
export function describe(title: string, fn: () => void): void {
  titleStack.push(title);
  try {
    const result: unknown = fn();
    if (result instanceof Promise) {
      result.catch(() => {});
      throw new Error("describe() callback must be synchronous; it only registers tests");
    }
  } finally {
    titleStack.pop();
  }
}

export function test(title: string, fn: TestCaseBase["function"]): void {
  const titlePath = [...titleStack, title];
  const name = titlePath.join(" > ");
  registered.push({ name, titlePath, function: fn, file: callerFile() });
  logger.debug("Registered test %s", name);
}

export function registeredTests(): readonly RegisteredTestCase[] {
  return registered;
}

/** Forgets every registered test (tests only) */
export function clearRegistry(): void {
  registered.length = 0;
  titleStack.length = 0;
}

/** File of the code that called test(): stack lines are Error, callerFile, test, caller */
function callerFile(): string {
  const caller = new Error().stack?.split("\n")[3] ?? "";
  const match = caller.match(/\((.+?):\d+:\d+\)$/) ?? caller.match(/at (.+?):\d+:\d+$/);
  const location = match?.[1] ?? "";
  return location.startsWith("file://") ? fileURLToPath(location) : location;
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx tsx --test src/runner/registry.test.ts`
Expected: PASS. If `records the calling spec file` fails, print `new Error().stack` inside `callerFile` once to confirm the frame index under tsx and fix the index, not the test.

- [ ] **Step 6: Commit**

`tsc` still reports the baseline `test-runner.ts` errors plus new ones where `test-runner.ts` uses the old `function` signature; Task 7 replaces that code.

```bash
git add src/types/test.d.ts src/runner/registry.ts src/runner/registry.test.ts
git commit -m "feat(runner): describe blocks and test registry

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Reporter keyed by file and title, masked, with environment

**Files:**
- Modify: `src/runner/reporter.ts`
- Test: `src/runner/reporter.test.ts`

**Interfaces:**
- Consumes: `RegisteredTestCase` (Task 4); `maskDeep` (Task 2).
- Produces: `new TestReporter({ environment: string; output?: string })`; `onTestStart(test: RegisteredTestCase)`; `onTestEnd(test: RegisteredTestCase, error?: TestError, logs?: { logs?: TestLogEntry[]; logsDropped?: number })`; `onStart()`; `onEnd(): Promise<void>` writing `output` (default `<cwd>/result/report.json`).

- [ ] **Step 1: Write the failing tests**

Create `src/runner/reporter.test.ts`:
```ts
import { after, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import TestReporter from "./reporter.js";
import { MASK, registerSecret, resetSecrets } from "../config/mask.js";
import type { RegisteredTestCase } from "../types/test.js";

const dir = mkdtempSync(path.join(tmpdir(), "samurai-reporter-"));
after(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => resetSecrets());

function testCase(file: string, name: string): RegisteredTestCase {
  return { file, name, titlePath: name.split(" > "), function: async () => {} };
}

async function report(run: (reporter: TestReporter) => void) {
  const output = path.join(dir, `${Math.random()}.json`);
  const reporter = new TestReporter({ environment: "staging", output });
  reporter.onStart();
  run(reporter);
  await reporter.onEnd();
  return JSON.parse(readFileSync(output, "utf8"));
}

test("records the environment", async () => {
  const summary = await report(() => {});
  assert.equal(summary.environment, "staging");
});

test("tests with the same title in different files are kept apart", async () => {
  const a = testCase("a.spec.ts", "Checkout > pays");
  const b = testCase("b.spec.ts", "Checkout > pays");
  const summary = await report((reporter) => {
    reporter.onTestStart(a);
    reporter.onTestStart(b);
    reporter.onTestEnd(a);
    reporter.onTestEnd(b, { message: "boom", type: "error" });
  });
  assert.deepEqual(
    summary.tests.map((t: { file: string; name: string; status: string }) => [t.file, t.name, t.status]),
    [
      ["a.spec.ts", "Checkout > pays", "success"],
      ["b.spec.ts", "Checkout > pays", "failed"],
    ],
  );
});

test("masks secrets in errors and logs", async () => {
  registerSecret("TEST_CARD", "4242424242424242");
  const t = testCase("a.spec.ts", "pays");
  const summary = await report((reporter) => {
    reporter.onTestStart(t);
    reporter.onTestEnd(
      t,
      {
        message: 'expected "4242424242424242"',
        type: "assertion",
        stack: "AssertionError: expected 4242424242424242\n    at x",
        expected: "4242424242424242",
        actual: "4242",
      },
      { logs: [{ level: "info", type: "console", text: "card 4242424242424242", timestamp: 1 }] },
    );
  });
  const [result] = summary.tests;
  assert.equal(result.message, `expected "${MASK}"`);
  assert.equal(result.expected, MASK);
  assert.equal(result.actual, "4242");
  assert.doesNotMatch(result.stack, /4242424242424242/);
  assert.equal(result.logs[0].text, `card ${MASK}`);
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx tsx --test src/runner/reporter.test.ts`
Expected: FAIL — `environment` missing / the second test overwrites the first / values not masked.

- [ ] **Step 3: Update `src/runner/reporter.ts`**

Replace the import block and the class with:
```ts
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { maskDeep } from "../config/mask.js";
import type {
  PartialTestResult,
  RegisteredTestCase,
  TestError,
  TestLogEntry,
  TestResult,
  TestSummary,
} from "../types/test.js";

export interface ReporterOptions {
  /** The environment the run uses, recorded in the report */
  environment: string;
  /** Where the report is written. @default <cwd>/result/report.json */
  output?: string;
}

/** Results are keyed by file and full title, so equal titles in different files or describe blocks stay apart */
function keyOf(test: RegisteredTestCase): string {
  return `${test.file}::${test.name}`;
}

export default class TestReporter {
  private testResults: Map<string, TestResult> = new Map();
  private summary: TestSummary | undefined;
  private environment: string;
  private output: string;

  constructor(options: ReporterOptions) {
    this.environment = options.environment;
    this.output = options.output ?? path.join(process.cwd(), "result/report.json");
  }

  public onStart() {
    const t = performance.mark(`group-start`);
    this.summary = {
      duration: 0,
      status: "failed",
      startTime: t.startTime,
      environment: this.environment,
      tests: [],
    };
  }

  public async onEnd() {
    performance.mark(`group-finish`);
    const duration = performance.measure(
      "test-duration",
      `group-start`,
      `group-finish`,
    ).duration;

    this.summary = {
      ...this.summary,
      duration,
      environment: this.environment,
      tests: Array.from(this.testResults.values()),
      status: Array.from(this.testResults.values()).every(
        (r: TestResult) => r.status === "success",
      )
        ? "success"
        : "failed",
    } as TestSummary;

    await mkdir(path.dirname(this.output), { recursive: true });
    await writeFile(this.output, JSON.stringify(this.summary, null, 2), {
      encoding: "utf8",
    });
  }

  public onTestStart(test: RegisteredTestCase) {
    const key = keyOf(test);
    const t = performance.mark(`${key}-start`);
    this.testResults.set(key, {
      name: test.name,
      file: test.file,
      status: "started",
      startTime: t.startTime,
    });
  }

  public onTestEnd(
    test: RegisteredTestCase,
    error?: TestError,
    logs?: { logs?: TestLogEntry[]; logsDropped?: number },
  ) {
    const key = keyOf(test);
    performance.mark(`${key}-finish`);
    const duration = performance.measure(
      "test-duration",
      `${key}-start`,
      `${key}-finish`,
    ).duration;

    this.testResults.set(
      key,
      maskDeep({
        ...(this.testResults.get(key) as PartialTestResult),
        duration,
        status: error ? "failed" : "success",
        ...(error ? error : undefined),
        ...(logs?.logs && { logs: logs.logs }),
        ...(logs?.logsDropped && { logsDropped: logs.logsDropped }),
      } as TestResult),
    );
  }
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx tsx --test src/runner/reporter.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runner/reporter.ts src/runner/reporter.test.ts
git commit -m "feat(runner): report keyed by file and title, masked, with environment

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `page.goto` with base URL

**Files:**
- Modify: `src/browser/page.ts`
- Modify: `src/browser/page.test.ts`
- Create: `src/browser/goto.browser-test.ts`

**Interfaces:**
- Consumes: `peekRunSettings`, `setRunSettings`, `resolveRunSettings` (Task 1).
- Produces: `Page.goto(url: string, options?: NavigateOptions): Promise<{ navigation: string | null; url: string }>`; `Page.setBaseURL(url: string | undefined): void`.

- [ ] **Step 1: Write the failing unit tests**

Add to the imports of `src/browser/page.test.ts`:
```ts
import { resolveRunSettings, setRunSettings } from "../config/run-settings.js";
```
and append:
```ts
describe("Page.goto", () => {
  const urls = (sent: Array<{ params: unknown }>) => sent.map(({ params }) => (params as { url: string }).url);

  test("resolves relative URLs against the page's base URL", async () => {
    const { connector, sent } = stubConnector({ type: "undefined" });
    const page = new Page(connector, "ctx");
    page.setBaseURL("https://staging.harbor.shop/shop/");
    await page.goto("/products");
    await page.goto("./cart");
    await page.goto("../account");
    assert.deepEqual(urls(sent), [
      "https://staging.harbor.shop/products",
      "https://staging.harbor.shop/shop/cart",
      "https://staging.harbor.shop/account",
    ]);
  });

  test("keeps absolute URLs and bare hosts like navigateTo", async () => {
    const { connector, sent } = stubConnector({ type: "undefined" });
    const page = new Page(connector, "ctx");
    page.setBaseURL("https://staging.harbor.shop");
    await page.goto("https://other.test/x");
    await page.goto("itmetsam.nl");
    assert.deepEqual(urls(sent), ["https://other.test/x", "https://itmetsam.nl"]);
  });

  test("uses the active run's base URL when the page has none", async () => {
    setRunSettings(resolveRunSettings({ baseURL: "https://harbor.shop" }));
    try {
      const { connector, sent } = stubConnector({ type: "undefined" });
      await new Page(connector, "ctx").goto("/login");
      assert.deepEqual(urls(sent), ["https://harbor.shop/login"]);
    } finally {
      setRunSettings(undefined);
    }
  });

  test("a relative URL without a base URL throws", async () => {
    const { connector, sent } = stubConnector({ type: "undefined" });
    await assert.rejects(new Page(connector, "ctx").goto("/products"), {
      message: 'page.goto("/products") needs a baseURL; set one in samurai.config.ts or the environment',
    });
    assert.equal(sent.length, 0);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx tsx --test src/browser/page.test.ts`
Expected: FAIL — `page.setBaseURL is not a function`.

- [ ] **Step 3: Implement in `src/browser/page.ts`**

Add the import next to the other config import:
```ts
import { peekRunSettings } from "../config/run-settings.js";
```
Add a field after `private lastNavigation: string | undefined;`:
```ts
  /** Base for relative page.goto URLs; falls back to the active run's baseURL */
  private baseURL: string | undefined;
```
Add these methods directly above `public async navigateTo(`:
```ts
  /** Sets the base that relative `goto` URLs resolve against; `undefined` falls back to the run's baseURL */
  public setBaseURL(url: string | undefined): void {
    this.baseURL = url;
  }

  /**
   * Navigates like `navigateTo`, but a URL starting with "/", "./" or "../" resolves against the base URL
   * (`setBaseURL`, else the environment's `baseURL`).
   * @example
   *  await page.goto("/products");
   *  await page.goto("https://example.com", { wait: "interactive" });
   */
  public async goto(
    url: string,
    options?: NavigateOptions,
  ): Promise<{ navigation: string | null; url: string }> {
    if (!/^\.{0,2}\//.test(url)) return this.navigateTo(url, options);
    const base = this.baseURL ?? peekRunSettings()?.baseURL;
    if (!base) {
      throw new Error(`page.goto("${url}") needs a baseURL; set one in samurai.config.ts or the environment`);
    }
    return this.navigateTo(new URL(url, base).href, options);
  }
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx tsx --test src/browser/page.test.ts`
Expected: PASS, including the existing `navigateTo` tests.

- [ ] **Step 5: Write the browser test**

Create `src/browser/goto.browser-test.ts`:
```ts
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { after, before, test } from "node:test";
import { Browser } from "./browser.js";
import type Page from "./page.js";

let browser: Browser;
let page: Page;
let server: Server;
let base: string;
const sockets = new Set<Socket>();

before(async () => {
  server = createServer((req, res) => {
    res.setHeader("content-type", "text/html").end(`<!doctype html><title>${req.url}</title>`);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  ({ browser, page } = await Browser.launch("firefox", { port: 9251, headless: true }));
});

after(async () => {
  await page.dispose();
  await browser?.close();
  sockets.forEach((socket) => socket.destroy());
  await new Promise((resolve) => server.close(resolve));
});

test("goto resolves a path against the base URL", { timeout: 40000 }, async () => {
  page.setBaseURL(`${base}/shop/`);
  await page.goto("/products?id=1");
  assert.equal(await page.url(), `${base}/products?id=1`);
  assert.equal(await page.title(), "/products?id=1");
  await page.goto("./cart");
  assert.equal(await page.url(), `${base}/shop/cart`);
});
```

- [ ] **Step 6: Run the browser test**

Run: `npx tsx --test src/browser/goto.browser-test.ts`
Expected: PASS (needs the local Firefox in `browsers/`, as the other browser tests do).

- [ ] **Step 7: Commit**

```bash
git add src/browser/page.ts src/browser/page.test.ts src/browser/goto.browser-test.ts
git commit -m "feat(page): goto resolves paths against the base URL

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Wire the run: prepare, runner, CLI, public API

**Files:**
- Create: `src/runner/prepare-run.ts`
- Test: `src/runner/prepare-run.test.ts`
- Modify: `src/runner/test-runner.ts`
- Modify: `src/wait/wait-until.ts`, `src/wait/wait-until.test.ts`
- Modify: `src/index.ts`
- Create: `src/api.ts`
- Modify: `package.json`, `.gitignore`, `src/tests/index.spec.ts`
- Create: `.env.example`

**Interfaces:**
- Consumes: everything above — `resolveRunSettings`, `setRunSettings`, `peekRunSettings`, `parseRunOverrides`, `RunOverrides`, `RunSettings` (Task 1); `registerSecret`, `isShortSecret` (Task 2); `loadSecrets`, `createSecretsFixture`, `createEnvFixture` (Task 3); `registeredTests`, `describe`, `test` (Task 4); `TestReporter` options (Task 5); `loadConfig` (Task 1).
- Produces:
  - `interface PreparedRun { settings: RunSettings; secrets: ReadonlyMap<string, string> }`
  - `prepareRun(config: SamuraiTestConfig, overrides: RunOverrides, options?: { cwd?: string; env?: NodeJS.ProcessEnv }): PreparedRun`
  - `TestRunner.init(run: PreparedRun, group?: SamuraiGroup)`
  - Public module `src/api.ts` (`test`, `describe`, `expect`, `defineConfig`, type `TestFixtures`)

- [ ] **Step 1: Write the failing tests**

Create `src/runner/prepare-run.test.ts`:
```ts
import { after, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { prepareRun } from "./prepare-run.js";
import { peekRunSettings, setRunSettings } from "../config/run-settings.js";
import { MASK, maskText, resetSecrets } from "../config/mask.js";

const dir = mkdtempSync(path.join(tmpdir(), "samurai-run-"));
writeFileSync(path.join(dir, ".env.staging"), "SAMURAI_SECRET_TEST_CARD=4242424242424242\n");
after(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => {
  setRunSettings(undefined);
  resetSecrets();
});

test("resolves settings, loads secrets for that environment and activates the run", () => {
  const run = prepareRun(
    { environments: { dev: {}, staging: { baseURL: "https://staging.harbor.shop" } } },
    { environment: "staging" },
    { cwd: dir, env: { SAMURAI_SECRET_PIN: "12" } },
  );
  assert.equal(run.settings.environment, "staging");
  assert.equal(peekRunSettings(), run.settings);
  assert.deepEqual(Object.fromEntries(run.secrets), { TEST_CARD: "4242424242424242", PIN: "12" });
  assert.equal(maskText("card 4242424242424242 pin 12"), `card ${MASK} pin ${MASK}`);
});

test("an unknown environment fails before anything is activated", () => {
  assert.throws(() => prepareRun({ environments: { dev: {} } }, { environment: "stg" }, { cwd: dir, env: {} }));
  assert.equal(peekRunSettings(), undefined);
});
```

Append to `src/wait/wait-until.test.ts` (add `setRunSettings`, `resolveRunSettings` to a new import from `"../config/run-settings.js"`):
```ts
test("resolveTimeout uses the active run's expect timeout", async () => {
  setRunSettings(resolveRunSettings({}, { expectTimeout: 1234 }));
  try {
    assert.equal(await resolveTimeout(), 1234);
    assert.equal(await resolveTimeout(10), 10);
  } finally {
    setRunSettings(undefined);
  }
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx tsx --test src/runner/prepare-run.test.ts src/wait/wait-until.test.ts`
Expected: FAIL — `Cannot find module './prepare-run.js'`, and `resolveTimeout` returns the config value instead of `1234`.

- [ ] **Step 3: Implement `src/runner/prepare-run.ts`**

```ts
import { isShortSecret, registerSecret } from "../config/mask.js";
import {
  resolveRunSettings,
  setRunSettings,
  type RunOverrides,
  type RunSettings,
} from "../config/run-settings.js";
import { loadSecrets } from "../config/secrets.js";
import logger from "../logger/index.js";
import type { SamuraiTestConfig } from "../types/config.js";

export interface PreparedRun {
  settings: RunSettings;
  secrets: ReadonlyMap<string, string>;
}

/**
 * Starts a run: picks the environment, loads its secrets and registers every value for masking
 * (all of them, not only the ones a test reads), then makes the settings active.
 */
export function prepareRun(
  config: SamuraiTestConfig,
  overrides: RunOverrides,
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): PreparedRun {
  const settings = resolveRunSettings(config, overrides);
  const secrets = loadSecrets(settings.environment, options);
  for (const [name, value] of secrets) {
    registerSecret(name, value);
    if (isShortSecret(value)) {
      logger.warn(`Secret "${name}" is short; masking it may hide unrelated text in logs`);
    }
  }
  setRunSettings(settings);
  return { settings, secrets };
}
```

- [ ] **Step 4: Update `resolveTimeout` in `src/wait/wait-until.ts`**

Add `import { peekRunSettings } from "../config/run-settings.js";` and replace `resolveTimeout` with:
```ts
/** Per-call timeout, else the active run's expect timeout, else config `expect.timeout`, else 5000 */
export async function resolveTimeout(perCall?: number): Promise<number> {
  if (perCall !== undefined) return perCall;
  const run = peekRunSettings();
  if (run) return run.expectTimeout;
  return (await readConfig("expect"))?.timeout ?? DEFAULT_TIMEOUT;
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx tsx --test src/runner/prepare-run.test.ts src/wait/wait-until.test.ts`
Expected: PASS.

- [ ] **Step 6: Update `src/runner/test-runner.ts`**

1. Imports: remove `import type { RegisteredTestCase, TestResult } from "../types/test.js";` and add:
   ```ts
   import type { RegisteredTestCase, TestFixtures } from "../types/test.js";
   import { registeredTests } from "./registry.js";
   import type { PreparedRun } from "./prepare-run.js";
   import { createEnvFixture } from "../config/variables.js";
   import { createSecretsFixture } from "../config/secrets.js";
   ```
   (Keep the other imports; drop `TestResult` only if nothing else uses it — `tsc` will tell you.)
2. Delete `const registeredTestcases: RegisteredTestCase[] = [];` and the whole `export function test(...)` at the bottom. Add at the bottom instead:
   ```ts
   export { describe, test } from "./registry.js";
   ```
3. Class fields and constructor:
   ```ts
   export default class TestRunner {
     private testFiles: string[];
     private run: PreparedRun;
     private group?: SamuraiGroup;

     constructor(testFiles: string[], run: PreparedRun, group?: SamuraiGroup) {
       this.testFiles = testFiles;
       this.run = run;
       this.group = group;
     }
   ```
   and rename the existing `public async run()` method to `public async start()` (the field `run` now holds the prepared run).
4. `init`: change the signature to `static async init(run: PreparedRun, group?: SamuraiGroup)`, change `srcDir = await readConfig("srcDir");` to `srcDir = (await readConfig("srcDir")) ?? "./src";`, and return `new TestRunner(testFiles, run, group)`.
5. `start()`: replace `const reporter = new TestReporter();` with
   ```ts
   const reporter = new TestReporter({ environment: this.run.settings.environment });
   ```
   replace `path.resolve(await readConfig("srcDir"), file)` with `path.resolve((await readConfig("srcDir")) ?? "./src", file)`, and replace the loop over `registeredTestcases` with:
   ```ts
   for (const test of registeredTests()) {
     await this.executeTestCase(test, reporter);
   }
   ```
6. `executeTestCase`: replace the browser selection and timeout lines (from `let selectedBrowser` through `const timeout = Number(await readConfig("timeout"));`) with:
   ```ts
   const selectedBrowser: SupportedBrowser = (await readConfig("browser")) ?? "firefox";
   const { settings, secrets } = this.run;
   const timeout = settings.timeout;
   ```
   In the timeout timer, replace `(timeout || 30000) / 1000` with `timeout / 1000` and `isNaN(timeout) ? 30000 : timeout` with `timeout`. Replace `await test?.function(launched.page, launched.browser);` with:
   ```ts
   const fixtures: TestFixtures = {
     page: launched.page,
     browser: launched.browser,
     env: createEnvFixture(settings.environment, settings.variables),
     secrets: createSecretsFixture(settings.environment, secrets),
   };
   await test.function(fixtures);
   ```
   (`group.browser` no longer exists on `SamuraiGroup`; removing that branch is what fixes the baseline tsc errors.)

- [ ] **Step 7: Update `src/index.ts`**

```ts
import { loadConfig } from "./config/config.js";
import { parseRunOverrides } from "./config/run-settings.js";
import { prepareRun } from "./runner/prepare-run.js";
import TestRunner from "./runner/test-runner.js";

const run = prepareRun(await loadConfig(), parseRunOverrides(process.argv.slice(2), process.env));
const runner = await TestRunner.init(run);
await runner.start();

process.exit();
```

- [ ] **Step 8: Public API, package exports, example test, hygiene**

Create `src/api.ts`:
```ts
export { test, describe } from "./runner/registry.js";
export { expect } from "./assert/expect.js";
export { defineConfig } from "./config/config.js";
export type { TestFixtures } from "./types/test.js";
```

In `package.json`, add after `"main"`:
```json
  "exports": {
    ".": "./src/api.ts"
  },
```

In `src/tests/index.spec.ts`, replace the two imports and the test line with:
```ts
import { expect, test } from "../api.js";

test("My first test", async ({ page }) => {
  await page.goto("https://itmetsam.nl");
```
(the rest of the body is unchanged).

Append to `.gitignore`:
```
.env
.env.*
!.env.example
```

Create `.env.example`:
```
# Copy to .env.<environment>, e.g. .env.staging. Never commit real values.
# Tests read these as secrets.TEST_CARD; real environment variables win over this file.
SAMURAI_SECRET_TEST_CARD=
```

- [ ] **Step 9: Verify the package entry point**

Run: `npx tsx -e "import('samurai-framework').then((m) => console.log(Object.keys(m).sort().join(',')))"`
Expected: `defineConfig,describe,expect,test`

- [ ] **Step 10: Typecheck and run every unit test**

Run: `npx tsc --noEmit -p .`
Expected: no errors at all.

Run: `npm test`
Expected: PASS, 0 failures.

- [ ] **Step 11: Run the browser tests**

Run: `npm run test:browser`
Expected: PASS (they use `navigateTo` and `Page` directly, not the runner, so behaviour is unchanged).

- [ ] **Step 12: Commit**

```bash
git add src/runner/prepare-run.ts src/runner/prepare-run.test.ts src/runner/test-runner.ts \
  src/wait/wait-until.ts src/wait/wait-until.test.ts src/index.ts src/api.ts package.json \
  .gitignore .env.example src/tests/index.spec.ts
git commit -m "feat(runner): fixtures, environments and secrets in test runs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 13: Update the roadmap**

In `docs/superpowers/recorder-roadmap.md`, tick item 1 (`- [x] **1. Test API alignment**`) and add ` — [spec](specs/2026-10-01-test-api-alignment-design.md)` at the end of its line. Set the spec's `Status:` line to `implemented`.

```bash
git add docs/superpowers/recorder-roadmap.md docs/superpowers/specs/2026-10-01-test-api-alignment-design.md
git commit -m "docs: mark test API alignment implemented

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Do **not** run `npm run dev` to try the example test without asking the user first: it submits a real contact form.
