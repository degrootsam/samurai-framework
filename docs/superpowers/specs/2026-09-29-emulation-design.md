# Emulation — design

Date: 2026-09-29
Status: implemented (see "Implementation notes")
Roadmap item: 13
Depends on: contexts-and-storage (overrides can target user contexts), bidi-foundation

## Goal

Expose the `emulation.*` commands (already typed in `src/types/bidi-modules/emulation.d.ts`, not wired into `BiDiCommands`) as page/context options.

```ts
const ctx = await browser.newContext({
  locale: "nl-NL", timezone: "Europe/Amsterdam",
  geolocation: { latitude: 52.37, longitude: 4.9, accuracy: 10 },
  userAgent: "Samurai/1.0", colorScheme: "dark", offline: false,
});
await page.emulate({ geolocation: null });                 // reset one override
```

## Non-goals

- Device descriptors (iPhone 15, …); a list of presets can be layered on later.
- Permissions API grants (`permissions.setPermission` is a separate BiDi module, not in scope).
- CPU throttling.

## Options and mapping

| Option | Command | Reset |
|---|---|---|
| `locale` | `emulation.setLocaleOverride { locale }` | `null` |
| `timezone` | `emulation.setTimezoneOverride { timezone }` | `null` |
| `geolocation` `{ latitude, longitude, accuracy? }` | `emulation.setGeolocationOverride { coordinates }` | `null` |
| `userAgent` | `emulation.setUserAgentOverride { userAgent }` | `null` |
| `colorScheme` `"light" \| "dark"` | `emulation.setForcedColorsModeThemeOverride`-adjacent; see Caveat | `null` |
| `offline` | `emulation.setNetworkConditions { networkConditions: { type: "offline" } }` | `null` |
| `orientation` | `emulation.setScreenOrientationOverride` | `null` |
| `touch` (max touch points) | `emulation.setTouchOverride { maxTouchPoints }` | `null` |
| `javaScriptEnabled` | `emulation.setScriptingEnabled { enabled }` (`null` resets) | `null` |

Each command accepts `contexts` or `userContexts` (mutually exclusive). Context-level options (`browser.newContext({…})`) use `userContexts: [id]` so every page of the context inherits them, including pages created later; `page.emulate({…})` uses `contexts: [pageContext]`. A page override wins over its context's override (browser behaviour; asserted in a browser test).

### Caveat: colour scheme

BiDi only has `setForcedColorsModeThemeOverride` (forced-colors theme), which is not the same as `prefers-color-scheme`. `colorScheme` is included only if the browser test proves it drives `matchMedia("(prefers-color-scheme: dark)")` in Firefox; otherwise it is dropped from v1 and documented as unsupported (`UnsupportedOperationError`). The same proof-first rule applies to every row: each option ships only if its browser test passes on Firefox; the rest throw `UnsupportedOperationError` naming the option.

## Components

- `src/browser/emulation.ts`: `applyEmulation(connector, target: { contexts?: string[]; userContexts?: string[] }, options)` runs the mapped commands sequentially, skipping `undefined` options, sending `null` to reset. Validation before sending: latitude −90..90, longitude −180..180, accuracy ≥ 0, IANA timezone via `Intl.DateTimeFormat(undefined, { timeZone })` (throws `RangeError` on unknown), locale via `Intl.getCanonicalLocales`.
- `Page.emulate(options)`; `Browser.newContext(options)` accepts the same options object (contexts spec) and applies it right after `createUserContext`, before the first page exists.
- `BrowserContext.emulate(options)` for changing a live context.
- Partial failure: if command N of M fails, previously applied commands are **not** rolled back; the thrown `EmulationError` lists `applied` and `failed` option names so the caller knows the state.

## Errors

`EmulationError extends Error { applied: string[]; failed: string; cause: BiDiError }`; `UnsupportedOperationError` per option as above; `RangeError` for invalid values.

## Testing

- Unit: option → command/payload table for each row, `null` reset, contexts vs userContexts targeting, validation errors, partial failure report, context options applied before first page.
- Browser (each row is its own test and gates whether the option ships): `navigator.language`, `Intl.DateTimeFormat().resolvedOptions().timeZone`, `navigator.geolocation.getCurrentPosition` result, `navigator.userAgent`, `navigator.onLine` plus a failing fetch when offline, `matchMedia` for colour scheme, `screen.orientation.type`, `navigator.maxTouchPoints`, scripting disabled leaves inline script unexecuted; page override beats context override.
- TDD: tests first.

## Implementation notes

- **Where:** `browser/emulation.ts` (`EmulationOptions`, `applyEmulation`, `validateEmulation`, `EmulationError`, `EmulationUnsupportedError`), `Page.emulate`, `BrowserContext.emulate`, `Browser.newContext(options)` (its options now extend `EmulationOptions`), `permissions.setPermission` typed (`types/bidi-modules/permissions.d.ts`, wired into `BiDiCommands`).
- **Proof-first result on Firefox 153** (probed, then browser-tested; each row is its own test):

  | Option | Firefox 153 |
  |---|---|
  | `locale` | works: `navigator.language`, `Intl` formatting; `null` resets |
  | `timezone` | works: `Intl` zone and `getTimezoneOffset`; `null` resets |
  | `userAgent` | works: `navigator.userAgent` and the request header the server receives |
  | `offline` | works: `navigator.onLine` false and fetches fail |
  | `orientation` | works: `screen.orientation.type` |
  | `screen` (new: `{ width, height }` → `setScreenSettingsOverride`) | works: `screen.width`/`height` |
  | `geolocation` | works, **once the permission is granted for that user context** (without it `getCurrentPosition` never answers) |
  | `touch`, `javaScriptEnabled` | `unknown command` → `UnsupportedOperationError` |
  | `colorScheme` | **dropped**: BiDi has no `prefers-color-scheme` override, only forced colours, which Firefox 153 lacks (`unknown command`) |

  `setTouchOverride`, `setScriptingEnabled` and the forced-colours / scrollbar commands are unknown to Firefox 153; the framework maps `touch` and `javaScriptEnabled` anyway and turns `unknown command` / `unsupported operation` into `UnsupportedOperationError` (so they work where a browser has them). The forced-colours and scrollbar commands are not exposed.
- **Permissions (an addition to the draft, which listed them as a non-goal):** geolocation is unusable without a grant, so `BrowserContext.setPermission(name, state, origin)` and `Page.grantPermission(name, { origin? })` (default: the origin the page is on; `about:blank` and `data:` pages need an explicit one) send `permissions.setPermission`, naming the user context for non-default contexts.
- **Targets:** `page.emulate` uses `contexts: [pageId]`, `context.emulate` and `newContext` options use `userContexts: [id]` (the default context is `"default"`). Firefox rejects both or neither. Verified: a context's setting reaches open pages and pages opened later, not other contexts; a page's own setting wins; `null` on the page falls back to the context's value.
- **Options:** `undefined` leaves an option alone, `null` resets it; `offline: false` and `javaScriptEnabled: true` mean "back to normal" (a `null` command); `orientation` takes `"portrait"` / `"landscape"` (primary) or one of the four BiDi types. Commands go out in a fixed order (locale, timezone, userAgent, geolocation, offline, orientation, screen, touch, javaScriptEnabled).
- **Validation before anything is sent** (`RangeError`): latitude −90..90, longitude −180..180, accuracy ≥ 0, timezone via `Intl.DateTimeFormat`, locale via `Intl.getCanonicalLocales`, non-empty user agent, positive integers for screen and touch, known orientation. `newContext` validates before it creates the context.
- **Failures:** nothing is rolled back. `EmulationError` (`applied`, `failed`, `cause`) for an ordinary failure; `EmulationUnsupportedError extends UnsupportedOperationError` (`option`, `applied`) for an unsupported option. `newContext` removes the context it just created when its emulation fails, so nothing stays in the profile.
- **Typing fixes:** `SetLocaleOverrideParameters` no longer requires both `contexts` and `userContexts`; `SetTouchOverrideParameters.maxTouchPoints` may be `null`.
- Tests: `browser/emulation.test.ts` (34), the "emulation" block in `browser/browser-context.test.ts`, `browser/emulation.browser-test.ts` (port 9248, 12 tests).
