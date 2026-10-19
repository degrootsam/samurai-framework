# Samurai framework

A TypeScript browser test framework over WebDriver BiDi (Firefox natively, Chrome through chromedriver). Layout, conventions and the tidiness checks are in [docs/contributing.md](docs/contributing.md). The user guides live in the [wiki](https://github.com/degrootsam/samurai-framework/wiki), not in this repository.

## Commands

| Command                                                     | Does                                                                        |
| ----------------------------------------------------------- | --------------------------------------------------------------------------- |
| `npx tsc --noEmit --noUnusedLocals`                         | Typecheck, including unused locals                                          |
| `npm test`                                                  | Unit tests (no browser)                                                     |
| `npm run build` then `npm run test:cli`                     | Compile to `dist/`, then test the `samurai` command                         |
| `npm run test:browser` / `npm run test:browser:chrome`      | Browser tests on Firefox / Chrome (run one after the other, never together) |
| `npx knip --no-config-hints` and `npx madge --circular src` | Unused code, import loops                                                   |

Browser tests share a lock, ports and browser profiles: wrap them in `flock /tmp/claude-1000/browser.lock` (any path works, but use one) and kill leftover `chromedriver-linux64` and `chrome-linux64/chrome` processes first.

## Work order

Follow these steps, in order, for any change of size. Skip one only when the change is trivial, and say which.

1. **Look before proposing.** Read the code the change touches (grep for globals, shared state, callers). Never design from memory.
2. **Discuss when the choice is the owner's.** Behaviour, public API, defaults and breaking changes go to the owner as a question with 2-4 options, the recommended one first, each with its trade-off. Decide everything else with a sensible default and say so. Once the owner says "start", do not ask whether to proceed.
3. **Spec, then plan, both local.** `docs/superpowers/specs/<date>-<topic>-design.md` (goal, decisions and who made them, design, out of scope, risks), then `docs/superpowers/plans/<date>-<topic>-plan.md` (global constraints, task order, tasks as checkboxes, tests first, one commit per task, review focus). That folder is git-ignored and never committed. For a big change the owner approves the spec before the plan.
4. **Branch from an up-to-date `main`.** Names: `feat/…`, `fix/…`, `refactor/…`, `chore/…`, `docs/…`. Stack on an open PR only when the change needs that PR's code, and say so in the PR body (base branch, retarget note).
5. **Interfaces first, then parallel work.** Do the task that defines the shared interface first and commit it. Then give disjoint areas to parallel helpers (sub-agents). Each gets: the plan task, the exact signatures it must honour, the files it owns, the files it must not touch, "edit files only, no git commands that change state, run prettier only on files you edited", "tests first", and the exact reply format.
6. **Verify yourself, never trust a helper's report alone.** Run, in this order: typecheck, `npm test`, build, `npm run test:cli`, knip, madge, then both browser suites. Investigate a red test alone before calling it flaky: most cascades come from one hung test, a shared profile or another helper's unfinished edit.
7. **Commit per task, with explicit paths.** More than one session may share this working tree: look at `git status` and `git reflog` first, stage named paths (not `git add -A` at the root), and leave changes you did not make alone (mention them). Conventional prefix (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, `test:`), `!` for a breaking change. The pre-commit hook formats staged files: commit what it formats.
8. **Docs and version belong to the change.** A user-facing change updates the matching wiki page, the Roadmap page and, for anything breaking, an "Upgrading to X" note; bump `package.json` (minor for a feature or a changed default, patch for a fix) only if the owner's flow does, because another session may bump it too.
9. **Push and open the PR against the right base.** Body: Summary (what and why), Breaking change (when there is one, with the escape hatch), Test plan as checkboxes with real counts. Pushing a branch and opening a PR is part of "commit and open a PR". Anything outward-facing beyond that (the public wiki, a release, a publish) needs an explicit yes.
10. **Check CI, then report.** `gh pr checks <n>` on every open PR. The final report says: what changed, check results with numbers, what is untested or open (honestly), the merge order when PRs are stacked, and what the owner has to do elsewhere (for example in the Electron app, a separate repository).

## Facts that are easy to get wrong

- `test()` starts running as soon as it is registered: top-level awaits between registrations race with it.
- Public methods throw `name(): what is wrong` (lower-case, no `page.` prefix, no trailing full stop). State messages (`page closed`) and fixed-format error classes keep their form.
- `workers` runs tests in child processes; a config passed as an object (not `samurai.config.ts` in the project folder) stays on one worker.
- `docs/superpowers/` is local only. Do not link to it from the repository or the wiki.
