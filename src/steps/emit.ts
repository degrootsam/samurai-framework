import type {
  Expectation,
  LocatorCall,
  LocatorSpec,
  Step,
  TextMatcher,
  TextValue,
} from "./model.js";

const str = (value: string) => JSON.stringify(value);
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

function textOptions(call: {
  match?: "full" | "partial";
  ignoreCase?: boolean;
}): string {
  const parts = [
    call.match !== undefined && `match: ${str(call.match)}`,
    call.ignoreCase !== undefined && `ignoreCase: ${call.ignoreCase}`,
  ].filter(Boolean);
  return parts.length ? `, { ${parts.join(", ")} }` : "";
}

export function callToSource(call: LocatorCall): string {
  switch (call.method) {
    case "locator":
      return `locator(${str(call.xpath)})`;
    case "getByCss":
      return `getByCss(${str(call.css)})`;
    case "getByText":
    case "getByLabel":
      return `${call.method}(${str(call.text)}${textOptions(call)})`;
    case "getByRole":
      return `getByRole(${str(call.role)}${call.name === undefined ? "" : `, { name: ${str(call.name)} }`})`;
    case "getByTestId":
      return `getByTestId(${str(call.testId)})`;
  }
}

const chainToSource = (chain: readonly LocatorCall[]) =>
  ["page", ...chain.map(callToSource)].join(".");

export function locatorToSource({ chain, fallbacks }: LocatorSpec): string {
  const primary = chainToSource(chain);
  return fallbacks.length === 0
    ? primary
    : `${primary}.withFallbacks(${fallbacks.map(chainToSource).join(", ")})`;
}

export function valueToSource(value: TextValue): string {
  if (value.kind === "literal") return str(value.value);
  const object = value.kind === "env" ? "env" : "secrets";
  return IDENTIFIER.test(value.name)
    ? `${object}.${value.name}`
    : `${object}[${str(value.name)}]`;
}

function matcherToSource(expected: TextMatcher): string {
  return typeof expected === "string"
    ? str(expected)
    : `/${expected.regex.source}/${expected.regex.flags}`;
}

function expectationToSource(expectation: Expectation): string {
  switch (expectation.matcher) {
    case "toBeVisible":
      return "toBeVisible()";
    case "toHaveAttribute":
      return `toHaveAttribute(${str(expectation.name)}, ${matcherToSource(expectation.expected)})`;
    case "toHaveCount":
      return `toHaveCount(${expectation.expected})`;
    default:
      return `${expectation.matcher}(${matcherToSource(expectation.expected)})`;
  }
}

/** The statement for a step, on one line */
export function stepToSource(step: Step): string {
  switch (step.kind) {
    case "goto":
      return `await page.goto(${str(step.url)});`;
    case "click":
      return `await ${locatorToSource(step.locator)}.click();`;
    case "fill":
      return `await ${locatorToSource(step.locator)}.fill(${valueToSource(step.value)});`;
    case "press":
      return `await ${locatorToSource(step.locator)}.press(${str(step.key)});`;
    case "expect":
      return `await expect(${locatorToSource(step.locator)})${step.not ? ".not" : ""}.${expectationToSource(step.expectation)};`;
    case "waitForNetworkIdle":
      return "await page.waitForNetworkIdle();";
    case "custom":
      return step.code;
  }
}
