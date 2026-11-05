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
