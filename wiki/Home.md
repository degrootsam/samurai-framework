<!-- markdownlint-disable MD041 -->

Every guide and the code it describes. Start with the [Getting Started](Getting-started) to install and run a first test.

## Guides by topic

| Topic                      | Guide                                                        | Code                                                                     |
| -------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Tests, fixtures            | [Writing tests](Writing-tests)                               | `src/runner/registry.ts`, `src/runner/test-runner.ts`                    |
| Locators and actions       | [Locators](Locators)                                         | `src/locator/`                                                           |
| Assertions                 | [Assertions](Assertions)                                     | `src/assert/`                                                            |
| Pages, contexts, emulation | [Pages and browsers](Pages-and-browsers)                     | `src/browser/`                                                           |
| Downloaded browsers        | [Which browser runs](Pages-and-browsers#which-browser-runs)  | `src/browsers/`, `src/cli/browsers.ts`                                   |
| Network                    | [Network](Network)                                           | `src/network/`                                                           |
| Configuration              | [Configuration](Configuration)                               | `src/types/config.d.ts`, `src/config/run-settings.ts`                    |
| Environments and secrets   | [Environments and secrets](Environments-and-secrets)         | `src/config/secrets.ts`, `src/config/variables.ts`, `src/config/mask.ts` |
| Running, reports           | [Running tests and reports](Running-tests-and-reports)       | `src/runner/`                                                            |
| Command line               | [Command line](Command-line)                                 | `bin/samurai.mjs`, `src/cli/`                                            |
| Flows                      | [Flows](Flows)                                               | `src/flows/core/`, `src/flows/run/`, `src/cli/flow.ts`                   |
| Flow steps                 | [Writing a step](Writing-a-step)                             | `src/flows/steps/`                                                       |
| Step codec                 | [Steps and the recorder](Steps-and-the-recorder#steps)       | `src/steps/`                                                             |
| Recorder                   | [Steps and the recorder](Steps-and-the-recorder#recording)   | `src/recorder/`                                                          |
| Recorder toolbar           | [Steps and the recorder](Steps-and-the-recorder#the-toolbar) | `src/recorder/toolbar/`, `src/project/`                                  |
| Embedding                  | [Embedding the framework](Embedding-the-framework)           | `package.json` `exports`                                                 |
| Protocol layer             | [Contributing](Contributing)                                 | `src/transport/`, `src/script/`, `src/types/bidi-modules/`               |
| CI                         | [Contributing](Contributing)                                 | `.github/`                                                               |

## Status

- [Roadmap](Roadmap): what is built and what is open.
