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
