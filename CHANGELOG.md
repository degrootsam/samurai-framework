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
