# User prompts (`browsingContext.handleUserPrompt`) — design

Date: 2026-09-29
Status: implemented (see "Implementation notes")
Roadmap item: 7
Depends on: bidi-foundation

## Goal

`alert`, `confirm`, `prompt` and `beforeunload` dialogs must never hang a test. While a prompt is open the page's script commands can stall, which today would freeze an action until its timeout.

```ts
page.on("dialog", async (dialog) => {
  console.log(dialog.type(), dialog.message());
  await dialog.accept("Sam");          // prompt text; or dialog.dismiss()
});
```

## Non-goals

- Custom dialogs (HTML `<dialog>`), which are just DOM.
- Permission prompts and HTTP auth dialogs (interception spec handles `authRequired`).

## Components

### Session capability

`Browser.launch` sends `session.new { capabilities: { alwaysMatch: { unhandledPromptBehavior: { default: "ignore" } } } }`. With `ignore` the browser leaves the prompt open, fires `browsingContext.userPromptOpened`, and waits for `handleUserPrompt`. That is the only setting that lets the framework decide per prompt. (Verified against Firefox in the browser test; if Firefox ignores the capability the test fails, and the spec falls back to per-user-context `createUserContext { unhandledPromptBehavior }`.)

### `src/browser/dialog.ts` (new)

```ts
class Dialog {
  type(): "alert" | "confirm" | "prompt" | "beforeunload";
  message(): string;
  defaultValue(): string;                       // "" unless a prompt
  accept(promptText?: string): Promise<void>;   // handleUserPrompt { accept: true, userText }
  dismiss(): Promise<void>;                     // handleUserPrompt { accept: false }
  readonly closed: Promise<{ accepted: boolean; userText?: string }>; // resolves on userPromptClosed
}
```

`accept`/`dismiss` may be called once; a second call throws `Error("dialog already handled")`. `no such alert` from the browser (closed by navigation or another handler) is swallowed with a debug log because the outcome the caller wanted (dialog gone) is true.

### `Page` integration

- `page.on("dialog", handler)` / `page.off` / `page.once`. Subscribes (refcounted) to `userPromptOpened` and `userPromptClosed`, filtered by `ContextTree.isWithin`.
- Always subscribed from page creation (as a `Page` internal listener) so the default policy below works even with no user handler.
- Dispatch: on `userPromptOpened`, call every registered handler (awaited concurrently). After they settle, if the prompt is still open (`Dialog` not handled), apply the default policy.
- **Default policy (no listener, or listeners left it open):** `beforeunload` → accept (so navigation proceeds), everything else → dismiss. Log a `warn`: `Dialog "<message>" was dismissed automatically; add page.on("dialog") to handle it`. Handler exceptions are logged and also trigger the default policy so the test does not hang.
- While a prompt is open, `waitUntil` probes still race their deadline (auto-wait spec), so a stalled `callFunction` fails at its own timeout instead of hanging; the default policy normally closes the prompt within a tick, unblocking it.

## Errors

| Situation | Behaviour |
|---|---|
| Handler throws | logged; default policy applied; the test does not fail by itself |
| `accept()` after handled | `Error("dialog already handled")` |
| Prompt disappeared | swallowed (`no such alert`) |

## Testing

- Unit (stub connector): capability sent in `session.new`; `alert` with no listener dismissed + warning; `beforeunload` accepted; listener `accept("x")` sends `userText`; double-handle throws; handler throws → default policy; prompt from an iframe context handled, from an unrelated context ignored; `closed` resolves from `userPromptClosed`.
- Browser: page with buttons for `alert`, `confirm`, `prompt` and a `beforeunload` handler; `confirm` accepted returns `true` to the page, dismissed returns `false`; `prompt` text reaches the page; unhandled `alert` on click does not hang the click; navigating away from a `beforeunload` page completes.
- TDD: tests first.

## Implementation notes

- **Where:** `browser/dialog.ts` (`Dialog`), `Page.on/once/off("dialog")` (the event methods now cover `PageEventName`: network events and `dialog`), `Page.startDialogHandling()`, `SESSION_CAPABILITIES` exported from `browser/browser.ts` and sent with `session.new`. `Browser.launch` and `Browser.newPage` start dialog handling next to network tracking; `page.on("dialog")` starts it for a page built by hand.
- **Verified in Firefox 153:** `unhandledPromptBehavior: { default: "ignore" }` leaves the dialog open and the browser reports `userPromptOpened` (with `handler: "ignore"`) for `alert`, `confirm`, `prompt` and, after a user gesture, `beforeunload`, so the per-user-context fallback from the draft was not needed. The page stays blocked in `alert()` until the dialog is answered.
- **Answering:** always through the page's top-level context (`handleUserPrompt` needs it), also for a prompt an iframe opened. Prompts of other pages are ignored (`ContextTree`).
- **`Dialog`:** `type()`, `message()`, `defaultValue()` (empty unless a prompt), `accept(text?)`, `dismiss()`, `handled`, `closed`. One answer only, a second call throws `dialog already handled`; `no such alert` is swallowed, other errors reach the caller. When the browser has already answered (`handler` is not `ignore`) the dialog starts as handled and listeners are still told.
- **Default policy:** after all `dialog` listeners settled, a dialog still open is answered: `beforeunload` accepted, everything else dismissed, with a `warn` log `Dialog "<message>" was dismissed automatically; add page.on("dialog") to handle it`. A listener that throws is logged and the default applies. Listeners run concurrently and are awaited, so an async listener may answer late.
- **`once` listeners** are called through `EventEmitter.rawListeners()`: `listeners()` returns the unwrapped function and a `once` listener would never remove itself.
- Tests: `browser/dialog.test.ts`, `browser/dialog.browser-test.ts` (port 9239: alert holds the page, confirm true/false, prompt text and default, dismissed prompt is null, `closed`, an unhandled alert on a click does not hang, iframe alert, `beforeunload` accepted).
