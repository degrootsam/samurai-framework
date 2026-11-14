# Samurai framework

A TypeScript browser test framework over WebDriver BiDi (Firefox natively, Chrome through chromedriver). Layout, conventions and the tidiness checks are in [docs/contributing.md](docs/contributing.md). The user guides live in [wiki/](wiki/Home.md) (published as the [public wiki](https://github.com/degrootsam/samurai-framework/wiki) at each release).

## Commands

Run a script with `bun run <script>` in `packages/framework` (`bun run test-browser`), or as an Nx target with `bunx nx run framework:<script>` from the repository root (`bunx nx run framework:test-browser`; Nx also builds what the target depends on, such as `build` before `test` and `test-cli`, and caches the result).

| Script                                 | Does                                                                        |
| -------------------------------------- | --------------------------------------------------------------------------- |
| `typecheck`                            | Typecheck, including unused locals                                          |
| `test`                                 | Unit tests (no browser; the `flows/core` bundle test needs a build first)   |
| `build` then `test-cli`                | Compile to `dist/`, then test the `samurai` command                         |
| `build-watch`                          | Compile to `dist/` on every change (keeps running)                          |
| `test-browser` / `test-browser-chrome` | Browser tests on Firefox / Chrome (run one after the other, never together) |
| `knip` and `madge`                     | Unused code, import loops                                                   |

Run the tests through these scripts (or their Nx targets): they preload `scripts/test-tmp.mjs`, which gives each test process a private temp folder and removes it afterwards. Tests make temp projects (with browser profiles of up to 100 MB) and `/tmp` can be memory, so a bare `tsx --test` leaves them behind and can fill RAM over days.

Browser tests share a lock, ports and browser profiles: wrap them in `flock /tmp/claude-1000/browser.lock` (any path works, but use one; macOS has no `flock`, use `lockf` on the same file) and kill leftover `chromedriver-linux64` and `chrome-linux64/chrome` processes first.

## Work order

Follow these steps, in order, for any change of size. Skip one only when the change is trivial, and say which.

1. **Look before proposing.** Read the code the change touches (grep for globals, shared state, callers). Never design from memory.
2. **Discuss when the choice is the owner's.** Behaviour, public API, defaults and breaking changes go to the owner as a question with 2-4 options, the recommended one first, each with its trade-off. Decide everything else with a sensible default and say so. Once the owner says "start", do not ask whether to proceed.
3. **Spec, then plan, both local.** `docs/superpowers/specs/<date>-<topic>-design.md` (goal, decisions and who made them, design, out of scope, risks), then `docs/superpowers/plans/<date>-<topic>-plan.md` (global constraints, task order, tasks as checkboxes, tests first, one commit per task, review focus). That folder is git-ignored: the design history already in it is tracked, but a new spec or plan stays local unless it is force-added (`git add -f`) on purpose. For a big change the owner approves the spec before the plan.
4. **Branch from an up-to-date `main`.** Names: `feat/…`, `fix/…`, `refactor/…`, `chore/…`, `docs/…`. Stack on an open merge request only when the change needs that merge request's code, and say so in the merge request body (base branch, retarget note).
5. **Interfaces first, then parallel work.** Do the task that defines the shared interface first and commit it. Then give disjoint areas to parallel helpers (sub-agents). Each gets: the plan task, the exact signatures it must honour, the files it owns, the files it must not touch, "edit files only, no git commands that change state, run prettier only on files you edited", "tests first", and the exact reply format.
6. **Verify yourself, never trust a helper's report alone.** Run, in this order: `typecheck`, `test`, `build`, `test-cli`, `knip`, `madge` (the size and import rules above), then both browser suites. Check the line count of every file you grew (`wc -l`). Investigate a red test alone before calling it flaky: most cascades come from one hung test, a shared profile or another helper's unfinished edit.
7. **Commit per task, with explicit paths.** More than one session may share this working tree: look at `git status` and `git reflog` first, stage named paths (not `git add -A` at the root), and leave changes you did not make alone (mention them). Conventional prefix (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, `test:`), optional scope (`fix(framework):`), `!` for a breaking change; the root `commitlint.config.mjs` checks the message (commit-msg hook and CI). The Trunk pre-commit hook (root `.trunk/trunk.yaml`) formats staged files: commit what it formats.
8. **Docs and version belong to the change.** A user-facing change updates the matching page in `wiki/`, the Roadmap page and, for anything breaking, an "Upgrading to X" note; never bump `package.json` by hand: `nx release` picks the version from the conventional commit messages (see Releasing), so get the prefix (and `!`) right.
9. **Push and open the merge request against the right base.** Body: Summary (what and why), Breaking change (when there is one, with the escape hatch), Test plan as checkboxes with real counts. Pushing a branch and opening a merge request is part of "commit and open a merge request". Anything outward-facing beyond that (a release, a publish, and the wiki sync that a release tag triggers) needs an explicit yes.
10. **Check CI, then report.** `glab ci status` (and `glab mr view <n>`) on every open merge request. The final report says: what changed, check results with numbers, what is untested or open (honestly), the merge order when merge requests are stacked, and what the owner has to do elsewhere (for example in the Electron app, `apps/desktop` in this repository).

## Releasing

Releasing is the owner's call: only on an explicit yes. From an up-to-date `main`, at the repository root:

```bash
bunx nx release --projects=framework --skip-publish --dry-run   # review versions, CHANGELOG.md entries, tags, commit message
bunx nx release --projects=framework --skip-publish             # bump, CHANGELOG.md, commit, tag framework@x.y.z, push, GitLab release
git push --follow-tags                     # only if nx release's own push failed
# approve the staged version on npmjs.com (2FA), then:
npm view @itmetsam/samurai-framework dist-tags
```

- Versions come from the conventional commits since the last `framework@*` tag. Before 1.0: `fix` and `feat` bump the patch, `!` or `BREAKING CHANGE` the minor. Always pass `--projects=framework`: a bare `nx release` also releases the other projects of the monorepo.
- `nx release` pushes the release commit and tags itself (it has to, to create the release; it needs `GITLAB_TOKEN`, a personal access token with the `api` scope, in your environment). The pushed tag runs the `publish` job of the monorepo's CI, which **stages** the version on npm (`npm stage publish`, with a granular token that can only stage). It is not installable until the owner approves it with 2FA: on npmjs.com, avatar menu, Staged Packages, Approve (or `npm stage list @itmetsam/samurai-framework`, then `npm stage approve <stage-id>`; the job's log prints the id). The dist-tag (`latest` or `next`) is fixed when staging and applied on approval. Afterwards check `npm view @itmetsam/samurai-framework dist-tags` and the release.
- Previews: `bunx nx release prerelease --preid next --projects=framework --skip-publish` tags `x.y.z-next.n`, which goes out on the `next` dist-tag. Never put a preview on `latest`: the app's "update framework" installs `@latest`. (`nx release version` alone refuses this repo's `release.git` config, so use the full command.)
- First release after the monorepo import only: pass the bump (`bunx nx release patch --projects=framework --skip-publish`). The history since the baseline tag includes the app's pre-import commits, which Nx counts as breaking.
- `bun.lock` keeps the old workspace version (bun 1.3 doesn't rewrite it). That's harmless; `bun install --frozen-lockfile` still passes.
- To rehearse the publish: in the CI, Run pipeline on `main` with `PUBLISH_TAG` set to the tag and `PUBLISH_DRY_RUN` true. It packs `main`'s tree (`npm stage publish --dry-run`) and uploads nothing. Only `main` and the protected release tags can read the npm token.
- To retry a failed publish: in the CI, Run pipeline on `main` with `PUBLISH_TAG` set to the tag and `PUBLISH_DRY_RUN` false. It checks out the tag and stages it; then approve it as above. A version that is already staged or published ends with a notice, not a failure.

## Size and modularity

The cleanup review (three phases, PRs #31 to #40) set these rules; they hold for every change, new code included. Details and the dependency table are in [docs/contributing.md](docs/contributing.md).

- **A file does one job.** Past about 400 lines of code, or a function past about 60, look for the seam and split before adding more. The line count is for code only: doc comments and blank lines do not count, and test files are not counted at all. No file is allowed to grow into the next `page.ts` (it was 1742 lines, now 795).
- **Public classes stay thin facades.** `Page`, `Locator`, `Browser`, `Router`, `Recorder` keep their public methods as one-line delegations to small modules next to them (`page-navigation.ts`, `chain-resolver.ts`, `intercept.ts`, ...). New behaviour goes into such a module, not into the facade. When a split changes the picture, update the "Where the big classes live" table in `docs/contributing.md`.
- **Move first, rewrite never.** A split moves code unchanged into the new file (tests move with it), then small cleanups go into a separate commit. The public API and every name behind a `package.json` export stay as they are.
- **Folders depend downwards.** Follow the folder dependency table in `docs/contributing.md`: `config/` does not import `runner/`, `transport/` knows nothing of pages or locators, `flows/core` is pure (no Node APIs). `src/cli` imports only package entry points (`src/cli/boundary.test.ts` fails otherwise): export what the command needs from an entry point first.
- **No import loops, no unused code.** `bun run madge` must report none (type-only imports and the generated BiDi `.d.ts` files are ignored by `.madgerc`); `bun run knip` must be clean. Delete dead code instead of keeping it "for later". Break a value cycle with a dynamic `import()` (as `Page.record` does) or by moving the shared piece down, not by suppressing the check.
- **One copy of everything.** Before adding a helper, grep for an existing one (`isUnsupported`, `emitSafely`, `Lazy<T>`, `navigationTimeout()`, `DEFAULT_PORT`, the ANSI painter). Types shared by two folders live in a shared module, not in either folder.
- **Comments and names match the surrounding code.** No stale comments (a comment that describes removed behaviour is a bug), no `export` for something used only in its own file.

## Facts that are easy to get wrong

- `test()` starts running as soon as it is registered: top-level awaits between registrations race with it.
- Public methods throw `name(): what is wrong` (lower-case, no `page.` prefix, no trailing full stop). State messages (`page closed`) and fixed-format error classes keep their form.
- `workers` runs tests in child processes; a config passed as an object (not `samurai.config.ts` in the project folder) stays on one worker.
- New files in `docs/superpowers/` stay local (see step 3). Do not link to the folder from the repository or the wiki. The wiki folder is public (the mirror and the wiki both carry it): nothing private in it.
