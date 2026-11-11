## 0.22.11 (2026-11-11)

This was a version bump only for framework to align it with other projects, there were no code changes.

## 0.22.10 (2026-11-10)

### 🚀 Features

- **framework:** cache the agent's system prompt on Anthropic too
- **framework:** make the agents write tersely
- **framework:** cache the agent's prompt on Anthropic and report cached tokens
- **framework:** send only the latest page snapshot to the model
- **framework:** prune stale page snapshots from the agent conversation

### 🩹 Fixes

- **framework:** name the caller's timeout in the fetch timeout message
- **framework:** drop thinking blocks when old page snapshots are pruned

### ❤️ Thank You

- Sam @degrootsam

## 0.22.9 (2026-11-06)

### 🚀 Features

- **framework:** continue an existing test from a step with the agent

### ❤️ Thank You

- Sam

## 0.22.8 (2026-11-06)

### 🚀 Features

- **framework:** list the annotations of each test in listTests

### ❤️ Thank You

- Sam

## 0.22.7 (2026-11-06)

### 🚀 Features

- **framework:** export formatPlan, splitFrontMatter and listPlans for plan files

### ❤️ Thank You

- Sam

## 0.22.6 (2026-11-06)

### 🚀 Features

- **framework:** mark tests made from a plan with a plan annotation
- **framework:** read, write and keep annotations in the step codec
- **framework:** add annotations to the test options
- **framework:** add plansDir and write plans there by default
- **framework:** read plan answers and give them to generate
- **framework:** ignore and keep front matter in plan files

### 🩹 Fixes

- **framework:** let the planner record one step per action done

### ❤️ Thank You

- Sam

## 0.22.5 (2026-11-06)

### 🚀 Features

- **framework:** test the planner end to end and document it
- **framework:** add samurai plan and generate --plan
- **framework:** add the planner's tools, prompt and run kind
- **framework:** add the request guard for the planner
- **framework:** add the plan file writer and parser
- **framework:** add the run-kind seam to the agent

### 🩹 Fixes

- **framework:** run the agent's tool calls in order and add undo

### ❤️ Thank You

- Sam

## 0.22.4 (2026-11-06)

### 🚀 Features

- **framework:** add samurai generate and the model set-up per provider
- **framework:** add the AI agent loop and its session
- **framework:** add the agent's instruction files, system prompt and guide
- **framework:** add the tools of the AI agent
- **framework:** add the page snapshot of the AI agent
- **framework:** add the agent entry with its types, model guard and limits

### ❤️ Thank You

- Sam

## 0.22.3 (2026-11-05)

### 🩹 Fixes

- **framework:** the recorder always opens a window

### ❤️ Thank You

- Sam

## 0.22.2 (2026-11-05)

### 🚀 Features

- **framework:** advertise the typed steps, matchers and locator forms in capabilities
- **framework:** record check, uncheck and selectOption steps
- **framework:** type the plain matchers toBeFocused to toHaveAccessibleDescription
- **framework:** type the check, uncheck, selectOption, hover, dblclick and clear steps
- **framework:** type the locator forms the framework shipped since 0.21

### 🩹 Fixes

- **framework:** assertionMatchers 3 in the capabilities test, textFromMatcher stays private

### ❤️ Thank You

- Sam

## 0.22.1 (2026-11-05)

### 🚀 Features

- **framework:** worker-scoped fixtures and a fixtures list in every test result
- **framework:** attach fixtures and set option fixtures through use, per environment
- **framework:** metadata, option fixtures and a fixture catalog on test.extend

### ❤️ Thank You

- Sam

## 0.22.0 (2026-11-05)

### 🚀 Features

- ⚠️ **framework:** replace emulate with use, one option set for config, tests and the page
- **framework:** add groups[].use, layered between config use and test.use
- **framework:** select several groups, and name the group in results
- **framework:** add --shard to run one slice of the selected tests
- **framework:** run serial blocks in order on one worker, and add fullyParallel
- **framework:** add describe.configure, describe.serial and describe.parallel
- **framework:** run globalSetup and globalTeardown around the web servers
- **framework:** add the webServer config: start, wait for and stop servers
- **framework:** add page.request, context.request, the request fixture and request.newContext
- **framework:** add hover, dblclick, tap, dragTo, dispatchEvent, blur, clear and pressSequentially
- **framework:** add page.keyboard and page.mouse

### 🩹 Fixes

- **framework:** show chromedriver's last output when it exits before it is ready

### ⚠️ Breaking Changes

- **framework:** replace emulate with use, one option set for config, tests and the page
  page.emulate -> page.use, context.emulate -> context.use,
  EmulationError -> UseError, EmulationUnsupportedError -> UseUnsupportedError.
  Option renames: timezoneId -> timezone, emulate's touch (a number) -> hasTouch
  (a boolean, maxTouchPoints 1). The old names are refused with an error that
  names the new one. Invalid values are now TypeError (were RangeError) and
  read use(): what is wrong. browser.newContext() takes the same run-time
  options.

### ❤️ Thank You

- Sam

## 0.21.5 (2026-11-05)

### 🚀 Features

- **framework:** add test.step, test.fail, test.slow and test.setTimeout
- **framework:** add test.extend with runner-level fixtures
- **framework:** apply the use options to the browser, and add the isMobile and hasTouch fixtures
- **framework:** add test.use and checked use options
- **framework:** add testInfo, context and baseURL fixtures, and test.skip with a function
- **framework:** add test.describe and the hook functions as aliases on test
- **framework:** export the evaluate and waitForURL result types

### ❤️ Thank You

- Sam

## 0.21.4 (2026-11-03)

### 🚀 Features

- **framework:** add expect.poll and toPass
- **framework:** add value matchers and asymmetric matchers
- **framework:** add more locator matchers and array text assertions
- **framework:** add page.content, setContent, waitForURL, setViewportSize and viewportSize
- **framework:** add evaluate, evaluateAll and more locator reads

### ❤️ Thank You

- Sam

## 0.21.3 (2026-11-03)

### 🚀 Features

- **framework:** add isDisabled and isHidden
- **framework:** add selectOption
- **framework:** add check, uncheck and setChecked
- **framework:** add toHaveAccessibleName and toHaveAccessibleDescription
- **framework:** add name, state and hidden options to getByRole
- **framework:** add exact and RegExp matching to getByText and getByLabel
- **framework:** page.locator takes the filter options
- **framework:** opt-in strict selectors
- **framework:** locator and() and or()
- **framework:** locator filter and locator(selector, options)
- **framework:** locator nth, first and last
- **framework:** locator() accepts css and Playwright-style xpath strings

### ❤️ Thank You

- Sam

## 0.21.2 (2026-11-03)

### 🩹 Fixes

- **framework:** keep Chrome redirect chains in flight until the next hop shows

### ❤️ Thank You

- Sam @degrootsam

## 0.21.1 (2026-11-02)

### 🩹 Fixes

- **framework:** type maskFormat through winston's Logform re-export
- **framework:** an aborted Chrome launch lets chromedriver quit Chrome before it ends
- **framework:** an aborted launch stops the browser while the first page is set up
- Save as output allows an element that shows a secret, with a warning
- Save as output says when the element shows a secret

### ❤️ Thank You

- Sam @degrootsam
