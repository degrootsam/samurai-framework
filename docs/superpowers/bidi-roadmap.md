# WebDriver BiDi adoption — roadmap

Date: 2026-09-29
Source: https://www.w3.org/TR/webdriver-bidi/
Status: all 15 specs (0 to 14) are implemented.

Each item links to its spec in `docs/superpowers/specs/`. Order respects dependencies (`←`).

## Todo

### Phase 0 — prerequisite
- [x] **0. Foundation** — connector error replies, command typings, refcounted subscriptions, context tree, `newPage` fix — [spec](specs/2026-09-29-bidi-foundation-design.md)

### Phase 1 — locator core
- [x] **1. `script.callFunction` (+ `script.disown`)** ← 0 — [spec](specs/2026-09-29-script-call-function-design.md)
- [x] **2. `script.addPreloadScript`** ← 0, 1 — [spec](specs/2026-09-29-preload-scripts-design.md)
- [x] **3. `browsingContext.locateNodes`** ← 1 (2 optional) — [spec](specs/2026-09-29-locate-nodes-design.md)
- [x] **4. `input.setFiles`** ← 1, 3 — [spec](specs/2026-09-29-set-files-design.md)

### Phase 2 — waiting correctness
- [x] **5. Network tracking + real network idle** ← 0 — [spec](specs/2026-09-29-network-tracking-design.md)
- [x] **6. Navigation waits (`navigate` wait, load events, reload)** ← 0, 5 — [spec](specs/2026-09-29-navigation-waits-design.md)
- [x] **7. User prompts (`handleUserPrompt`)** ← 0 — [spec](specs/2026-09-29-user-prompts-design.md)
- [x] **8. Logs and page errors (`log.entryAdded`)** ← 0, 1 — [spec](specs/2026-09-29-logs-and-errors-design.md)

### Phase 3 — features
- [x] **9. Network interception (mock / block / modify)** ← 0, 5 — [spec](specs/2026-09-29-network-interception-design.md)
- [x] **10. Network data (cache control, response bodies)** ← 5 — [spec](specs/2026-09-29-network-data-design.md)
- [x] **11. Page API completeness (viewport, reload, history, close, pdf, screenshot)** ← 0, 1 — [spec](specs/2026-09-29-page-api-design.md)
- [x] **12. User contexts + storage** ← 0 — [spec](specs/2026-09-29-contexts-and-storage-design.md)

### Phase 4 — nice to have
- [x] **13. Emulation** ← 12 — [spec](specs/2026-09-29-emulation-design.md)
- [x] **14. Downloads + file dialogs** ← 0, 4 — [spec](specs/2026-09-29-downloads-and-file-dialogs-design.md)

## Dependency graph

```
0 ─┬─ 1 ─┬─ 2
   │     ├─ 3 ── 4 ── 14
   │     ├─ 8
   │     └─ 11
   ├─ 5 ─┬─ 6
   │     ├─ 9
   │     └─ 10
   ├─ 7
   └─ 12 ── 13
```

## Deliberately skipped

`webExtension.*`, `session.end`, `script.getRealms`, `script.removePreloadScript` as public API (used internally only), `network.continueWithAuth` (folded into spec 9 as a follow-up).

## Cross-cutting rules for every spec

- Test-first: each unit test before its implementation, using `src/testing/stub-connector.ts`; browser tests in `*.browser-test.ts` (`npm run test:browser`).
- Any feature that needs an event subscribes through the refcounted API from spec 0, never a bare `session.subscribe`.
- Every command a feature sends must be typed in `BiDiCommands` (spec 0 lists the missing ones).
- Timeouts resolve through `resolveTimeout` (actions/assertions) or the navigation timeout from spec 6 (navigation); no unbounded waits.
- Browser support is verified against Firefox (the only `SupportedBrowser` today). A command Firefox lacks is documented in its spec and surfaced as `UnsupportedOperationError`, not a hang.
