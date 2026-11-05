<!-- markdownlint-disable MD041 -->

SAMURAI is not a copy of Playwright, but its test API is close enough that most specs port with few edits. This page maps a Playwright project to a SAMURAI one and lists what has no equivalent. The one structural difference is `projects`: SAMURAI has no `projects` matrix. You translate each Playwright project by hand into a [group](Configuration#groups) with its own [`use`](Configuration#group-use) and `browsers`.

## Config

| Playwright                                                                                                    | SAMURAI                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `testDir`                                                                                                     | `srcDir` (default `./src`). Specs are `*.spec.ts`; a group's `src` and `testMatch` narrow them                                                                                                                                              |
| `projects: [{ name, use, testMatch }]`                                                                        | `groups: [{ name, use, testMatch, browsers }]`, run with `--group <name>`. See [below](#projects-become-groups)                                                                                                                             |
| a project's `use.browserName` or `devices[...]`                                                               | `browsers: ["chrome"]` on the group (`firefox` or `chrome`), and the options of the device written out in the group's `use` (there is no `devices` list)                                                                                    |
| `use.baseURL`                                                                                                 | `baseURL` at the top of the config, or per [environment](Environments-and-secrets). It is not part of `use`, and not allowed in a group's `use`                                                                                             |
| `use.ignoreHTTPSErrors`                                                                                       | `use.acceptInsecureCerts`                                                                                                                                                                                                                   |
| `use.viewport`, `use.locale`, `use.timezoneId`, `use.userAgent`                                               | The same names, in `use` of the config or of a group. `viewport` is `{ width, height }` or `null`; the default is 1280x720                                                                                                                  |
| `use.isMobile`, `use.hasTouch`                                                                                | The same names. **Chrome only**: Firefox ignores them with a warning                                                                                                                                                                        |
| `use.colorScheme`, `use.javaScriptEnabled`, `use.extraHTTPHeaders`                                            | The same names                                                                                                                                                                                                                              |
| `use.storageState` (a path or an object)                                                                      | `use.storageState`, the same file format; a path is relative to the project folder. SAMURAI cannot yet _save_ a state from a logged-in context                                                                                              |
| `use.headless`                                                                                                | `use.headless` (headless when `CI` is set, otherwise a window); `--headless` / `--no-headless`                                                                                                                                              |
| `timeout`, `expect: { timeout }`                                                                              | `timeout` and `expect.timeout`; per environment too                                                                                                                                                                                         |
| `workers`                                                                                                     | `workers` (a number or `"50%"`; default half the CPUs), `--workers`, `SAMURAI_WORKERS`                                                                                                                                                      |
| `fullyParallel`                                                                                               | `fullyParallel`. Playwright's default is the file as the unit; SAMURAI's, when unset, is the single test. Set `fullyParallel: false` to get Playwright's default. See [Fully parallel](Configuration#fully-parallel)                        |
| `retries`                                                                                                     | `retries`, `--retries`, `SAMURAI_RETRIES`; a passing retry is `flaky`                                                                                                                                                                       |
| `forbidOnly`                                                                                                  | `forbidOnly` (on by default when `CI` is set)                                                                                                                                                                                               |
| `--shard=1/3`                                                                                                 | `--shard=1/3` (whole files, and serial blocks, go to one shard)                                                                                                                                                                             |
| `webServer: { command, url, port, reuseExistingServer, timeout, cwd, env, stdout, stderr, gracefulShutdown }` | `webServer` with the same fields, one object or a list. Without a `baseURL`, the first server's address becomes the base URL. See [Web server](Configuration#web-server)                                                                    |
| `globalSetup`, `globalTeardown`                                                                               | `globalSetup`, `globalTeardown`: a module path (or function) that runs once per run; the function receives the resolved config and may return a teardown function. See [Global setup and teardown](Configuration#global-setup-and-teardown) |
| `grep`, `--grep`                                                                                              | `--grep <text>` (a substring of the full title); `grep` option of `runTests`, which also takes a `RegExp`                                                                                                                                   |
| `--project=name`                                                                                              | `--group name`; repeat it to run several                                                                                                                                                                                                    |
| `reporter`                                                                                                    | None to configure. See [Reporters](#what-has-no-equivalent)                                                                                                                                                                                 |

### Projects become groups

A Playwright project is a name, some `use` options and (often) a `testMatch`. Each becomes a group: the same name, the same options in `use`, and `browsers` for the engine. `--group <name>` selects it, and a run with several `--group` flags runs every test of each group with that group's options.

Playwright:

```ts
// playwright.config.ts
export default defineConfig({
  testDir: "./tests",
  use: { baseURL: "https://shop.test", ignoreHTTPSErrors: true },
  projects: [
    {
      name: "phone",
      use: {
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        timezoneId: "Europe/Amsterdam",
      },
    },
    {
      name: "tablet",
      use: {
        browserName: "chromium",
        viewport: { width: 820, height: 1180 },
        isMobile: true,
        hasTouch: true,
        timezoneId: "Europe/Amsterdam",
      },
    },
    {
      name: "desktop",
      use: {
        browserName: "firefox",
        viewport: { width: 1440, height: 900 },
        timezoneId: "Europe/Amsterdam",
      },
    },
  ],
});
```

SAMURAI:

```ts
// samurai.config.ts
import { defineConfig } from "@itmetsam/samurai-framework";

export default defineConfig({
  srcDir: "./tests",
  baseURL: "https://shop.test",
  use: { acceptInsecureCerts: true, timezoneId: "Europe/Amsterdam" }, // shared by every project
  groups: [
    {
      name: "phone",
      browsers: ["chrome"],
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "tablet",
      browsers: ["chrome"],
      use: {
        viewport: { width: 820, height: 1180 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "desktop",
      browsers: ["firefox"],
      use: { viewport: { width: 1440, height: 900 } },
    },
  ],
});
```

```sh
samurai run --group phone --group tablet --group desktop
```

Things that differ from a project:

- **Layering.** A test's options are the config's `use`, then the group's, then `test.use()` of the file and `describe`, the inner one winning. That is why the shared `timezoneId` sits at the top.
- **A group is also a set of tests.** With neither `src`, `testMatch` nor `tests` it holds every spec, as a project without `testMatch` does. Give it `testMatch` or `src` to narrow it. A test can be in several groups.
- **One run per group.** A test that is in two selected groups runs once for each, in that group's `browsers`, and its report entry has the `group`. Without `--group`, no group applies and the tests run once with the config's `use`.
- **The name.** `testInfo.project.name` is the group's name (the browser's when no group is run), so `test.skip(({ browserName }) => ...)` and checks on `testInfo.project.name` keep working.
- **No dependencies.** Playwright's project `dependencies` and `teardown` do not exist. Use `globalSetup` for work that must happen first (and save nothing between projects), or a [flow](Flows) to order tests.
- **`devices`.** There is no `devices['iPhone 13']`. Write the device out: `viewport`, and if it matters `userAgent`, `isMobile` and `hasTouch`. A device pixel ratio is not part of a group's `viewport`; `page.setViewport({ width, height, devicePixelRatio })` sets it in a test.
- **Group `workers`.** `workers: 1` on a group keeps its tests from running at the same time; it is not a project's `workers`.

## Test API

| Playwright                                                                            | SAMURAI                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `import { test, expect } from "@playwright/test"`                                     | `import { test, expect } from "@itmetsam/samurai-framework"`                                                                                                                                                                                                                                                                 |
| `test`, `test.describe`, hooks, `test.skip/fixme/fail/slow`, `test.step`, `test.only` | The same names. See [Writing tests](Writing-tests)                                                                                                                                                                                                                                                                           |
| `test.describe.configure({ mode })`, `test.describe.serial`                           | The same ([Serial mode](Writing-tests#serial-mode))                                                                                                                                                                                                                                                                          |
| `test.extend({ ... })`                                                                | `test.extend({ ... })`, including `auto` fixtures and overriding built-ins. Only test-scoped fixtures: no `scope: "worker"`, and no option fixtures (`[value, { option: true }]`). See [Fixtures](Writing-tests#fixtures)                                                                                                    |
| `test.use({ locale, timezoneId, ... })`                                               | `test.use({ ... })` with `locale`, `timezoneId`, `userAgent`, `javaScriptEnabled`, `acceptInsecureCerts`, `hasTouch`, `isMobile`, `storageState`, `extraHTTPHeaders`, `colorScheme`. It refuses any other key, so `test.use({ viewport })` and `test.use({ baseURL })` are errors: put them in a group's `use` or the config |
| `testInfo` fixture, `test.info()`                                                     | The same: `title`, `titlePath`, `file`, `retry`, `workerIndex`, `project.name`, `config`, `status`, `annotations`, `attach()`, `outputDir`, `setTimeout()`. See [Test info](Writing-tests#test-info)                                                                                                                         |
| `page.request`, `request` fixture                                                     | The same; they share the context's cookies and follow `extraHTTPHeaders`, `acceptInsecureCerts` (`ignoreHTTPSErrors`) and `storageState`. See [API requests](API-requests)                                                                                                                                                   |
| `expect.poll(fn)`, `expect(fn).toPass()`                                              | The same. `toPass` has Playwright's default timeout of 0. See [Retrying](Assertions#retrying-expectpoll-and-topass)                                                                                                                                                                                                          |
| `page.setViewportSize({ width, height })`                                             | The same name                                                                                                                                                                                                                                                                                                                |
| `page.goto("/path")` with a `baseURL`                                                 | The same; `navigateTo` is the SAMURAI name for an absolute URL                                                                                                                                                                                                                                                               |
| `page.route`, `waitForResponse`, `waitForRequest`                                     | The same names. See [Network](Network)                                                                                                                                                                                                                                                                                       |

## Locators

Most locator calls port unchanged. These differ:

- **`exact` defaults to `true`.** `getByText("Save")` matches "Save" in full and case-sensitively, not "Save draft"; Playwright's default is a case-insensitive substring. The same holds for `getByLabel`, `getByPlaceholder`, `getByAltText`, `getByTitle` and the `name` of `getByRole`. Pass `exact: false` where the Playwright spec relied on the loose match. See [Locators](Locators#exact-or-loose).
- **Strict mode is opt-in.** Playwright throws when a locator matches several elements; SAMURAI uses the first match unless you set `use: { strictSelectors: true }` (in the config, not per group) or call `locator.strict()`. Turn it on while porting to find the ambiguous locators. See [Strict mode](Locators#strict-mode).
- **`getByRole` options.** `name`, `exact`, `level`, `checked`, `pressed`, `expanded`, `selected`, `disabled` and `includeHidden` are supported. A plain role, or a role with a string `name`, is answered by the browser's own accessibility tree, so Firefox and Chrome can differ for hidden elements; anything richer is a search in the page with a simplified role table. A `name` is a full, case-sensitive match unless `exact: false` (see the first point). See [Roles](Locators#roles).
- **Reads that wait.** In SAMURAI a single-element read such as `textContent()` of a missing element answers `null` instead of waiting and timing out, and `textContent()` trims its text. Assert with `expect(locator)` where Playwright's read would have waited.

## What has no equivalent

- **WebKit.** Only Firefox and Chrome. Safari has no WebDriver BiDi, so there is no `webkit` browser and nothing to put in a group's `browsers`.
- **Trace viewer, video and HAR.** There is no trace archive, no video recording and no HAR capture. A failed test has its error, the page's console log (`logs.capture`), steps, attachments and named screenshots in the report.
- **Visual and aria snapshots.** No `toHaveScreenshot`, `toMatchAriaSnapshot` or `toMatchSnapshot`, and no snapshot folder. Screenshots are taken with `page.screenshot({ name })` and compared by hand.
- **Reporters.** There is no `reporter` option, and no HTML or GitHub reporter. A run prints to the console, writes `result/report.json`, and emits events (`--json`, or `onEvent` from `runTests`). Build a report from `report.json` or the events. See [Running tests and reports](Running-tests-and-reports).
- **Fake clock.** No `page.clock`. Control time in the page with `page.evaluate`, or by mocking the server.
- **Project `dependencies` and `teardown`.** Groups have no ordering between them (see [above](#projects-become-groups)).
- **Worker-scoped and option fixtures.** `test.extend` fixtures are per test; share expensive setup with `beforeAll`.
- **Saving a `storageState`.** You can load one, but there is no `context.storageState({ path })` yet (see the [Roadmap](Roadmap)).
- **Iframes.** Locators search the top-level document and do not pierce iframes: there is no `frameLocator`. See [Locators](Locators#scope-and-limits).
- **Component testing, `@playwright/test` UI mode, codegen options.** SAMURAI has its recorder instead ([Steps and the recorder](Steps-and-the-recorder)).

If a feature you rely on is missing from both this table and the list above, check the [Roadmap](Roadmap) or open an issue.
