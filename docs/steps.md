# Writing a step

A flow step is one node with one way in and one way out. You describe it once with
`defineStep`: its fields (how the SAMURAI app's inspector looks), and `run` (what it does in a
flow). Start, End, Test, Group, Condition and Parallel are closed: steps can't replace them or
branch.

```ts
import { defineStep } from "@itmetsam/samurai-framework/flows/steps";

export const api = defineStep({
  kind: "api",
  label: "HTTP request",
  icon: "globe",
  section: "integrations",
  fields: [
    { path: "config.method", type: "select", label: "Method", options: METHODS, default: "GET" },
    { path: "config.url", type: "expression", label: "URL", default: "" },
    { path: "config.body", type: "code", label: "Body", default: "" },
  ],
  summary: "{config.method} {config.url}",
  outputs: [{ name: "statusCode" }, { name: "body" }],
  async run({ config, signal }) {
    const res = await fetch(String(config.url), { method: config.method, signal });
    return { outputs: { statusCode: res.status, body: await res.text() } };
  },
});
```

## Properties

| Property | Meaning |
| --- | --- |
| `kind` | Stored in flow files. Lowercase letters, digits and `-`; not a closed kind |
| `label` | Name in the library and in messages; the default title |
| `icon` | A design-system icon name (unknown names show a square) |
| `section` | `"control"` or `"integrations"` |
| `fields` | `config.*` fields: `text`, `code`, `expression`, `number`, `select`, `segmented`, `switch`. Title and Description are added for you |
| `summary` | The line under the title; `{config.x}` is the field's value |
| `outputs` | Names `run` returns; later nodes read them as `nodes.<key>.<name>`. Not `status`, `durationMs` or `error` |
| `writesVar` | The path of the field that holds a variable name; `run` may then return `vars: { [name]: value }` |
| `validate` | Optional `(node, ctx) => problems`, for checks the field rules can't express |
| `run` | Return `{ outputs?, vars?, note? }` (or nothing) to pass; throw to fail |

Field rules: `required`, `min`/`max` (numbers), `pattern` and `patternMessage` (text).

## What `run` gets

`config` (defaults filled in; `expression` fields already evaluated), `env`, `vars` (copies),
`node` (`id`, `key`, `title`), `signal` (aborted on Stop), `sleep(ms)` and `log(level, text)`.
Pass `signal` to anything that can take long; a step that ignores it is cut off on Stop anyway.

## HTTP request

Any response passes, with its status in `nodes.<key>.statusCode`: decide on it with a Condition.
A network error, a bad URL or a stop fails or cancels the node.
