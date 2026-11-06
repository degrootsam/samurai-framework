# SAMURAI for coding agents

A short guide for an AI coding agent that writes or runs tests with `@itmetsam/samurai-framework`. It describes what the package does today; the full guides are in the [wiki](https://github.com/degrootsam/samurai-framework/wiki).

## The project

- A project has `samurai.config.ts` (environments, base URL, groups), specs under its `srcDir` (`*.spec.ts`), and `.env.<environment>` files for secrets. Run every command in the project folder.
- A spec is a normal TypeScript file:

```ts
import { expect, test } from "@itmetsam/samurai-framework";

test("signs in", async ({ page, secrets }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("ann@example.com");
  await page.getByLabel("Password").fill(secrets.PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});
```

- Fixtures are `page`, `browser`, `browserName`, `env` (variables of the environment) and `secrets` (names are `UPPER_SNAKE_CASE`; set as `SAMURAI_SECRET_<NAME>` or in `.env.<environment>`). Never write a secret value into a spec.

## Writing steps the editor can read

A spec made of these statements can be read and edited by SAMURAI's step codec (anything else is kept as a `custom` step): `page.goto`, `click`, `fill`, `press`, `check`, `uncheck`, `selectOption`, `hover`, `dblclick`, `clear`, `setInputFiles`, `dropFiles`, `expect(...)` with the common matchers, `expect(page).toHaveURL` / `toHaveTitle`, `outputs.save`, `waitForNetworkIdle`, `waitForTimeout`, `page.screenshot({ name })`. Locators are chains of `getByRole`, `getByLabel`, `getByText`, `getByPlaceholder`, `getByAltText`, `getByTitle`, `getByTestId`, `getByCss` and `locator(xpath)`, with `nth`, `first`, `last` and `filter`. Prefer, in this order: test id, role and name, label, text, then CSS. Wiki: Steps and the recorder, Locators, Assertions.

## Commands

| Command                                                     | Does                                                                                |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `samurai list --json`                                       | An array of `{ "name", "file" }` (plus `"modifier"`, `"reason"`); no browser starts |
| `samurai run --json`                                        | JSON lines, one event per line, while the tests run                                 |
| `samurai run --file tests/login.spec.ts --env staging`      | Run one spec in one environment (`--grep`, `--group`, `--browser` also select)      |
| `samurai record <spec> --new "title" --json`                | Open a browser and record into a spec; one JSON event per step                      |
| `samurai flow list` / `check` / `run <flow>` (all `--json`) | Flows: graphs of tests                                                              |
| `samurai browsers install all`                              | Download the pinned Firefox and Chrome                                              |

Exit codes: `0` everything passed, `1` a test failed (or a run ended early), `2` a usage or configuration error. A failing run prints what failed; fix the cause, then run that one spec again.

## Reading results

`samurai run` writes `result/report.json` and prints the same events with `--json` (`run-start`, `test-start`, `test-end` with a `result`, `run-end` with a `summary`). A test result has a `status` (`success`, `failed` or `skipped`), a `duration` and, for a failure, a flat `type` (`error`, `assertion` or `timeout`), `message` and `stack`; a test that passed on a retry is marked `flaky`. Secrets are masked in everything written.

## Rules of thumb

- Open pages with a path (`page.goto("/login")`); the base URL comes from the environment.
- Assertions retry on their own; do not add fixed waits. Use `waitForNetworkIdle` only when nothing on the page can be asserted.
- Keep tests short and independent; share setup with fixtures, not with the order of tests.
- Run `samurai list` after writing a spec to see that it was read, then run it.
