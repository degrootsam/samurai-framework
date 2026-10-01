# BiDi foundation — design

Date: 2026-09-29
Status: implemented (see "Implementation notes")
Roadmap item: 0 (prerequisite of every other BiDi spec)

## Goal

Fix the transport gaps that make every later feature unreliable, and add the shared primitives (typed commands, refcounted subscriptions, event waiting, context tree) the other specs build on.

## Problems found in the current code

1. `BiDiConnector.messageListener` handles only `type: "success"` and `"event"`. A `type: "error"` reply is dropped and its promise stays in `resolveMap` forever, so a failing command hangs until some outer timeout.
2. `Browser.newPage()` sends `browsingContext.create` but returns `new Page(connector, "")`, an empty context id.
3. The subscribed events are a hardcoded list in `Browser.launch` (`["browsingContext.load"]`); `onEvent` for anything else silently never fires.
4. `Page.waitForNetworkIdle` leaks its listener and never resolves if `load` already fired (fixed properly in the network-tracking spec, but needs the primitives here).
5. `BiDiCommands` lacks most commands the other specs use (see Typing).

## Non-goals

- Multi-browser support, reconnecting after socket loss, BiDi over pipes.
- Public API for the primitives below; they are internal to `src/transport` and `src/browser`.

## Components

### Error replies — `src/transport/bidi-error.ts` (new)

```ts
export class BiDiError extends Error {
  readonly code: string;        // BiDi error code: "no such node", "invalid argument", "unknown error", …
  readonly command: string;     // e.g. "script.callFunction"
  readonly remoteStack?: string;
}
```

`messageListener` handles `{ type: "error", id, error, message, stacktrace }`: look up `id`, reject with `BiDiError`, delete the entry. `resolveMap` entries store the method name for the error. A reply with an unknown `id` is logged at debug level and ignored. `rejectAll` (socket close/error) keeps rejecting with plain errors, now including the pending method names in the message.

### Send timeout

`send(method, params, { timeout? })`: default `commandTimeout` from config (`bidi.commandTimeout`, default 30000). On expiry: delete the map entry and reject with `BiDiError` code `"timeout"`. A late reply for a deleted id is ignored. Commands known to block legitimately (`browsingContext.navigate` with `wait: "complete"`, `browsingContext.print`) pass their own timeout.

### Refcounted subscriptions — `src/transport/subscriptions.ts` (new)

```ts
connector.subscribe(events: (keyof BiDiEvents)[], options?: { contexts?: string[] }): Promise<Subscription>;
interface Subscription { readonly id: string; unsubscribe(): Promise<void> }
```

- Refcount per event name (global scope). First subscriber of an event sends `session.subscribe { events: [name] }` and stores the returned `subscription` id; last unsubscriber sends `session.unsubscribe { subscriptions: [id] }`.
- Context-scoped subscriptions send `contexts` and are not shared; they always issue their own command.
- `Browser.launch` stops subscribing to a hardcoded list; `browsingContext.load` is subscribed by the feature that needs it.
- `unsubscribe()` is idempotent.
- Module-level events (e.g. `network`) subscribe to all their events on `session.subscribe`; the connector's typed event map stays per-event.

### Event waiting

```ts
connector.waitForEvent<E extends keyof BiDiEvents>(
  event: E,
  predicate: (params: BiDiEvents[E]["params"]) => boolean,
  options: { timeout: number; signal?: AbortSignal },
): Promise<BiDiEvents[E]["params"]>;
```

Registers the listener before returning (so callers can start the triggering command afterwards without racing), removes it on match, timeout or abort. Timeout rejects with `WaitTimeoutError` (from `src/wait/wait-until.ts`).

### Context tree — `src/browser/context-tree.ts` (new)

```ts
class ContextTree {
  static create(connector): Promise<ContextTree>;  // getTree + subscribe browsingContext.contextCreated/contextDestroyed
  parentOf(context: string): string | null;
  rootOf(context: string): string;                 // the top-level context
  isWithin(context: string, root: string): boolean;
  dispose(): Promise<void>;
}
```

Events for iframes carry the child's context id; features that filter by page (`network`, `log`, prompts) call `tree.isWithin(event.context, page.contextId)`.

### `Browser.newPage` / `Page`

- `newPage` returns `new Page(connector, result.context)`. `background`/`userContext` keep passing through.
- `Page` exposes a read-only `contextId` getter (tests currently reach into private fields).
- `Page` owns a `ContextTree` instance created lazily and shared by features.

### Typing

Add to `src/types/bidi-modules/*.d.ts` and `BiDiCommands`/`BiDiEvents` (params/result per the spec), each with a one-line doc comment:

| Module | Commands |
|---|---|
| script | `callFunction`, `disown`, `addPreloadScript`, `removePreloadScript` |
| browsingContext | `locateNodes`, `handleUserPrompt`, `setViewport`, `reload`, `traverseHistory`, `close`, `print` |
| input | `setFiles` |
| network | `addIntercept`, `removeIntercept`, `continueRequest`, `continueResponse`, `continueWithAuth`, `provideResponse`, `failRequest`, `setCacheBehavior`, `addDataCollector`, `removeDataCollector`, `getData`, `disownData` |
| browser | `createUserContext`, `removeUserContext`, `getUserContexts`, `setDownloadBehavior` |
| session | `unsubscribe` |
| emulation | all `emulation.set*` (types exist; only wire into `BiDiCommands`) |

The `network` and `emulation` modules are currently missing from `BiDiCommands` entirely. A compile-time test (`src/types/bidi-commands.test-d.ts` checked by `tsc --noEmit`) asserts each method above resolves to a params/result pair.

## Errors

| Situation | Behaviour |
|---|---|
| `type:"error"` reply | reject with `BiDiError` |
| No reply within timeout | reject with `BiDiError` code `"timeout"` |
| Socket closed | reject all pending; message names the methods |
| Command not supported by the browser | `BiDiError` code `"unknown command"` / `"unsupported operation"`, unchanged (features wrap where they need friendlier text) |

## Testing

- Unit (stub connector): error reply rejects the right promise only; unknown-id reply ignored; timeout rejects and a late reply does not throw; refcount sends one `session.subscribe` for two subscribers and one `unsubscribe` after both leave; double `unsubscribe()` is a no-op; `waitForEvent` registers before resolving, cleans up on all three exits; `ContextTree` parent/root/`isWithin` including destroyed contexts.
- Browser: `newPage()` returns a page whose `navigateTo("about:blank")` works; a deliberately invalid command (`script.evaluate` with bad target) rejects with `code: "no such frame"` within a second.
- TDD: tests first.

## Implementation notes

Deviations and details settled while implementing:

- `session.unsubscribe` takes `{ subscriptions }` or `{ events }`; the connector only uses subscription ids.
- A new subscriber that arrives while the last one is still unsubscribing keeps the existing subscription (no unsubscribe/subscribe churn); the per-event command queue makes this safe.
- Multi-event `subscribe([...])` sends one `session.subscribe` per event so refcounts stay per event; a failure part-way rolls back the events already acquired.
- `commandTimeout` is a `BiDiConnector` option, read once at launch from config `bidi.commandTimeout` (a missing config falls back to 30000), instead of a config read per `send`.
- `Page.waitForNetworkIdle` now subscribes to `browsingContext.load` itself, waits with `waitForEvent` (30000 ms cap) and unsubscribes; its real replacement is the network-tracking spec.
- `Page.tree()` is the lazily created, shared `ContextTree`; nothing creates it until a feature needs it.
- Type fix: `Info.children` is `InfoList | null` (was `InfoList[]`), `parent` may be `null`, `originalOpener` may be `null`.
- `src/testing/fake-websocket.ts` (`FakeWebSocket`, `autoReply`, `tick`) is the new unit-test seam for the real connector; `stubConnector` is unchanged.
- Tests: `transport/{bidi-connection,subscriptions}.test.ts`, `browser/{context-tree,browser}.test.ts`, additions to `browser/page.test.ts`, `types/bidi-commands.test-d.ts` (compile-time, via `tsc --noEmit`), and `transport/foundation.browser-test.ts` (real Firefox).
