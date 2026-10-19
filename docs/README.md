# Documentation index

Every guide and the code it describes. Start with the [README](../README.md) to install and run a first test.

## Guides by topic

| Topic                      | Guide                                                          | Code                                                                     |
| -------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Tests, fixtures            | [Writing tests](writing-tests.md)                              | `src/runner/registry.ts`, `src/runner/test-runner.ts`                    |
| Locators and actions       | [Locators](locators.md)                                        | `src/locator/`                                                           |
| Assertions                 | [Assertions](assertions.md)                                    | `src/assert/`                                                            |
| Pages, contexts, emulation | [Pages and browsers](pages-and-browsers.md)                    | `src/browser/`                                                           |
| Downloaded browsers        | [Which browser runs](pages-and-browsers.md#which-browser-runs) | `src/browsers/`, `src/cli/browsers.ts`                                   |
| Network                    | [Network](network.md)                                          | `src/network/`                                                           |
| Configuration              | [Configuration](configuration.md)                              | `src/types/config.d.ts`, `src/config/run-settings.ts`                    |
| Environments and secrets   | [Environments and secrets](environments-and-secrets.md)        | `src/config/secrets.ts`, `src/config/variables.ts`, `src/config/mask.ts` |
| Running, reports           | [Running tests and reports](running-and-reports.md)            | `src/runner/`                                                            |
| Command line               | [Command line](cli.md)                                         | `bin/samurai.mjs`, `src/cli/`                                            |
| Flows                      | [Flows](flows.md)                                              | `src/flows/core/`, `src/flows/run/`, `src/cli/flow.ts`                   |
| Flow steps                 | [Writing a step](steps.md)                                     | `src/flows/steps/`                                                       |
| Step codec                 | [Steps and the recorder](recorder.md#steps)                    | `src/steps/`                                                             |
| Recorder                   | [Steps and the recorder](recorder.md#recording)                | `src/recorder/`                                                          |
| Recorder toolbar           | [Steps and the recorder](recorder.md#the-toolbar)              | `src/recorder/toolbar/`, `src/project/`                                  |
| Embedding                  | [Embedding the framework](embedding.md)                        | `package.json` `exports`                                                 |
| Protocol layer             | [Contributing](contributing.md)                                | `src/transport/`, `src/script/`, `src/types/bidi-modules/`               |
| CI                         | [Contributing](contributing.md)                                | `.github/`                                                               |

## Status

- [Roadmap](roadmap.md): what is built and what is open.
