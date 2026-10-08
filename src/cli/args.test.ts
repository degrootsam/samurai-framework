import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  parseCommandLine,
  parseRunnerFlags,
  parseRunOverrides,
} from "./args.js";

describe("parseRunOverrides", () => {
  test("reads --env, --timeout and --expect-timeout", () => {
    assert.deepEqual(
      parseRunOverrides([
        "--env",
        "dev",
        "--timeout",
        "1000",
        "--expect-timeout=200",
      ]),
      {
        environment: "dev",
        timeout: 1000,
        expectTimeout: 200,
      },
    );
  });

  test("falls back to SAMURAI_ENV", () => {
    assert.deepEqual(parseRunOverrides([], { SAMURAI_ENV: "staging" }), {
      environment: "staging",
    });
    assert.deepEqual(
      parseRunOverrides(["--env", "dev"], { SAMURAI_ENV: "staging" }),
      { environment: "dev" },
    );
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
    assert.throws(
      () => parseRunOverrides(["--timeout=-5"]),
      /--timeout must be a whole number/,
    );
    assert.throws(
      () => parseRunOverrides(["--expect-timeout", ""]),
      /--expect-timeout must be a whole number/,
    );
  });
});

describe("parseRunnerFlags", () => {
  test("reads headless, port, grep and repeated files", () => {
    assert.deepEqual(
      parseRunnerFlags([
        "--headless",
        "--port",
        "9300",
        "--grep",
        "login",
        "--group",
        "smoke",
        "--file",
        "a.spec.ts",
        "--file",
        "b.spec.ts",
      ]),
      {
        headless: true,
        port: 9300,
        grep: "login",
        group: "smoke",
        files: ["a.spec.ts", "b.spec.ts"],
      },
    );
    assert.deepEqual(parseRunnerFlags([]), {});
  });

  test("rejects a port that is not a port number", () => {
    assert.throws(() => parseRunnerFlags(["--port", "0"]), /--port/);
    assert.throws(() => parseRunnerFlags(["--port", "abc"]), /--port/);
  });

  test("the run overrides parser accepts the runner flags", () => {
    assert.deepEqual(
      parseRunOverrides(["--headless", "--env", "dev", "--grep", "x"], {}),
      { environment: "dev" },
    );
  });
});

describe("--headless and --no-headless", () => {
  test("say which, and leave it unset when neither is given", () => {
    assert.deepEqual(parseRunnerFlags(["--headless"]), { headless: true });
    assert.deepEqual(parseRunnerFlags(["--no-headless"]), { headless: false });
    assert.deepEqual(parseRunnerFlags([]), {});
  });
});

describe("flow flags", () => {
  test("reads the subcommand, flows, --all and --allow-unsupported", () => {
    const { values, positionals } = parseCommandLine([
      "run",
      "checkout",
      "other.flow.json",
      "--all",
      "--allow-unsupported",
      "--no-headless",
    ]);
    assert.deepEqual(positionals, ["run", "checkout", "other.flow.json"]);
    assert.equal(values.all, true);
    assert.equal(values["allow-unsupported"], true);
    assert.equal(values.headless, false);
  });

  test("an unknown flag is still an error", () => {
    assert.throws(() => parseCommandLine(["run", "--allow-unsupportd"]));
  });
});
