# `script.callFunction` — design

Date: 2026-09-29
Status: implemented (see "Implementation notes")
Roadmap item: 1 (with `script.disown`)
Depends on: bidi-foundation

## Goal

Replace string-built `script.evaluate` expressions with typed function calls. Arguments are serialized by the protocol (no JSON-in-JS-string escaping), elements travel as `SharedReference`s, and return values are deserialized to plain JS.

```ts
// before (locator.ts): xpath embedded via JSON.stringify inside a source string
await this.evaluate(`document.evaluate(${JSON.stringify(xpath)}, …).singleNodeValue.focus()`);

// after
await script.call(target, (xpath) => { … }, [xpath]);
```

## Non-goals

- Public `page.evaluate` (a later, tiny follow-up on top of this module).
- Changing what the actionability probe checks.
- Sandboxed realms (preload-scripts spec).

## Components

### `src/script/serialize.ts` (new)

```ts
export type Arg = unknown | ElementHandle;
export function toLocalValue(value: Arg): LocalValue;
export function fromRemoteValue(value: RemoteValue): unknown;
```

`toLocalValue` mapping: `undefined`/`null`/boolean/string → primitive types; number incl. `NaN`, `Infinity`, `-Infinity`, `-0` via the special-number form; `bigint`; `Date` → `date`; `RegExp` → `regexp`; `Array` → `array`; `Map` → `map`; `Set` → `set`; plain object → `object` (entries); `ElementHandle` → `{ sharedId, handle? }` reference; functions and symbols throw `TypeError("cannot serialize <type>")`. Cycles throw `TypeError` (depth cap 100 as a second guard).

`fromRemoteValue` is the inverse for `RemoteValue` (`node` → `ElementHandle`, `window`/`function`/`error`/`promise` etc. → an opaque `RemoteObject` with `type` and `handle`; `error` → `Error` with the remote message).

### `src/script/element-handle.ts` (new)

```ts
export class ElementHandle { readonly sharedId: string; readonly handle?: string; }
```

Node values returned by `callFunction` become `ElementHandle`s. A `sharedId` stays valid across scripts within the same document, also after the node was removed from the DOM (Firefox keeps a detached node resolvable while it is alive); after a navigation to another document the browser answers `no such node`. `ElementHandle` is internal; user code keeps using `Locator`.

### `src/script/call-function.ts` (new)

```ts
export interface CallOptions {
  awaitPromise?: boolean;            // default true
  ownership?: "none" | "root";       // default "none"; "root" keeps a handle alive until disown
  sandbox?: string;                  // realm sandbox name (preload-scripts spec)
  thisArg?: Arg;
}
export async function callFunction<T = unknown>(
  connector: BiDiConnector,
  context: string,
  fn: string | ((...args: any[]) => unknown),
  args?: Arg[],
  options?: CallOptions,
): Promise<T>;
export async function disown(connector, context, handles: string[]): Promise<void>;
```

- `fn` string is used as-is as `functionDeclaration`. `fn` function is `fn.toString()`.
- Function-form caveat: `tsx`/esbuild may wrap named functions with a `__name(...)` helper that does not exist in the page. `callFunction` throws `ScriptSerializationError` if the source contains `__name(`, telling the caller to use an arrow function without a name or the string form. A unit test runs under `tsx` to lock this behaviour.
- `exception` results throw `ScriptError` (`message`, `text`, `stackTrace`, `functionSource` trimmed to 200 chars).
- `type: "success"` returns `fromRemoteValue(result)`.
- `awaitPromise: true` is safe for sync functions and required for async ones; the auto-wait probes pass `false`.
- With `ownership: "root"` the caller receives `RemoteObject.handle` and is responsible for `disown`; `disown` swallows `no such handle`.

### Locator migration (`src/locator/*`)

- `elementStateScript(expression, options)` becomes `probeElement(xpath: string, options: ProbeOptions)`, a function declaration executed via `callFunction`. The xpath is an argument, so `JSON.stringify` embedding disappears. `parseElementState` becomes a type guard over the returned object (no JSON string round trip).
- `Locator.evaluate(expression)` is replaced by `Locator.call(fn, args)`, which resolves the element inside the function (`document.evaluate(xpath…)`) until locate-nodes lands.
- Every existing action keeps its observable behaviour and error messages. `ScriptError` from the probe becomes the existing `Failed to locate element <xpath>. Details: …` message.

## Errors

| Situation | Error |
|---|---|
| Un-serializable argument | `TypeError` before anything is sent |
| Function throws in page | `ScriptError` |
| `no such node` from a `sharedId` of a previous document | `BiDiError` (callers such as `Locator` catch and re-resolve) |
| `__name(` in function source | `ScriptSerializationError` |

## Testing

- Unit: `toLocalValue`/`fromRemoteValue` round trip for every mapped type, special numbers, nested structures, cycles, unsupported types. `callFunction` with the stub connector: payload shape (`functionDeclaration`, `arguments`, `target`, `awaitPromise`, `resultOwnership`, `this`), exception mapping, `__name(` guard.
- The full existing locator/expect unit suite passes unchanged (regression net for the migration).
- Browser: xpath containing `"`, `'`, `\` and a newline is located without escaping issues (previously a risk class); a `Map`/`Date` argument round trips; `ownership: "root"` handle then `disown` succeeds, second `disown` is silent; a removed node stays usable, and a `sharedId` from before a navigation yields `no such node`.
- TDD: tests first.

## Implementation notes

Deviations and details settled while implementing:

- `fromRemoteValue` maps `error` to an opaque `RemoteObject` (the protocol's `ErrorRemoteValue` carries no message); `internalId` back references are resolved, so cyclic remote objects come back as cyclic JS objects. Values cut off by the serialization depth also become `RemoteObject`s.
- With `ownership: "root"` results that carry a handle come back as `RemoteObject { type, handle, value }` (`value` = the deserialized copy), so the caller can `disown(handle)`. With `"none"` the plain value is returned.
- `toLocalValue` accepts only plain objects (prototype `Object.prototype` or `null`), arrays, `Map`, `Set`, `Date`, `RegExp`, primitives and `ElementHandle`; class instances, `Buffer`, functions and symbols throw `TypeError`.
- The actionability probe is one constant `PROBE_ELEMENT` (a function declaration string) called as `(xpath, options)`; both xpath and `{ scroll, hitTest }` are arguments. It returns a plain object, so `parseElementState` is a check over `unknown` (JSON round trip gone).
- `Locator` has `call` / `callOnElement`; other reads pass what they need (`getAttribute` passes the attribute name, `count` passes `count(<xpath>)`) as arguments too. A `ScriptError` becomes the existing `Failed to locate element <xpath>. Details: <text>` message.
- `getBoundingClientRect` now returns the object directly (was a JSON string).
- The stub connector answers `script.callFunction` like `script.evaluate`, records `calls` (declaration + decoded arguments) and exposes `remote()` to build object results. Tests that looked at expression text for `scrollIntoView` / `elementFromPoint` / `getAttribute("href")` now assert on the arguments instead; all other locator and expect tests are unchanged.
- Tests: `script/{serialize,call-function}.test.ts`, `script/call-function.browser-test.ts` (real Firefox, port 9233).
