# Recorder — roadmap

Date: 2026-10-01
Status: phase 1 done; later phases not specced yet.
UI: the Electron app at `~/dev/itmetsam/projects/samurai` (designs: "SAMURAI" design canvas, boards "Test editor & recorder" and "Test editor · code view").

Each item gets its own spec in `docs/superpowers/specs/` and its own plan. Order respects dependencies (`←`).

## Decisions so far

- **Audience: non-technical testers.** Recording, editing and replaying happen in the Electron UI; nobody has to touch code.
- **Source of truth: the `.spec.ts` file.** The steps view is parsed from it and edits are written back with minimal diffs ("edit either one and the other updates"). The recorder emits a restricted set of known step calls so parsing is reliable; any statement outside that set becomes a "Custom code" step.
- **Recording browser: external window for now.** The engine launches the browser over BiDi; the tester interacts in that window while the Electron app shows steps live. In-page overlay handles the Alt+click assertion picker. Embedding the page in the Electron editor panel (as the designs show) is **required later** — see item 7.

## Todo

### Phase 1 — framework prerequisites
- [x] **1. Test API alignment** — `describe`, `test(name, async ({ page, browser, env, secrets }) => …)` fixtures, `page.goto` resolving relative URLs against the environment's `baseURL`; environment selection, per-environment variables and timeout precedence (run > environment > project); a secrets provider interface (env-var/`.env` provider now, keychain/vault plugged in by the Electron app later) with masking in logs and reports. — [spec](specs/2026-10-01-test-api-alignment-design.md)
- [x] **2. Semantic locators** — `getByRole`, `getByLabel`, `getByTestId`, `getByText`, plus an ordered fallback-locator list per step (input for self-healing). — [spec](specs/2026-10-01-semantic-locators-design.md)

### Phase 2 — recorder core
- [ ] **3. Step codec** ← 1, 2 — steps model, parser (TS AST → steps, unknown → "Custom code"), minimal-diff writer.
- [ ] **4. Recorder engine** ← 2, 3 — preload capture over a `script.addPreloadScript` channel, locator ranking (verified to match exactly one element), step normalisation (merge typing into `fill`, drop focus clicks, navigation waits), record-from-line N, Alt+click assertions.

### Phase 3 — UI
- [ ] **5. Recorder UI (Electron)** ← 3, 4 — steps panel, step inspector, IPC to the engine, live step stream while recording.

### Phase 4 — browsers
- [ ] **6. Chrome support** — likely via the `chromium-bidi` mapper (BiDi over CDP). Separate from the recorder, but item 7 builds on it.
- [ ] **7. Embedded recording browser (Electron + chromium-bidi)** ← 6 — **required**: the designs show the recorded page inside the editor panel.
  - Idea: render the page under test in a `WebContentsView`, expose CDP (`remote-debugging-port` or `webContents.debugger`), run the `chromium-bidi` mapper in the main process, and add a framework transport that talks BiDi to it. Everything above the transport stays unchanged.
  - Risks to settle in a spike first:
    - The debugging port exposes every Electron window over CDP, including SAMURAI's own UI. It must be filtered to the recording view, and a local open port is a security concern (prefer a pipe or `webContents.debugger`).
    - The mapper expects browser-level CDP (`Target.*`, `Browser.*`); a page-level `webContents.debugger` session may not be enough.
    - User contexts (`createBrowserContext`), downloads and some emulation may behave differently in Electron.
    - Firefox can't be embedded: in-app recording is Chromium-only. Replay still runs in Firefox and Chrome.
  - Spike (throwaway): the mapper drives one `WebContentsView` in Electron 41 and runs `browsingContext.navigate` and `script.callFunction`.
  - Considered and rejected: **Tauri**. It uses the OS webview (WKWebView on macOS, WebView2 on Windows, WebKitGTK on Linux); only WebView2 exposes CDP, so in-app recording would work on Windows only.

### Later (not scheduled)
- AI-suggested assertions, self-healing (selector fixes), AI agent recording. All build on item 4.
- `api.<name>` fixture: per-environment HTTP client with auth from a secret (designs: "Environment settings" → APIs). Builds on item 1.
- Masking secrets in screenshots, videos and traces (item 1 only masks logs and reports).

## Dependency graph

```
1 ─┐
   ├─ 3 ─┬─ 4 ── 5
2 ─┴─────┘
6 ── 7
```
