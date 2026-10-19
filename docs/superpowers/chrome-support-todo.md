# Chrome support: to do

Status: specs approved. Implementation plan: [chrome-support-plan](plans/2026-10-19-chrome-support-plan.md).

Roadmap item 6. Chrome launches through chromedriver (`src/browser/chrome-launch.ts`). The browser suite run on Chrome 155 (Linux, headless): 17 of 27 files pass, 36 tests fail in the other 10, and `navigation.browser-test.ts` hangs. One spec per issue:

| #   | Spec                                                                                                             | Affects                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 00  | [Run the browser tests on either browser](specs/2026-10-19-browser-test-matrix-design.md)                        | All browser tests; this is the prerequisite for the other specs.                |
| 01  | [Chrome's scrollbars shrink the viewport](specs/2026-10-19-chrome-scrollbars-design.md)                          | page-api (3 tests). Later pixel-exact checks too.                               |
| 02  | [A device pixel ratio set once stays on the page](specs/2026-10-19-chrome-pixel-ratio-leak-design.md)            | page-api (2 tests); anything that sets the ratio on a shared page.              |
| 03  | [Screenshot of an element below the fold fails](specs/2026-10-19-chrome-offscreen-element-screenshot-design.md)  | page-api (1 test); every element screenshot of an element outside the viewport. |
| 04  | [goBack / goForward lose the page](specs/2026-10-19-chrome-history-navigation-design.md)                         | page-api (1 test); anything calling `goBack` / `goForward`.                     |
| 05  | [Emulation options that do nothing on Chrome](specs/2026-10-19-chrome-emulation-design.md)                       | emulation (4 tests).                                                            |
| 06  | [JavaScript dialogs hang or do not match Firefox](specs/2026-10-19-chrome-dialogs-design.md)                     | dialog (3 tests; the other 5 pass).                                             |
| 07  | [waitForLoadState after a link click, and its timeout error](specs/2026-10-19-chrome-load-state-design.md)       | navigation (2 tests, plus the rest of the file after the hang).                 |
| 08  | [Request interception differs from Firefox](specs/2026-10-19-chrome-request-interception-design.md)              | router (4 tests; 16 pass).                                                      |
| 09  | [Network idle and body collection](specs/2026-10-19-chrome-network-tracking-design.md)                           | network-tracker (1), network-data (1).                                          |
| 10  | [A second download with the same name is not renamed](specs/2026-10-19-chrome-download-names-design.md)          | transfers (1 test; the other 12 pass).                                          |
| 11  | [Unhandled rejection text differs](specs/2026-10-19-chrome-page-error-text-design.md)                            | page-logs (1 test).                                                             |
| 12  | [The recorder toolbar does not come back on a new document](specs/2026-10-19-chrome-toolbar-lifecycle-design.md) | toolbar (2 tests).                                                              |
| 13  | [Dragging the toolbar rail drops at the wrong y](specs/2026-10-19-chrome-toolbar-drag-design.md)                 | toolbar (1 test).                                                               |
| 14  | [Recorder toolbar: picks, keys and state](specs/2026-10-19-chrome-recorder-toolbar-input-design.md)              | recorder-toolbar (5 tests; 9 pass).                                             |

Suggested order: 00 first (the other specs need it to check their work), then 01, 10 and 11 (small, understood), then 02–09, then 12–14 (recorder).

## Not covered by the tests

- [ ] Docs: `pages-and-browsers.md` (the Chrome "not yet" row, which options differ), `configuration.md` (`browser`, `browserPaths`), `roadmap.md` (item 6 and "Browsers"), `cli.md`, and the non-goal in the browser-management spec.
- [ ] `src/types/config.d.ts` still says "Only firefox can launch today".
- [ ] Verify the Chrome launch on macOS and Windows (only Linux was run). `--no-sandbox`, `--headless=new` and the chromedriver path are the parts that can differ.
- [ ] `launchOptions.port` is ignored for Chrome (chromedriver picks one). Document it or drop the option for Chrome.
- [ ] Unit tests for `BiDiConnector.onClosed` and `ChromeProcess` (exit on socket close, `kill` deletes the session).
- [ ] The first-start warm-up (`ensureWarm`) was not exercised on Chrome; check the `.samurai-launched` stamp.
- [ ] `SAMURAI_CHROMEDRIVER_PATH` needs a line in the docs; `samurai browsers` must show Chrome as launchable.
- [ ] A Chrome that is still running on the project profile (`browsers/profiles/chrome`) makes the next launch hang until the start timeout: chromedriver waits for it. Found when killed test runs left Chrome processes behind. Detect the profile lock (`SingletonLock`) and fail fast with a clear message, or use a profile folder per launch.
- [ ] CI: a Chrome job once the suite is green; the cache key includes chromedriver.
- [ ] Roadmap item 7 (embedded recording browser) stays separate, with its own `chromium-bidi` plan.
