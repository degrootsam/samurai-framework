# Auto-waiting actions — design

Date: 2026-09-29
Status: approved in brainstorming, pending spec review
Depends on: the `expect` feature (`docs/superpowers/specs/2026-09-29-expect-design.md`), including its final fix wave (commits 6b5ed5b, e802a96, 0a377cf).

## Goal

Locator actions (`click`, `fill`, `focus`) wait until the element is ready for that action instead of firing once and throwing. Waiting uses one retry mechanism shared with `expect`, with a clear error naming the unmet check.

```ts
await page.locator("button[@type='submit']").click();          // waits: attached, visible, stable, enabled, not covered
await page.locator("input[@id='name']").fill("Sam", { timeout: 10000 });
await page.locator("div[@class='spinner']").waitFor({ state: "hidden" });
await page.locator("button[@id='hidden-debug']").click({ force: true });
```

## Non-goals

- Waiting in reads (`textContent`, `inputValue`, `isVisible`, …) — they stay instant; `expect()` does the waiting for reads.
- New actions (`hover`, `press`, `check`, `selectOption`, …) — later work; they reuse this mechanism.
- `toBeEnabled` / `toBeEditable` matchers — enabled by the new reads, added later.
- Shadow DOM, iframes, CSS selectors.

## Components

### `src/wait/wait-until.ts` (new) — the one retry mechanism

```ts
export interface WaitOptions { timeout: number; interval?: number } // interval default 100

export async function waitUntil<T>(
  probe: () => Promise<T>,
  isDone: (current: T, previous: T | undefined) => boolean,
  options: WaitOptions,
): Promise<T>;

export async function resolveTimeout(perCall?: number): Promise<number>;
// perCall → config `expect.timeout` → 5000

export class WaitTimeoutError<T> extends Error {
  readonly timeout: number;
  readonly last: T | undefined;      // last completed probe result, undefined if none completed
}
```

Behaviour (carries over the `expect` loop semantics after fix F3, plus the clamp from that fix's open concern):

1. Always probes at least once.
2. `timeout === 0`: the single probe is awaited un-raced; `isDone` false → `WaitTimeoutError` with that result.
3. `timeout > 0`: each probe races the time remaining to the deadline. If the deadline wins, throw `WaitTimeoutError` with `last` = the last completed result (or `undefined`).
4. After a completed probe: `isDone(current, previous)` true → resolve with `current`. Otherwise, if the deadline has passed → `WaitTimeoutError`; else sleep `min(interval, remaining)`. A probe is only started while time remains, so after the final clamped sleep the wait ends at the deadline instead of starting a probe that could only lose the race (resolves the open concern from expect fix F3).
5. Errors thrown by `probe` are rethrown immediately.
6. Race timers are cleared when the probe wins; no timer outlives the call.

`LocatorAssertions.assertEventually` in `src/assert/expect.ts` is rewritten on top of `waitUntil` with identical observable behaviour: `WaitTimeoutError` with `last` → `AssertionError` with `actual = last`; without `last` → `Error("expect(locator).<name>: could not read <selector> within <timeout>ms")`. `resolveTimeout` moves from `expect.ts` to `wait-until.ts`. The existing `expect` tests must pass unchanged.

### `src/locator/element-state.ts` (new) — browser-side probe

```ts
export interface ElementBox { x: number; y: number; width: number; height: number } // viewport coords
export interface ElementState {
  attached: boolean;
  visible: boolean;
  enabled: boolean;
  editable: boolean;
  box: ElementBox | null;            // after any scroll; null when not attached
  hitTarget: "self" | string | null; // "self", a description of the covering element, or null when not checked / not attached
}
export interface ProbeOptions { scroll: boolean; hitTest: boolean }

export function elementStateScript(elementExpression: string, options: ProbeOptions): string;
export function parseElementState(value: RemoteValue): ElementState;
```

One `script.evaluate` per poll returns the whole state as a JSON string (parsed by `parseElementState`, which throws on a malformed result).

Check definitions (browser side):

| Check | Definition |
|---|---|
| attached | the xpath matches an element |
| visible | box width and height > 0 and computed style not `display:none`, `visibility:hidden`, `opacity:"0"` (same rule as `isVisible()`) |
| enabled | `!el.matches(":disabled")` and `el.getAttribute("aria-disabled") !== "true"` |
| editable | enabled, and not `el.readOnly`, and (a text-type `<input>` — type in text, search, email, url, tel, password, number, or missing — or `<textarea>` or `el.isContentEditable`) |
| stable | computed in Node: `box` equal (all four numbers) to the previous poll's `box`, both non-null |
| hit target | with `hitTest`: `document.elementFromPoint(centerX, centerY)` is `el` or `el.contains(it)` → `"self"`; otherwise a description `tag#id.class1.class2` of the topmost element (`"nothing"` when `elementFromPoint` returns null) |

Scrolling: with `scroll`, when attached and the box is not fully inside the viewport, call `el.scrollIntoView({ block: "center", inline: "center" })` before measuring `box` and hit target.

### `src/locator/locator.ts` changes

```ts
export interface ActionOptions { timeout?: number; force?: boolean }
export type WaitForState = "attached" | "detached" | "visible" | "hidden";

click(options?: ActionOptions): Promise<void>;
fill(value: string, options?: ActionOptions): Promise<void>;
focus(options?: ActionOptions): Promise<void>;
waitFor(options?: { state?: WaitForState; timeout?: number }): Promise<void>; // state default "visible"
isEnabled(): Promise<boolean>;   // instant; false when missing
isEditable(): Promise<boolean>;  // instant; false when missing
```

- `click()` and `focus()` now return `Promise<void>` (previously leaked the raw BiDi `RemoteValue`).
- `clickRect(rect)` stays public and unchanged.
- The actions click with real BiDi pointer input at the centre of the **latest** measured box.

### `src/locator/action-timeout-error.ts` (new)

```ts
export class ActionTimeoutError extends Error {
  readonly action: string;             // "click" | "fill" | "focus" | "waitFor"
  readonly selector: string;
  readonly timeout: number;
  readonly checks: Record<string, "pass" | "fail" | "pending"> | undefined;
  readonly coveredBy: string | undefined;
}
```

The runner reports it through the existing `toTestError` path as `type: "error"` (not an assertion).

## Per-action flow

Every poll is one probe round trip. Checks are evaluated in the listed order; the first failing check is the reason in the error.

| Action | Probe options | Done when | Then |
|---|---|---|---|
| `click()` | scroll, hitTest | attached, visible, stable, enabled, hit = self | pointer move/down/up at centre of latest box |
| `fill()` | scroll, hitTest | attached, visible, enabled, editable, hit = self | pointer click at centre (focus), select existing value, type (existing `fill` behaviour; `""` → Backspace) |
| `focus()` | none | attached | `el.focus()` |
| `waitFor({ state })` | none | attached: attached · detached: not attached · visible: attached and visible · hidden: not attached or not visible | resolve |

`force: true` (click, fill, focus): skip every check except *attached*; still scroll into view (click, fill) and use the real pointer.

## Errors

Timeout message, built from the last completed probe:

```
click(): //button[@type="submit"] was not actionable within 5000ms
  attached ✓  visible ✓  stable ✓  enabled ✗  hit target —
```

- Symbols: `✓` pass, `✗` fail, `—` not evaluated because an earlier check failed.
- Covered element: the hit-target entry reads `hit target ✗ (covered by div#cookie-banner.overlay)`.
- Never attached: `click(): //button[@type="submit"] was not attached within 5000ms`.
- No probe completed before the deadline: `click(): could not read //button[@type="submit"] within 5000ms`.
- `waitFor`: `waitFor(): //div[@class="spinner"] did not become hidden within 5000ms`.

Probe errors (invalid xpath, navigation destroying the execution context) are rethrown immediately.

## Timeouts

- Resolution: per-call `{ timeout }` → config `expect.timeout` → `5000` (shared with `expect` via `resolveTimeout`).
- A test timeout closes the browser; the in-flight probe then fails or never settles, and `waitUntil`'s deadline race ends the action within its own timeout.

## Behaviour changes (intended, user-visible)

- `click()` is a real pointer click (trusted events; hover/mousedown/mouseup fire) instead of the synthetic `el.click()`.
- Actions on a missing element wait up to the timeout instead of throwing immediately.
- `click()` / `focus()` resolve to `void`.

## Testing

- Unit (`npm test`, no browser):
  - `src/wait/wait-until.test.ts` — fake probes: at least one probe; probe until done; `previous` passed to `isDone`; timeout with last value; `timeout: 0` single un-raced probe; probe error rethrown without retry; never-settling probe stops at the deadline; final sleep clamped to remaining time; no leftover timers.
  - `src/locator/element-state.test.ts` — script compiles for all option combinations; embeds the element expression; `parseElementState` round-trips and rejects malformed values.
  - `src/locator/locator-actions.test.ts` — stub connector with scripted `ElementState` sequences:
    - `click()` retries through not attached → hidden → moving → disabled → covered → actionable, then sends exactly one pointer click at the latest box centre;
    - timeout error text for each failing check, covered-by, never-attached and no-probe cases;
    - `force` skips checks but still requires attached;
    - `fill()` waits for editable, then keeps the select-then-type sequence;
    - `focus()` waits for attached only;
    - `waitFor` for all four states and its error text;
    - `isEnabled()` / `isEditable()`.
  - Existing `expect` tests pass unchanged (regression net for the `waitUntil` refactor).
- Browser (opt-in, `npm run test:browser` → `tsx --test "src/**/*.browser-test.ts"`, headless Firefox; not matched by `npm test`'s `src/**/*.test.ts` glob because the suffix is `-test.ts`, not `.test.ts`):
  - Fixtures injected into a blank page via `script.evaluate` (no external site, no real form submissions): button enabled after 300 ms; overlay removed after 300 ms; element sliding for 300 ms; button below the fold; readonly input; an `opacity:0` button for `force` (not "visible" by our rule, yet still hit-testable — a truly hidden or covered element cannot receive a real pointer click, with or without `force`); an element removed after 300 ms for `waitFor({ state: "hidden" })`; disabled and covered buttons for the timeout errors.
  - The fixtures load `about:blank`, which needs `Page.navigateTo` to keep URLs that already have a scheme (today it turns any non-`http` URL into the literal `https://url`); the plan fixes that as part of the browser-test task.
  - Each asserts the action succeeds or fails with the specified message.
- TDD: each test before its implementation.
