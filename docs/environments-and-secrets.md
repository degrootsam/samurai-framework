# Environments and secrets

One spec runs against several targets (local, staging, production) by choosing an environment when you start the run.

## Environments

Declare them in `samurai.config.ts`:

```ts
export default defineConfig({
  baseURL: "https://example.com",
  timeout: 30000,
  environments: {
    dev: {
      baseURL: "http://localhost:3000",
      variables: {
        testUser: "dev@example.com",
        pageSize: 5,
        betaFeatures: true,
      },
    },
    staging: {
      baseURL: "https://staging.example.com",
      timeout: 60000,
      expect: { timeout: 10000 },
      variables: {
        testUser: "qa@example.com",
        pageSize: 20,
        betaFeatures: false,
      },
    },
  },
  defaultEnvironment: "dev",
});
```

```sh
bun run dev                 # dev
bun run dev --env staging   # staging
SAMURAI_ENV=staging bun run dev
```

The chosen environment's name is recorded in `result/report.json`. How the environment is picked, and how timeouts and `baseURL` are combined, is in [Configuration](configuration.md#precedence).

## Variables

`variables` hold **test data** that differs per environment: account names, page sizes, feature flags. Values are strings, numbers or booleans. In a test they are on the read-only `env` fixture:

```ts
test("search", async ({ page, env }) => {
  await page.goto("/search");
  await page.getByLabel("Account").fill(String(env.testUser));
  await expect(page.getByCss("li.result")).toHaveCount(Number(env.pageSize));
});
```

Reading a name that isn't defined for the environment throws `Variable "x" is not defined in environment "staging"`, so a typo or a missing value fails loudly instead of testing the wrong thing. `env` is frozen.

**Never put secrets in `variables`.** They are not masked.

## Secrets

Secrets are credentials and tokens. They come from, in order of priority:

1. **Real environment variables** named `SAMURAI_SECRET_<NAME>`
2. **`.env.<environment>`** in the working directory, same variable names

```sh
# .env.staging  (git-ignored)
SAMURAI_SECRET_ADMIN_PASSWORD=correct-horse
SAMURAI_SECRET_API_TOKEN=abc123
```

```ts
test("admin login", async ({ page, secrets }) => {
  await page.getByLabel("Password").fill(secrets.ADMIN_PASSWORD!);
});
```

- Names are `UPPER_SNAKE_CASE`. A `SAMURAI_SECRET_` variable with another name is ignored with a warning, and asking for an invalid name throws.
- An empty value counts as unset.
- Reading a secret that isn't set throws `Secret "ADMIN_PASSWORD" is not set (expected env var SAMURAI_SECRET_ADMIN_PASSWORD or .env.staging)`.
- `secrets` is read-only. Printing or serialising it (`console.log(secrets)`, `JSON.stringify(secrets)`) shows `••••` for every value; only reading a property gives the real value.
- `.env` and `.env.*` are git-ignored; commit only `.env.example`.

In CI, set the secrets as repository or environment secrets and expose them as `SAMURAI_SECRET_*` environment variables.

## Masking

When a run starts, **every** secret of the environment is registered for masking, not only the ones a test reads. From then on, wherever the framework writes text it replaces the value with `••••`:

- framework logs (console and `logs/*.log`)
- `result/report.json`: error messages, stacks, expected and actual values, page log entries

Matching also covers the JSON-escaped, `util.inspect`-escaped and URL-encoded spellings of a value, and longer secrets are replaced before shorter ones they contain. A secret shorter than 4 characters only matches as a whole word and gives a warning, because masking `1` would otherwise hide every digit.

Not masked yet: screenshots, videos, traces and anything the page itself displays. A password that is visible on screen appears in a screenshot. See the [roadmap](roadmap.md).
