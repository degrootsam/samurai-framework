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
    const secrets = loadSecrets("staging", { cwd: dir, env: {} as unknown as NodeJS.ProcessEnv });
    assert.deepEqual(Object.fromEntries(secrets), {
      TEST_CARD: "4242424242424242",
      CUSTOMER_PW: "pa ss # word",
      FROM_FILE: "file",
    });
  });

  test("env vars beat the file and non-prefixed keys are ignored", () => {
    const secrets = loadSecrets("staging", {
      cwd: dir,
      env: { SAMURAI_SECRET_FROM_FILE: "env", SAMURAI_SECRET_ONLY_ENV: "x", PATH: "/bin" } as unknown as NodeJS.ProcessEnv,
    });
    assert.equal(secrets.get("FROM_FILE"), "env");
    assert.equal(secrets.get("ONLY_ENV"), "x");
    assert.equal(secrets.has("PATH"), false);
  });

  test("an empty value counts as unset and does not override a file value", () => {
    const empty = mkdtempSync(path.join(tmpdir(), "samurai-secrets-empty-"));
    try {
      writeFileSync(path.join(empty, ".env.staging"), "SAMURAI_SECRET_A=\nSAMURAI_SECRET_B=fromfile\nSAMURAI_SECRET_C=\n");
      const secrets = loadSecrets("staging", {
        cwd: empty,
        env: { SAMURAI_SECRET_B: "", SAMURAI_SECRET_C: "fromenv" } as unknown as NodeJS.ProcessEnv,
      });
      assert.deepEqual(Object.fromEntries(secrets), { B: "fromfile", C: "fromenv" });
      assert.equal(secrets.has("A"), false);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  test("a missing file is fine", () => {
    assert.deepEqual(Object.fromEntries(loadSecrets("dev", { cwd: dir, env: { SAMURAI_SECRET_A: "1" } as unknown as NodeJS.ProcessEnv })), { A: "1" });
  });

  test("names that are not UPPER_SNAKE_CASE are skipped", () => {
    assert.equal(loadSecrets("dev", { cwd: dir, env: { SAMURAI_SECRET_lower: "x" } as unknown as NodeJS.ProcessEnv }).size, 0);
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
