<!-- markdownlint-disable MD041 -->

An AI agent that writes a test for you. You describe a goal; the agent drives a real browser, explains what it does, asks when it is unsure, and leaves a normal spec file made of the same typed steps a recording produces. The result is a `.spec.ts` that the [step codec](Steps-and-the-recorder#steps) reads and edits like any other.

> **Status: in development.** The page snapshot and the tools described below exist in the package. The loop that connects them to a model, the session controls and the `samurai generate` command are **not built yet**. This page says which is which.

## What it is

- It lives in its own entry point, `@itmetsam/samurai-framework/agent`. Nothing else in the framework loads it.
- **You bring the model.** The agent never builds a provider and never asks for a key. It takes a model object from an [AI SDK](https://ai-sdk.dev) provider package that you install (`@ai-sdk/anthropic`, `@ai-sdk/openai`, an OpenAI-compatible endpoint such as Ollama or LM Studio).
- It needs `ai` (version 7) and `zod` next to the framework. They are **optional peer dependencies**: a project that only runs tests installs nothing new, and importing `@itmetsam/samurai-framework` never loads them.

```bash
npm install ai zod @ai-sdk/anthropic   # or the provider you use
```

## The model is an object, never a string

The entry accepts only a model object. A bare string such as `"anthropic/claude-sonnet-4"` is refused: in the AI SDK a string resolves through the Vercel AI Gateway, a third party you did not choose, which would receive the page content. The error says so:

```text
agent(): model must be a model object from a provider package, not the string "..." (a string id would send the page through the Vercel AI Gateway). Install the provider (for example @ai-sdk/anthropic) and pass anthropic("model-name")
```

## Limits

A run has hard limits, and reaching one ends it cleanly with the steps written so far. The defaults are 40 model calls, 400 000 tokens and 10 minutes; each can be changed per run (`DEFAULT_LIMITS` and `resolveLimits` are exported). _The loop that enforces them is not built yet._

## The page, as the agent sees it

The agent reads the page as compact text, not as HTML. Each element it can act on or check gets a short reference:

```text
url: https://shop.example/login
title: Sign in
[e1] heading "Sign in" level=1
[e2] textbox "Email" value="ann@example.com"
[e3] textbox "Password" value="••••"
[e4] checkbox "Remember me" unchecked
[e5] button "Sign in"
[e6] button "Cancel" disabled
```

The names come from the same role and accessible-name engine as `getByRole`. Hidden elements are left out. A reference stays the same for an element while it lives and is valid until the next snapshot; a reference that is unknown, was in an earlier snapshot, or points at an element that was removed is an error that says which and what to do. A long page is cut at a size cap with a marker that says how much is missing.

**Secrets are masked in the page itself.** Password inputs, one-time-code and card fields, and any field you mark with a CSS selector show `••••` instead of their value; the value never leaves the page.

## The tools

The agent has these tools and nothing else; none of them reaches anything but the browser, the spec file and the person.

| Tool         | Does                                                                                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `snapshot`   | The page as text with references (above).                                                                                                                                 |
| `navigate`   | Opens a URL or a path. Only the start page's origin is allowed; any other origin asks the person, and a refusal leaves the page where it was. Only `http` and `https`.    |
| `act`        | `click`, `fill`, `select`, `check`, `uncheck`, `hover`, `dblclick`, `clear` or `press` on a reference.                                                                    |
| `expect`     | A check on a reference, or on the page (`toHaveURL`, `toHaveTitle`). Only matchers the step codec types. It runs on the live page first; a check that fails is not added. |
| `screenshot` | An image for a model that takes images. Not added to the test.                                                                                                            |
| `useSecret`  | Types a secret into the focused field. See below.                                                                                                                         |
| `ask`        | Asks the person a question and waits. The only way to get what the agent does not know.                                                                                   |
| `finish`     | Ends the run with a summary.                                                                                                                                              |

Every tool checks its arguments and answers with a message the model can act on (`act(): fill needs a value: the text to type`). A failing action is an answer, not a crash.

## Steps are written like a recording

`act`, `expect` and `navigate` write typed steps through the same path the [recorder](Steps-and-the-recorder#recording) uses, so:

- the locator is the best one the recorder would pick (test id, role and name, label, text, CSS, with fallbacks), not something the model typed;
- a step is written **only after the action worked**, one edit at a time, so the spec file is valid after every call and stopping at any moment leaves a usable test;
- the agent cannot write a `custom` statement: there is no tool for it.

## Safety rules

- **The agent sees secret names, never values.** `useSecret(NAME)` fills the focused field with `secrets.NAME`, resolved locally, only for the secrets you allowed, and the spec gets `fill(secrets.NAME)`. The value is not in any tool result or event (and is masked if it shows up anywhere).
- **Secret fields are read-only to the model.** It cannot `fill` a password or a field you marked secret with text of its own, and it can only check their state (`toBeVisible`, `toBeEnabled`, ...), not their value.
- **Screenshots are switched off for a run** once a secret was typed into a field the page shows in plain text, because the image would show it. Text snapshots keep working.
- **Page text is data.** A page can still mislead the agent's choices, which is why the result is a spec you review, not an action taken for real on its own.
- **Origins.** Navigation outside the allowed origins needs the person's yes. (Links the page itself follows are not checked yet.)
- **No telemetry, no gateway.** The page goes to the provider you chose and nowhere else.

## Not built yet

- The loop that runs the model against these tools, the events (`plan`, `tool-call`, `step`, `question`, `usage`, `ended`) and the session controls (pause, take over, stop). The types are exported; the function that uses them is not.
- Project instructions (`.samurai/agent.md`, `AGENTS.md`) and the built-in system prompt.
- `samurai generate` on the command line.
- Running the finished test once and repairing what fails; multi-tab and iframe flows; file upload steps.
