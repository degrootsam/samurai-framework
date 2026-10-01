# Command line

The package installs a `samurai` command. Run it in the project folder, the one holding `samurai.config.ts`.

```sh
samurai init [folder]     # scaffold a project
samurai list              # list the tests without running them
samurai run               # run the tests (the default: `samurai` alone does the same)
```

Spec files are TypeScript; the command loads them itself (it ships with `tsx`), so no extra setup is needed. In the framework's own repository, `bun run dev` does the same as `samurai run` without needing a build.

## `samurai run`

```sh
samurai run --env staging --headless --grep coupon
```

| Option                  | Meaning                                                                         |
| ----------------------- | ------------------------------------------------------------------------------- |
| `--env <name>`          | Environment to run against (or `SAMURAI_ENV`)                                   |
| `--file <spec>`         | Only this spec file, relative to the working directory. Repeatable              |
| `--grep <text>`         | Only tests whose full name (`describe` titles and test title) contains the text |
| `--timeout <ms>`        | Time one test may take                                                          |
| `--expect-timeout <ms>` | Time actions and assertions retry                                               |
| `--headless`            | Run the browser without a window                                                |
| `--port <n>`            | The browser's debugging port (default 9223)                                     |
| `--json`                | JSON lines on stdout instead of the human output (below)                        |

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

Imports the specs and prints the tests that `--env`, `--file` and `--grep` select, without launching a browser. `--json` prints an array of `{ "name", "file" }`.

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
