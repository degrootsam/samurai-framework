# Browser management — design

Date: 2026-10-15
Status: implemented (0.6); this note was written afterwards, from the code
Code: `src/browsers/`, `src/browser/warm-up.ts`, `src/cli/browsers.ts`
Guide: [Which browser runs](../../pages-and-browsers.md#which-browser-runs)

## Goal

Every machine (a developer's laptop, a CI runner, the Electron app) tests with the same browser build. The framework downloads a build it pins, keeps it in a per-user cache shared by all projects, and launches only that build unless a path is set on purpose.

## Non-goals

- Launching Chrome. Chrome for Testing is pinned and downloads, but `LAUNCHABLE` is `["firefox"]` until the `chromium-bidi` work (recorder roadmap item 6).
- Downloading during a launch. A launch never downloads: a missing build is an error that says which command fixes it.
- Using the browser installed on the computer. `findBrowser` (the old behaviour) stays exported but deprecated.
- Installing the system libraries a browser needs on minimal Linux images.
- Verifying downloads beyond what `@puppeteer/browsers` does. `SAMURAI_BROWSERS_BASE_URL` (tests only) points downloads elsewhere and nothing checks what that server sends.

## Decisions

- **Pins live in code.** `src/browsers/pins.ts` holds `PINNED` (`buildId` and a label per browser), bumped by hand in a release. A new framework version may pin new builds, so CI caches key on the lockfile (or on `pins.ts` in this repository).
- **One cache per user, not per project.** `browsersCacheDir()`: `SAMURAI_BROWSERS_PATH`, else `~/Library/Caches/samurai/browsers` (macOS), `%LOCALAPPDATA%\samurai\browsers` (Windows), `$XDG_CACHE_HOME/samurai/browsers` or `~/.cache/samurai/browsers` (Linux). Browsers are hundreds of MB; projects on the same framework version share them.
- **`@puppeteer/browsers` does the downloading.** It knows the download URLs and archive layouts of Firefox and Chrome for Testing. The store reaches it through a small `Downloader` interface so unit tests use a fake.
- **Installs are atomic.** Each install downloads into its own `<cache>/.staging-<random>/`, writes `.samurai-complete` into the build folder once unpacked, then renames it into place. A folder without the marker doesn't count as installed. Two installs at once (the app and the CLI, two CI jobs) don't break each other. Staging folders older than a day belong to a killed install and are removed. A killed download's leftover archive is removed too.
- **Explicit paths win, in a fixed order.** `SAMURAI_FIREFOX_PATH` / `SAMURAI_CHROME_PATH`, then `browserPaths` in `samurai.config.ts` (relative to the project), then the pinned build. A path set on purpose must exist; the error names where it was set.
- **Warm up before the first test.** The first start of a freshly downloaded build can be slow (macOS checks the new app). `ensureWarm` starts a managed build once, headless, before a run or a recording, and writes `.samurai-launched` into the build folder. A browser set by path is never warmed. Starting the session has a 120 s limit (`BrowserStartTimeoutError`).

## Components

| Module               | Role                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `pins.ts`            | `PINNED`, `MANAGED_BROWSERS`, `LAUNCHABLE`, `isManagedBrowser`                                                            |
| `cache-dir.ts`       | `browsersCacheDir()`                                                                                                      |
| `downloader.ts`      | `Downloader` interface and the `@puppeteer/browsers` implementation; `COMPLETE_MARKER`                                    |
| `overrides.ts`       | `overrideOf(name, { env, browserPaths, projectDir })`, `ENV_PATH`                                                         |
| `store.ts`           | `installBrowser`, `uninstallBrowser`, `listInstalled`, `statusOf`, `managedExecutable`, `BrowserNotInstalledError`        |
| `resolve.ts`         | `resolveExecutable`, `projectBrowser`, `browserStatus`: overrides, then the store, with the project's config read for you |
| `browser/warm-up.ts` | `ensureWarm`, `warmUp`, the `.samurai-launched` stamp                                                                     |
| `cli/browsers.ts`    | `samurai browsers` with `list`, `install` and `uninstall`                                                                 |

`browserStatus` reports each pinned browser as `installed`, `missing` or `unavailable` (no build for this OS and architecture), with `launchable` and any override. A config that can't be read gives no config paths rather than an error, so the app can still show status.

## Error handling

- Missing build: `BrowserNotInstalledError`, `Firefox 158.0 is not installed. Run: samurai browsers install firefox`. The runner raises it once before the first test, not once per test.
- Override pointing nowhere: `SAMURAI_FIREFOX_PATH points to a missing file: <path>` or `browserPaths.firefox in samurai.config.ts points to a missing file: <path>`.
- Slow first start: `Firefox 158.0 did not finish starting within 120s. The first start after an install can be slow; run again.`
- `samurai browsers`: exit 1 for an unknown browser name, 2 for a usage error.

## Testing

- Unit tests (`src/browsers/*.test.ts`) run the store against a fake `Downloader` and a temporary cache: completion marker, staging cleanup, stale staging, uninstall, listing with sizes and `pinned`, override order, cache folder per platform.
- `src/browser/warm-up.test.ts` covers the stamp and the skip rules; `src/runner/run-browser-missing.test.ts` and `src/recorder/record-browser-missing.test.ts` cover the missing-build error.
- CI installs Firefox through the command (`bunx tsx src/index.ts browsers install firefox`) and caches the cache folder keyed on `pins.ts`.

## Open

- Launching Chrome (recorder roadmap item 6).
- Checksums for downloads.
