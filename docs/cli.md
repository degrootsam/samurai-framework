# Command line

The package installs a `samurai` command. Run it in the project folder, the one holding `samurai.config.ts`.

```sh
samurai init [folder]     # scaffold a project
samurai list              # list the tests without running them
samurai record <spec>     # open a browser and record what you do into a spec
samurai run               # run the tests (the default: `samurai` alone does the same)
```

Spec files are TypeScript; the command loads them with [`tsx`](https://tsx.is), an optional peer dependency of the package. Install it next to the framework (`npm install --save-dev tsx`); `samurai init` adds it to the project it creates. Without it the command stops with a message that says so. In the framework's own repository, `bun run dev` does the same as `samurai run` without needing a build.

## `samurai run`

```sh
samurai run --env staging --headless --grep coupon
```

| Option                        | Meaning                                                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `--env <name>`                | Environment to run against (or `SAMURAI_ENV`)                                                                                              |
| `--file <spec>`               | Only this spec file, relative to the working directory. Repeatable                                                                         |
| `--group <name>`              | Only the tests of this entry of the config's `groups`; an unknown name is an error listing the groups. Combines with `--file` and `--grep` |
| `--grep <text>`               | Only tests whose full name (`describe` titles and test title) contains the text                                                            |
| `--timeout <ms>`              | Time one test may take                                                                                                                     |
| `--expect-timeout <ms>`       | Time actions and assertions retry                                                                                                          |
| `--headless`, `--no-headless` | Run the browser without a window, or with one. Default: [`use.headless`](configuration.md#headless), else headless when `CI` is set        |
| `--port <n>`                  | The browser's debugging port (default 9223)                                                                                                |
| `--json`                      | JSON lines on stdout instead of the human output (below)                                                                                   |

Output:

```text
Running 3 tests against staging
  ✔ Checkout > applies a coupon (2.2s)
  ✖ Checkout > rejects an expired coupon (5.0s)
  ✔ Checkout > guest can pay (3.1s)

Checkout > rejects an expired coupon
    expect(locator).toHaveText
      locator: testid="coupon-error"
      expected: "Coupon expired"
      received: ""
    /work/shop/tests/checkout.spec.ts

1 failed, 2 passed (10.3s)
```

Colour is used when stdout is a terminal (and `NO_COLOR` is not set). The report is still written to `result/report.json`.

### Exit codes

| Code | Meaning                                          |
| ---- | ------------------------------------------------ |
| 0    | Every selected test passed                       |
| 1    | A test failed, timed out or the run aborted      |
| 2    | Usage or configuration error (message on stderr) |

### `--json`

One JSON object per line on stdout, the same events `runTests` gives to `onEvent`:

```json
{"type":"run-start","environment":"staging","total":2}
{"type":"test-start","name":"Checkout > applies a coupon","file":"/work/shop/tests/checkout.spec.ts"}
{"type":"test-end","name":"Checkout > applies a coupon","file":"…","result":{"status":"success","duration":2210.8,"…":"…"}}
{"type":"run-end","summary":{"status":"success","environment":"staging","tests":["…"]}}
```

stdout carries only these lines; framework logging goes to stderr. That makes the command a simple way for another program to run tests and follow them live.

## `samurai list`

Imports the specs and prints the tests that `--env`, `--file`, `--grep` and `--group` select, without launching a browser. `--json` prints an array of `{ "name", "file" }`.

## `samurai record <spec>`

Opens a browser window on your environment's `baseURL`, and writes what you do into a spec file, step by step, as you do it. Stop with Ctrl+C or by closing the window.

```sh
samurai record tests/login.spec.ts --new "signs in" --env staging
```

```text
  + await page.goto("/login");
Recording. Alt+click an element to assert on it. Press Ctrl+C or close the window to stop.
  + await page.getByRole("textbox", { name: "Email" }).withFallbacks(page.getByLabel("Email"), page.getByCss("#email")).fill("sam@example.com");
  ~ await page.getByRole("textbox", { name: "Email" }).withFallbacks(...).fill("sam@example.com!");
  + await page.getByRole("button", { name: "Sign in" }).click();
  + await page.waitForNetworkIdle();
  + await expect(page.getByTestId("welcome")).toHaveText("Welcome back");

Recorded 5 steps into "signs in" in /work/shop/tests/login.spec.ts
```

`+` is a new step, `~` a step that was rewritten (typing grows one `fill`). What each action becomes, and what isn't recorded yet, is in [Steps and the recorder](recorder.md).

| Option                 | Meaning                                                                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `--new <title>`        | Add a test with this title to the file, creating the file when it doesn't exist                                                    |
| `--test <name\|index>` | Record into this test: its full name, a part of it that is unique, or its index in the file. Not needed when the file has one test |
| `--at <n>`             | Insert from step `n`. Default: after the test's last step                                                                          |
| `--url <url>`          | The page to start on. Default: the environment's `baseURL`; without one the window starts blank                                    |
| `--env <name>`         | Environment (base URL, and where secrets are read from)                                                                            |
| `--port <n>`           | The browser's debugging port (default 9223)                                                                                        |
| `--json`               | One JSON event per line (`{ "op": "insert" \| "replace", "index", "step" }`) instead of the readable lines                         |

Details:

- The file is rewritten after every step, as a minimal edit: the rest of the file, comments included, is untouched. Without `--new`, the spec must already exist.
- A password field is recorded as `secrets.<FIELD_NAME>`, and the value never leaves the page. The command ends by telling you which `SAMURAI_SECRET_*` to set.
- With `--at n` the window starts on `--url` or the base URL, **not** where steps `0…n-1` would leave it. Get the page to that state yourself before you act.
- Recording is meant for a window: a person has to use it. `--headless` is only for tests of the recorder itself, and on CI (where `CI` is set) you must pass `--no-headless` to get one. `recordSpec` takes `headless` too.

## `samurai init [folder]`

Creates, in the folder (default: the current one), and never overwrites a file that exists:

| File                    | Content                                                                    |
| ----------------------- | -------------------------------------------------------------------------- |
| `package.json`          | ES module project, `npm test` runs `samurai run`, depends on the framework |
| `samurai.config.ts`     | `srcDir: "./tests"`, one `local` environment                               |
| `tests/example.spec.ts` | A first test                                                               |
| `.env.example`          | Where secrets go                                                           |
| `.gitignore`            | `node_modules`, `result`, `logs`, `browsers`, `.env.*`                     |

Then install the dependencies and run `samurai run`.

## Logging

Framework logging on the console is quiet in the command (warnings and errors, on stderr). Everything is still written to `logs/combined.log`. For the full console output set `SAMURAI_LOG_LEVEL=debug`. The same variable works when you use the framework from code.

## Other

`samurai --help` prints the usage, `samurai --version` the version.
